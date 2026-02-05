import { createHash } from 'crypto';
import { lru, type LRU } from 'tiny-lru';
import type { Knex } from 'knex';
import type { PreparedMetadata } from './query-builder';
import type { KnexWithOptions, ResolvedKnexPreparedOptions } from './types';
import { PREPARED_SYMBOL, KNEX_PREPARED_OPTIONS_SYMBOL } from './symbols';

/**
 * Query data from Knex 'query' event.
 */
interface QueryEventData {
  queryContext?: {
    [PREPARED_SYMBOL]?: PreparedMetadata;
  };
  sql?: string | unknown;
  bindings?: unknown[];
  options?: Record<string, unknown>;
}

/**
 * Query object passed to client.query().
 */
interface PgQueryObject {
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

/**
 * PostgreSQL connection from pg driver.
 */
interface PgConnection {
  query: (config: PgQueryConfig, values?: unknown, callback?: unknown) => unknown;
  [PREPARED_SYMBOL]?: boolean;
  [key: string]: unknown;
}

/**
 * Query configuration for pg driver.
 */
interface PgQueryConfig {
  text: string;
  values?: unknown[];
  name?: string;
  [key: string]: unknown;
}

/**
 * Store prepared statement names for queries.
 * Maps SQL (after Knex formatting) -> prepared statement name.
 */
const pendingNames = new Map<string, string>();

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
 * Processes query metadata and returns the prepared statement name (if any).
 * Handles auto-naming and warnings.
 */
const getPreparedStatementName = (
  metadata: PreparedMetadata | undefined,
  sql: string,
  options: ResolvedKnexPreparedOptions
): string | null => {
  // Auto-name SELECT queries if enabled and not already prepared
  if (!metadata && options.autoNameAllSelects && isSelectQuery(sql)) {
    metadata = { name: 'auto' };
  }

  if (!metadata || metadata.name === null) {
    return null;
  }

  // Warn about IN clauses if not disabled
  if (!options.disableWarnings && hasInClause(sql)) {
    // eslint-disable-next-line no-console
    console.warn(
      `[knex-prepared] Warning: Prepared statement with IN/NOT IN clause detected. ` +
        'Prepared statements with variable-length parameter lists can lead to poor plan caching. ' +
        'Consider using rewriteInClauses option or rewriting to = ANY($1) / <> ALL($1) manually.'
    );
  }

  // Generate or use prepared statement name
  return metadata.name === 'auto' ? generateAutoName(sql, options) : metadata.name;
};

/**
 * Attaches a query hook to inject prepared statement names before execution.
 * For PostgreSQL, the `name` property tells the pg driver to use prepared statements.
 */
export const attachPreparedStatementHook = (knex: Knex): void => {
  const options = (knex as KnexWithOptions)[KNEX_PREPARED_OPTIONS_SYMBOL];

  if (!options) {
    throw new Error('knex-prepared options not found. Did you call knexPrepared()?');
  }

  const client = knex.client as Knex.Client & {
    query: (connection: PgConnection, obj: PgQueryObject) => Promise<unknown>;
    acquireConnection: (...args: unknown[]) => Promise<PgConnection>;
  };

  const originalQuery = client.query.bind(client);
  const originalAcquireConnection = client.acquireConnection.bind(client);

  // Wrap client.query() for non-transaction queries
  client.query = function (connection: PgConnection, obj: PgQueryObject) {
    if (typeof obj.sql === 'string') {
      const metadata = obj.queryContext?.[PREPARED_SYMBOL];
      const preparedName = getPreparedStatementName(metadata, obj.sql, options);

      if (preparedName) {
        // Inject prepared statement name
        obj.options = obj.options || {};
        obj.options.name = preparedName;
      }
    }

    return originalQuery(connection, obj);
  };


  // Listen to 'query' event to store prepared statement names for transaction queries (which bypass client.query)
  knex.on('query', (queryData: QueryEventData) => {
    if (typeof queryData.sql !== 'string') {
      return;
    }

    const metadata = queryData.queryContext?.[PREPARED_SYMBOL];
    const preparedName = getPreparedStatementName(metadata, queryData.sql, options);

    if (preparedName) {
      // Store the prepared name for this SQL to be picked up by connection.query()
      pendingNames.set(queryData.sql, preparedName);
    }
  });

  // Wrap acquireConnection to patch connections for transactions
  client.acquireConnection = async function (...args: unknown[]) {
    const connection = await originalAcquireConnection(...args);

    // Wrap the connection's query method if not already wrapped
    if (connection && !connection[PREPARED_SYMBOL]) {
      const originalConnectionQuery = connection.query.bind(connection);

      connection.query = function (config: PgQueryConfig, values?: unknown, callback?: unknown) {
        // For pg driver, config is { text: sql, values: bindings, ... }
        if (config && typeof config === 'object' && config.text) {
          const preparedName = pendingNames.get(config.text);

          if (preparedName) {
            // Inject prepared statement name
            config.name = preparedName;

            // Clean up to prevent memory leaks
            pendingNames.delete(config.text);
          }
        }

        return originalConnectionQuery(config, values, callback);
      };

      connection[PREPARED_SYMBOL] = true;
    }

    return connection;
  };
};
