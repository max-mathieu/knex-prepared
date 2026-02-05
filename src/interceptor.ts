import { createHash } from 'crypto';
import { lru, type LRU } from 'tiny-lru';
import type { PreparedMetadata } from './query-builder';
import type { KnexWithOptions, ResolvedKnexPreparedOptions } from './types';
import { PREPARED_SYMBOL } from './symbols';
import { KNEX_PREPARED_OPTIONS_SYMBOL } from './symbols';
import { Knex } from 'knex';

interface QueryData {
  queryContext?: {
    [PREPARED_SYMBOL]?: PreparedMetadata;
    __rewrittenSql?: string;
    __rewrittenBindings?: unknown[];
  };
  sql?: string | unknown;
  bindings?: unknown[];
  options?: Record<string, unknown>;
}

interface KnexClient {
  query: (connection: Connection, obj: QueryObject) => Promise<unknown>;
  acquireConnection: (...args: unknown[]) => Promise<Connection>;
}

interface QueryObject {
  sql: string;
  bindings: unknown[];
  queryContext?: {
    [PREPARED_SYMBOL]?: PreparedMetadata;
  };
  options?: {
    name?: string;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

interface Connection {
  query: (config: PgQueryConfig, values?: unknown, callback?: unknown) => unknown;
  __knexPreparedWrapped?: boolean;
  [key: string]: unknown;
}

interface PgQueryConfig {
  text: string;
  values?: unknown[];
  name?: string;
  [key: string]: unknown;
}

// Store rewrite instructions indexed by original SQL (before pg driver processes it)
// The key is the SQL after Knex formatting but before pg driver converts ? to $n
const pendingRewrites = new Map<
  string,
  { rewrittenSql: string; rewrittenBindings: unknown[]; preparedName: string }
>();

// LRU cache for auto-generated prepared statement names
// Maps normalized SQL -> generated name
let autoNameCache: LRU<string> | null = null;

/**
 * Generates a deterministic prepared statement name from SQL using SHA-256 hashing.
 * Format: `{prefix}-{first N hex chars of hash}`. Same SQL always produces the same name.
 * Uses LRU cache to avoid re-hashing the same SQL repeatedly.
 */
const generateAutoName = (sql: string, options: ResolvedKnexPreparedOptions): string => {
  const normalizedSql = sql.trim().replace(/\s+/g, ' ');

  if (!autoNameCache && options.autoNameCacheSize > 0) {
    autoNameCache = lru<string>(options.autoNameCacheSize);
  }
  if (autoNameCache) {
    const cached = autoNameCache.get(normalizedSql);
    if (cached) {
      return cached;
    }
  }

  const hash = createHash('sha256').update(normalizedSql).digest('hex');
  const name = `${options.autoNamePrefix}-${hash.substring(0, options.autoNameHashLength)}`;

  if (autoNameCache) {
    autoNameCache.set(normalizedSql, name);
  }

  return name;
};

/**
 * Checks if a SQL query is a SELECT statement.
 */
const isSelectQuery = (sql: string): boolean => {
  return /^select\b/i.test(sql.trim());
};

/**
 * Checks if SQL contains IN or NOT IN clauses.
 */
const hasInClause = (sql: string): boolean => {
  return /\b(not\s+)?in\s*\(/i.test(sql);
};

/**
 * Result of processing a query for prepared statements.
 */
interface ProcessedQuery {
  metadata: PreparedMetadata;
  sql: string;
  bindings: unknown[];
  preparedName: string | null;
}

/**
 * Processes query metadata, handles auto-naming, warnings, and IN clause rewriting.
 * Returns processed query information.
 */
const processQueryMetadata = (
  metadata: PreparedMetadata | undefined,
  sql: string,
  bindings: unknown[],
  options: ResolvedKnexPreparedOptions
): ProcessedQuery | null => {
  // Auto-name SELECT queries if enabled and not already prepared
  if (!metadata && options.autoNameAllSelects && isSelectQuery(sql)) {
    metadata = { name: 'auto' };
  }

  if (!metadata) {
    return null;
  }

  if (metadata.name !== null) {
    if (!options.disableWarnings && hasInClause(sql)) {
      // Warn about IN clauses, with specific method info if available
      // eslint-disable-next-line no-console
      console.warn(
        `[knex-prepared] Warning: Prepared statement with IN/NOT IN clause detected. ` +
          'Prepared statements with variable-length parameter lists can lead to poor plan caching. ' +
          'Consider enabling rewriteInClauses option or rewriting to = ANY($1) / <> ALL($1) manually.'
      );
    }
  }

  // Generate or use prepared statement name
  let preparedName: string | null = null;
  if (metadata.name !== null) {
    preparedName = metadata.name === 'auto' ? generateAutoName(sql, options) : metadata.name;
  }

  return {
    metadata,
    sql,
    bindings,
    preparedName,
  };
};

/**
 * Attaches a query hook to inject prepared statement names and rewrite IN clauses before execution.
 * For PostgreSQL, the `name` property tells the pg driver to use prepared statements.
 *
 * This wraps the client.query() method to intercept queries before they're sent to the database,
 * allowing us to rewrite the SQL and inject the prepared statement name.
 */
export const attachPreparedStatementHook = (knex: Knex): void => {
  const options = (knex as KnexWithOptions)[KNEX_PREPARED_OPTIONS_SYMBOL];

  if (!options) {
    throw new Error('knex-prepared options not found. Did you call knexPrepared()?');
  }

  // Listen to 'query' event to prepare rewrites before they reach the driver
  knex.on('query', (queryData: QueryData) => {
    if (typeof queryData.sql !== 'string') {
      return;
    }

    const originalSql = queryData.sql;
    const bindings = queryData.bindings || [];
    const metadata = queryData.queryContext?.[PREPARED_SYMBOL];

    // Process query with $n notation (after Knex/pg formatting)
    const processed = processQueryMetadata(metadata, originalSql, bindings, options);

    if (processed) {
      // Store metadata in queryContext for downstream processing
      if (!queryData.queryContext) {
        queryData.queryContext = {};
      }
      queryData.queryContext[PREPARED_SYMBOL] = processed.metadata;

      // Store for connection.query() to pick up (if prepared statement is enabled)
      if (processed.preparedName) {
        pendingRewrites.set(originalSql, {
          rewrittenSql: processed.sql,
          rewrittenBindings: processed.bindings,
          preparedName: processed.preparedName,
        });
      }
    }
  });

  const client = (knex as unknown as { client: KnexClient }).client;
  const originalQuery = client.query.bind(client);
  const originalAcquireConnection = client.acquireConnection.bind(client);

  // Wrap client.query() for non-transaction queries
  client.query = function (connection: Connection, obj: QueryObject) {
    if (typeof obj.sql === 'string') {
      const metadata = obj.queryContext?.[PREPARED_SYMBOL];
      const bindings = obj.bindings || [];

      // Process query with ? notation (pre-driver)
      const processed = processQueryMetadata(metadata, obj.sql, bindings, options);

      if (processed) {
        // Apply rewritten SQL and bindings
        obj.sql = processed.sql;
        obj.bindings = processed.bindings;

        // Inject prepared statement name
        if (processed.preparedName) {
          obj.options = obj.options || {};
          obj.options.name = processed.preparedName;
        }

        // Ensure queryContext is defined for later access
        obj.queryContext = obj.queryContext || ({} as QueryObject['queryContext']);
        obj.queryContext![PREPARED_SYMBOL] = processed.metadata;
      }
    }

    return originalQuery(connection, obj);
  };

  // Wrap acquireConnection to patch connections for transactions
  client.acquireConnection = async function (...args: unknown[]) {
    const connection = await originalAcquireConnection(...args);

    // Wrap the connection's query method if not already wrapped
    if (connection && !connection.__knexPreparedWrapped) {
      const originalConnectionQuery = connection.query.bind(connection);

      connection.query = function (config: PgQueryConfig, values?: unknown, callback?: unknown) {
        // For pg driver, config is { text: sql, values: bindings, ... }
        if (config && typeof config === 'object' && config.text) {
          const originalSql = config.text;
          const rewrite = pendingRewrites.get(originalSql);

          if (rewrite) {
            // Apply the rewritten SQL, bindings, and prepared statement name
            config.text = rewrite.rewrittenSql;
            config.values = rewrite.rewrittenBindings;
            config.name = rewrite.preparedName;

            // Clean up to prevent memory leaks
            pendingRewrites.delete(originalSql);
          }
        }

        return originalConnectionQuery(config, values, callback);
      };

      connection.__knexPreparedWrapped = true;
    }

    return connection;
  };
};
