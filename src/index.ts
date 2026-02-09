import type { Knex } from 'knex';
import { extendQueryBuilder } from './query-builder';
import { attachPreparedStatementHook } from './interceptor';
import { addPreparedFactory } from './factory';
import { wrapTransactionMethod } from './transaction';
import type { KnexPreparedOptions, ResolvedKnexPreparedOptions } from './types';
import { setOptions } from './types';

/**
 * Resolves options with defaults and validates them.
 */
const resolveOptions = (options: KnexPreparedOptions | undefined): ResolvedKnexPreparedOptions => {
  const autoNamePrefix = options?.autoNamePrefix ?? 'auto';
  const autoNameHashLength = options?.autoNameHashLength ?? 16;
  const rewriteInClauses = options?.rewriteInClauses ?? false;
  const autoNameAllSelects = options?.autoNameAllSelects ?? false;
  const disableWarnings = options?.disableWarnings ?? process.env.NODE_ENV !== 'development';
  const autoNameCacheSize = options?.autoNameCacheSize ?? 1000;

  if (autoNamePrefix.length === 0) {
    throw new Error('autoNamePrefix must be a non-empty string');
  }

  if (!Number.isInteger(autoNameHashLength) || autoNameHashLength < 1 || autoNameHashLength > 64) {
    throw new Error('autoNameHashLength must be an integer between 1 and 64');
  }

  if (!Number.isInteger(autoNameCacheSize)) {
    throw new Error('autoNameCacheSize must be a non-negative integer');
  }

  return {
    autoNamePrefix,
    autoNameHashLength,
    rewriteInClauses,
    autoNameAllSelects,
    disableWarnings,
    autoNameCacheSize,
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

  // Extend QueryBuilder globally (idempotent - safe to call multiple times)
  // This automatically makes .prepared() available on all QueryBuilders including transactions
  extendQueryBuilder(knex);

  // Store options on the client so QueryBuilders can access them
  setOptions(knex.client, Object.freeze(resolvedOptions));

  // Add the factory method to this knex instance
  addPreparedFactory(knex);

  // Wrap transaction method to propagate options and factory to transaction instances
  wrapTransactionMethod(knex);

  // Attach query event listener to inject prepared statement names
  attachPreparedStatementHook(knex, resolvedOptions);

  return knex as TKnex & { prepared: (tableName: string) => Knex.QueryBuilder };
};

// Re-export types for convenience
export type { PreparedMetadata } from './query-builder';
export type { PreparedQueryBuilder, PreparedFactory } from './factory';
export type { KnexPreparedOptions, ResolvedKnexPreparedOptions } from './types';

// Default export
export default knexPrepared;
