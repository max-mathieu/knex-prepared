import { createHash } from 'crypto';
import { lru, type LRU } from 'tiny-lru';
import type { Knex } from 'knex';
import type { PreparedMetadata } from './query-builder';
import type { ResolvedKnexPreparedOptions } from './types';
import { PREPARED_SYMBOL } from './symbols';

/**
 * Query data from Knex 'query' event.
 */
interface QueryEventData {
  queryContext?: {
    [PREPARED_SYMBOL]?: PreparedMetadata;
  };
  sql?: string | unknown;
  bindings?: unknown[];
  __knexQueryUid?: string;
  options?: {
    name?: string;
    [key: string]: unknown;
  };
}

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
 * For PostgreSQL, the `name` property in query options tells the pg driver to use prepared statements.
 */
export const attachPreparedStatementHook = (
  knex: Knex,
  options: ResolvedKnexPreparedOptions
): void => {
  knex.on('query', (queryData: QueryEventData) => {
    if (typeof queryData.sql !== 'string') {
      return;
    }

    const metadata = queryData.queryContext?.[PREPARED_SYMBOL];
    const preparedName = getPreparedStatementName(metadata, queryData.sql, options);

    if (preparedName) {
      // Inject prepared statement name into query options
      queryData.options = queryData.options || {};
      queryData.options.name = preparedName;
    }
  });
};
