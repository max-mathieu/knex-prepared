import { createHash } from 'crypto';
import type { Knex } from 'knex';
import {
  PREPARED_SYMBOL,
  KNEX_PREPARED_OPTIONS_SYMBOL,
  type PreparedMetadata,
} from './query-builder';
import type { ResolvedKnexPreparedOptions } from './types';

interface QueryData {
  queryContext?: { [PREPARED_SYMBOL]?: PreparedMetadata };
  sql?: string | unknown;
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

    if (metadata.name !== 'auto') {
      queryData.options = queryData.options || {};
      queryData.options.name = metadata.name;
      return;
    }

    if (typeof queryData.sql !== 'string') {
      return;
    }

    const preparedName = generatePreparedStatementName(queryData.sql, options);
    queryData.options = queryData.options || {};
    queryData.options.name = preparedName;
  });
};
