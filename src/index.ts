import type { Knex } from 'knex';
import { extendQueryBuilder } from './query-builder';
import { attachPreparedStatementHook } from './interceptor';
import { addPreparedFactory } from './factory';

/**
 * Main entry point for knex-prepared library.
 *
 * This function extends a Knex instance with prepared statement support by:
 * 1. Adding the `.prepared()` chainable method to all QueryBuilder instances
 * 2. Adding the `knex.prepared(tableName)` factory method to the Knex instance
 * 3. Attaching a query event hook to inject prepared statement names before execution
 *
 * @param knex - The Knex instance to extend with prepared statement support
 * @returns The extended Knex instance with prepared statement APIs
 *
 * @example
 * ```typescript
 * import Knex from 'knex';
 * import { knexPrepared } from 'knex-prepared';
 *
 * const knex = knexPrepared(Knex({
 *   client: 'pg',
 *   connection: {
 *     host: 'localhost',
 *     user: 'postgres',
 *     password: 'password',
 *     database: 'mydb',
 *   },
 * }));
 *
 * // Use the factory method
 * await knex.prepared('users').select('*');
 *
 * // Use the chainable method
 * await knex('users').prepared().select('*');
 * await knex('users').prepared('custom-name').select('*');
 * await knex('users').prepared(false).select('*');
 * ```
 */
export function knexPrepared<TKnex extends Knex = Knex>(
  knex: TKnex
): TKnex & { prepared: (tableName: string) => Knex.QueryBuilder } {
  // Step 1: Extend QueryBuilder with .prepared() method
  extendQueryBuilder(knex);

  // Step 2: Add knex.prepared() factory method
  const extended = addPreparedFactory(knex);

  // Step 3: Attach query event hook to inject prepared statement names
  attachPreparedStatementHook(knex);

  return extended as TKnex & { prepared: (tableName: string) => Knex.QueryBuilder };
}

// Re-export types for convenience
export type { PreparedMetadata } from './query-builder';
export type { PreparedQueryBuilder, PreparedFactory } from './factory';
export { PREPARED_SYMBOL } from './query-builder';
export { generatePreparedStatementName } from './hash';

// Default export
export default knexPrepared;
