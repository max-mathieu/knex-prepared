import type { Knex } from 'knex';
import { extendQueryBuilder } from './query-builder';
import { attachPreparedStatementHook } from './interceptor';
import { addPreparedFactory } from './factory';
import { wrapTransactionMethod } from './transaction';

/**
 * Extends a Knex instance with prepared statement support.
 * Adds `.prepared()` chainable method and `knex.prepared(tableName)` factory.
 */
export const knexPrepared = <TKnex extends Knex = Knex>(
  knex: TKnex
): TKnex & { prepared: (tableName: string) => Knex.QueryBuilder } => {
  extendQueryBuilder(knex);
  const extended = addPreparedFactory(knex);
  wrapTransactionMethod(knex);
  attachPreparedStatementHook(knex);
  return extended as TKnex & { prepared: (tableName: string) => Knex.QueryBuilder };
};

// Re-export types for convenience
export type { PreparedMetadata } from './query-builder';
export type { PreparedQueryBuilder, PreparedFactory } from './factory';
export { PREPARED_SYMBOL } from './query-builder';
export { generatePreparedStatementName } from './hash';

// Default export
export default knexPrepared;
