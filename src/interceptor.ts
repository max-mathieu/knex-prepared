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
  queryContext?: { [PREPARED_SYMBOL]?: PreparedMetadata };
  sql?: string | unknown;
  bindings?: unknown[];
  options?: Record<string, unknown>;
}

interface KnexWithOptions extends Knex {
  [KNEX_PREPARED_OPTIONS_SYMBOL]?: ResolvedKnexPreparedOptions;
}

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
  return `${options.autoPrefix}-${hash.substring(0, options.autoHashLength)}`;
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
const findInClauses = (sql: string): InClauseMatch[] => {
  // Match: column [NOT] IN ($1, $2, ...) - capture column name and placeholders
  const regex = typedRegExp(
    '(?<column>\\S+)\\s+(?<inOrNotIn>not\\s+in|in)\\s*\\((?<placeholders>\\$\\d+(?:,\\s*\\$\\d+)*)\\)',
    'gi'
  );
  const matches: InClauseMatch[] = [];

  for (const match of regex.matchAllIn(sql)) {
    const fullMatch = match[0];
    const column = match.groups.column;
    const isNotIn = match.groups.inOrNotIn.toLowerCase() === 'not in';
    const placeholders = match.groups.placeholders;
    // Count $n style placeholders only
    const placeholderMatches = placeholders.match(/\$\d+/g) || [];
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
  bindings: unknown[]
): { sql: string; bindings: unknown[] } => {
  const matches = findInClauses(sql);

  if (matches.length === 0) {
    return { sql, bindings };
  }

  // Process matches in reverse order to avoid index issues
  matches.reverse();

  let newSql = sql;
  const newBindings = [...bindings];

  for (const match of matches) {
    // Calculate actual binding index by counting $n placeholders before this match
    const sqlBeforeMatch = sql.substring(0, match.index);
    const placeholdersBefore = (sqlBeforeMatch.match(/\$\d+/g) || []).length;
    const startIndex = placeholdersBefore;

    // Extract the values for this IN clause
    const values = newBindings.splice(startIndex, match.placeholderCount);

    // Infer type from first value
    const arrayType = values.length > 0 ? inferPostgresArrayType(values[0]) : 'text';

    // Determine the parameter number for the rewritten SQL
    // Count how many parameters exist in the new SQL before this point
    const newSqlBeforeMatch = newSql.substring(0, match.index);
    const paramsBeforeInNewSql = (newSqlBeforeMatch.match(/\$\d+/g) || []).length;
    const paramNumber = paramsBeforeInNewSql + 1;

    // Create the replacement using $n notation
    const operator = match.isNotIn ? '<> ALL' : '= ANY';
    const replacement = `${match.column} ${operator}($${paramNumber}::${arrayType}[])`;

    // Get the SQL before and after this match
    const beforeMatch = newSql.substring(0, match.index);
    const afterMatch = newSql.substring(match.index + match.fullMatch.length);
    
    // Renumber placeholders in the remaining SQL
    // We went from match.placeholderCount parameters to 1, so we need to shift down by (match.placeholderCount - 1)
    const shift = match.placeholderCount - 1;
    const renumbered = afterMatch.replace(/\$(\d+)/g, (_, num) => {
      const oldNum = parseInt(num, 10);
      const newNum = oldNum - shift;
      return `$${newNum}`;
    });

    // Replace in SQL (working backwards from end)
    newSql = beforeMatch + replacement + renumbered;

    // Insert array as single binding
    newBindings.splice(startIndex, 0, values);
  }

  return { sql: newSql, bindings: newBindings };
};

/**
 * Attaches a query event hook to inject prepared statement names before execution.
 * For PostgreSQL, the `name` property tells the pg driver to use prepared statements.
 */
export const attachPreparedStatementHook = (knex: Knex): void => {
  const options = (knex as KnexWithOptions)[KNEX_PREPARED_OPTIONS_SYMBOL];

  if (!options) {
    throw new Error('knex-prepared options not found. Did you call knexPrepared()?');
  }

  knex.on('query', (queryData: QueryData) => {
    const metadata = queryData.queryContext?.[PREPARED_SYMBOL];

    if (!metadata || metadata.name === null) {
      return;
    }

    if (typeof queryData.sql !== 'string') {
      return;
    }

    // Rewrite IN clauses if enabled and prepared statements are enabled
    let sql = queryData.sql;
    let bindings = queryData.bindings || [];

    if (options.rewriteInClauses && metadata.name !== null) {
      const rewritten = rewriteInClausesInQuery(sql, bindings);
      sql = rewritten.sql;
      bindings = rewritten.bindings;
      queryData.sql = sql;
      queryData.bindings = bindings;
    }

    // Handle custom vs auto-generated names
    if (metadata.name !== 'auto') {
      queryData.options = queryData.options || {};
      queryData.options.name = metadata.name;
      return;
    }

    // Generate name from (potentially rewritten) SQL
    const preparedName = generatePreparedStatementName(sql, options);
    queryData.options = queryData.options || {};
    queryData.options.name = preparedName;
  });
};