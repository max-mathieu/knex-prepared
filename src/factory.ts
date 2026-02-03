import type { Knex } from 'knex';
import { PREPARED_SYMBOL, type PreparedMetadata } from './query-builder';

/**
 * Factory method return type - a QueryBuilder with prepared statement metadata already set.
 */
export type PreparedQueryBuilder<
  TRecord extends {} = Record<string, unknown>,
  TResult = unknown[],
> = Knex.QueryBuilder<TRecord, TResult>;

/**
 * Adds the `prepared(tableName)` factory method to a Knex instance.
 *
 * This function wraps the Knex instance to add a new method that creates a QueryBuilder
 * with prepared statement metadata already configured to use auto-generated names.
 *
 * @param knex - The Knex instance to extend
 * @returns The Knex instance with the `prepared()` factory method added
 *
 * @example
 * ```typescript
 * import Knex from 'knex';
 * import { addPreparedFactory } from './factory';
 *
 * const knex = Knex({ client: 'pg', connection: {...} });
 * addPreparedFactory(knex);
 *
 * // Now you can use the factory method
 * await knex.prepared('users').select('*');
 * ```
 */
export function addPreparedFactory(knex: Knex): Knex & { prepared: PreparedFactory } {
  const extended = knex as Knex & { prepared: PreparedFactory };

  extended.prepared = function <TRecord extends {} = Record<string, unknown>, TResult = unknown[]>(
    tableName: string
  ): PreparedQueryBuilder<TRecord, TResult> {
    // Create a query builder for the table
    const builder = knex<TRecord, TResult>(tableName);

    // Set the prepared statement metadata to auto-generate name
    (builder as unknown as Record<symbol, PreparedMetadata>)[PREPARED_SYMBOL] = {
      name: 'auto',
    };

    return builder as PreparedQueryBuilder<TRecord, TResult>;
  };

  return extended;
}

/**
 * Factory function type for creating prepared statement queries.
 */
export interface PreparedFactory {
  /**
   * Create a QueryBuilder for the specified table with prepared statements enabled.
   * The prepared statement name will be auto-generated from the SQL hash.
   *
   * @param tableName - The name of the table to query
   * @returns A QueryBuilder with prepared statements enabled
   *
   * @example
   * ```typescript
   * // Auto-generate prepared statement name
   * await knex.prepared('users').select('*');
   * await knex.prepared('users').where('id', 1).first();
   * ```
   */
  <TRecord extends {} = Record<string, unknown>, TResult = unknown[]>(
    tableName: string
  ): PreparedQueryBuilder<TRecord, TResult>;
}

// TypeScript module augmentation to add the factory method to Knex
declare module 'knex' {
  // Must match Knex's own default type parameters
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  interface Knex<TRecord = any, TResult = any[]> {
    /**
     * Create a QueryBuilder for the specified table with prepared statements enabled.
     * The prepared statement name will be auto-generated from the SQL hash.
     *
     * @param tableName - The name of the table to query
     * @returns A QueryBuilder with prepared statements enabled
     *
     * @example
     * ```typescript
     * // Factory method - auto-generates prepared statement name
     * await knex.prepared('users').select('*');
     * await knex.prepared('users').where('active', true).select('id', 'name');
     * ```
     */
    prepared<TRecord2 extends {} = TRecord, TResult2 = TResult>(
      tableName: string
    ): Knex.QueryBuilder<TRecord2, TResult2>;
  }
}
