import { createHash } from 'crypto';
import type { Knex } from 'knex';
import { typedRegExp } from 'ts-regexp';
import {
  PREPARED_SYMBOL,
  KNEX_PREPARED_OPTIONS_SYMBOL,
  type PreparedMetadata,
} from './query-builder';
import type { ResolvedKnexPreparedOptions } from './types';

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

interface KnexWithOptions extends Knex {
  [KNEX_PREPARED_OPTIONS_SYMBOL]?: ResolvedKnexPreparedOptions;
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

/**
 * Generates a deterministic prepared statement name from SQL using SHA-256 hashing.
 * Format: `{prefix}-{first N hex chars of hash}`. Same SQL always produces the same name.
 */
const generatePreparedStatementName = (
  sql: string,
  options: ResolvedKnexPreparedOptions
): string => {
  const normalized = sql.trim().replace(/\s+/g, ' ');
  const hash = createHash('sha256').update(normalized).digest('hex');
  return `${options.autoNamePrefix}-${hash.substring(0, options.autoNameHashLength)}`;
};

interface InClauseMatch {
  fullMatch: string;
  column: string;
  isNotIn: boolean;
  placeholderCount: number;
  index: number;
}

/**
 * Finds all IN clause patterns in the SQL query.
 * Only supports $n (PostgreSQL) parameter notation.
 */
const findInClauses = (sql: string, useDollarNotation: boolean): InClauseMatch[] => {
  // Match: column [NOT] IN (?, ?, ...) or column [NOT] IN ($1, $2, ...)
  const placeholderPattern = useDollarNotation ? '\\$\\d+' : '\\?';
  const regex = typedRegExp(
    `(?<column>\\S+)\\s+(?<inOrNotIn>not\\s+in|in)\\s*\\((?<placeholders>${placeholderPattern}(?:,\\s*${placeholderPattern})*)\\)`,
    'gi'
  );
  const matches: InClauseMatch[] = [];

  for (const match of regex.matchAllIn(sql)) {
    const fullMatch = match[0];
    const column = match.groups.column;
    const isNotIn = match.groups.inOrNotIn.toLowerCase() === 'not in';
    const placeholders = match.groups.placeholders;
    // Count placeholders
    const placeholderMatches = useDollarNotation
      ? placeholders.match(/\$\d+/g) || []
      : placeholders.match(/\?/g) || [];
    const placeholderCount = placeholderMatches.length;

    matches.push({
      fullMatch,
      column,
      isNotIn,
      placeholderCount,
      index: match.index,
    });
  }

  return matches;
};

/**
 * Infers the PostgreSQL array type from a value.
 */
const inferPostgresArrayType = (value: unknown): string => {
  if (typeof value === 'number') {
    return Number.isInteger(value) ? 'int' : 'float';
  }
  if (typeof value === 'string') {
    return 'text';
  }
  if (typeof value === 'boolean') {
    return 'boolean';
  }
  if (value instanceof Date) {
    return 'timestamp';
  }
  return 'text';
};

/**
 * Rewrites IN clauses to = ANY() for better prepared statement caching.
 */
const rewriteInClausesInQuery = (
  sql: string,
  bindings: unknown[],
  useDollarNotation: boolean
): { sql: string; bindings: unknown[] } => {
  const matches = findInClauses(sql, useDollarNotation);

  if (matches.length === 0) {
    return { sql, bindings };
  }

  // Process matches in reverse order to avoid index issues
  matches.reverse();

  let newSql = sql;
  const newBindings = [...bindings];

  for (const match of matches) {
    // Calculate actual binding index
    const sqlBeforeMatch = sql.substring(0, match.index);
    const placeholdersBefore = useDollarNotation
      ? (sqlBeforeMatch.match(/\$\d+/g) || []).length
      : (sqlBeforeMatch.match(/\?/g) || []).length;
    const startIndex = placeholdersBefore;

    // Extract the values for this IN clause
    const values = newBindings.splice(startIndex, match.placeholderCount);

    // Infer type from first value
    const arrayType = values.length > 0 ? inferPostgresArrayType(values[0]) : 'text';

    // Create the replacement
    const operator = match.isNotIn ? '<> ALL' : '= ANY';
    let replacement: string;

    if (useDollarNotation) {
      // Using $n notation - need to calculate parameter number
      const newSqlBeforeMatch = newSql.substring(0, match.index);
      const paramsBeforeInNewSql = (newSqlBeforeMatch.match(/\$\d+/g) || []).length;
      const paramNumber = paramsBeforeInNewSql + 1;
      replacement = `${match.column} ${operator}($${paramNumber}::${arrayType}[])`;
    } else {
      // Using ? notation - just use single ?
      replacement = `${match.column} ${operator}(?::${arrayType}[])`;
    }

    // Get the SQL before and after this match
    const beforeMatch = newSql.substring(0, match.index);
    const afterMatch = newSql.substring(match.index + match.fullMatch.length);

    // Renumber placeholders if using $n notation
    let processedAfter = afterMatch;
    if (useDollarNotation) {
      const shift = match.placeholderCount - 1;
      processedAfter = afterMatch.replace(/\$(\d+)/g, (_, num) => {
        const oldNum = parseInt(num, 10);
        const newNum = oldNum - shift;
        return `$${newNum}`;
      });
    }

    // Replace in SQL (working backwards from end)
    newSql = beforeMatch + replacement + processedAfter;

    // Insert array as single binding
    newBindings.splice(startIndex, 0, values);
  }

  return { sql: newSql, bindings: newBindings };
};

/**
 * Checks if a SQL query is a SELECT statement.
 */
const isSelectQuery = (sql: string): boolean => {
  return /^\s*select\b/i.test(sql.trim());
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
  options: ResolvedKnexPreparedOptions,
  useDollarNotation: boolean
): ProcessedQuery | null => {
  // Auto-name SELECT queries if enabled and not already prepared
  if (!metadata && options.autoNameAllSelects && isSelectQuery(sql)) {
    metadata = { name: 'auto' };
  }

  if (!metadata) {
    return null;
  }

  // Warn about IN clauses if conditions are met
  if (
    metadata.name !== null &&
    !options.rewriteInClauses &&
    !options.disableInClausesWarning &&
    hasInClause(sql)
  ) {
    // eslint-disable-next-line no-console
    console.warn(
      '[knex-prepared] Warning: Prepared statement with IN/NOT IN clause detected. ' +
        'Prepared statements with variable-length parameter lists can lead to poor plan caching. ' +
        'Consider using rewriteInClauses option or rewriting to = ANY($1) / <> ALL($1) manually.'
    );
  }

  // Rewrite IN clauses if enabled
  let processedSql = sql;
  let processedBindings = bindings;
  if (options.rewriteInClauses && metadata.name !== null) {
    const rewritten = rewriteInClausesInQuery(sql, bindings, useDollarNotation);
    processedSql = rewritten.sql;
    processedBindings = rewritten.bindings;
  }

  // Generate or use prepared statement name
  let preparedName: string | null = null;
  if (metadata.name !== null) {
    preparedName =
      metadata.name === 'auto'
        ? generatePreparedStatementName(processedSql, options)
        : metadata.name;
  }

  return {
    metadata,
    sql: processedSql,
    bindings: processedBindings,
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
    const processed = processQueryMetadata(metadata, originalSql, bindings, options, true);

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
      const processed = processQueryMetadata(metadata, obj.sql, bindings, options, false);

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
