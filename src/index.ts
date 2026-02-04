import type { Knex } from 'knex';
import { extendQueryBuilder, KNEX_PREPARED_OPTIONS_SYMBOL } from './query-builder';
import { attachPreparedStatementHook } from './interceptor';
import { addPreparedFactory } from './factory';
import { wrapTransactionMethod } from './transaction';
import type { KnexPreparedOptions, ResolvedKnexPreparedOptions } from './types';

/**
 * Resolves options with defaults and validates them.
 */
const resolveOptions = (options: KnexPreparedOptions | undefined): ResolvedKnexPreparedOptions => {
  const autoNamePrefix = options?.autoNamePrefix ?? 'auto';
  const autoNameHashLength = options?.autoNameHashLength ?? 16;
  const rewriteInClauses = options?.rewriteInClauses ?? false;
  const autoNameAllSelects = options?.autoNameAllSelects ?? false;
  const disableInClausesWarning =
    options?.disableInClausesWarning ?? process.env.NODE_ENV === 'production';

  // Validate autoNamePrefix
  if (typeof autoNamePrefix !== 'string' || autoNamePrefix.length === 0) {
    throw new Error('autoNamePrefix must be a non-empty string');
  }

  // Validate autoNameHashLength
  if (
    typeof autoNameHashLength !== 'number' ||
    autoNameHashLength < 1 ||
    autoNameHashLength > 64 ||
    !Number.isInteger(autoNameHashLength)
  ) {
    throw new Error('autoNameHashLength must be an integer between 1 and 64');
  }

  return {
    autoNamePrefix,
    autoNameHashLength,
    rewriteInClauses,
    autoNameAllSelects,
    disableInClausesWarning,
  };
};

/**
 * Extends a Knex instance with prepared statement support.
 * Adds `.prepared()` chainable method and `knex.prepared(tableName)` factory.
 */
export const knexPrepared = <TKnex extends Knex = Knex>(
  knex: TKnex,
  options?: KnexPreparedOptions
): TKnex & { prepared: (tableName: string) => Knex.QueryBuilder } => {
  const resolvedOptions = resolveOptions(options);

  // Store options on knex instance
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (knex as any)[KNEX_PREPARED_OPTIONS_SYMBOL] = Object.freeze(resolvedOptions);

  extendQueryBuilder(knex);
  const extended = addPreparedFactory(knex);
  wrapTransactionMethod(knex);
  attachPreparedStatementHook(knex);
  return extended as TKnex & { prepared: (tableName: string) => Knex.QueryBuilder };
};

// Re-export types for convenience
export type { PreparedMetadata } from './query-builder';
export type { PreparedQueryBuilder, PreparedFactory } from './factory';
export type { KnexPreparedOptions, ResolvedKnexPreparedOptions } from './types';
export { PREPARED_SYMBOL } from './query-builder';

// Default export
export default knexPrepared;
