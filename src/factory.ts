import type { Knex } from 'knex';
import { PREPARED_SYMBOL, type PreparedMetadata } from './query-builder';

/** QueryBuilder with prepared statement metadata pre-configured. */
export type PreparedQueryBuilder<
  TRecord extends {} = Record<string, unknown>,
  TResult = unknown[],
> = Knex.QueryBuilder<TRecord, TResult>;

/** Factory function type for creating prepared statement queries. */
export interface PreparedFactory {
  <TRecord extends {} = Record<string, unknown>, TResult = unknown[]>(
    tableName: string
  ): PreparedQueryBuilder<TRecord, TResult>;
}

/** Adds the `knex.prepared(tableName)` factory method. */
export function addPreparedFactory(knex: Knex): Knex & { prepared: PreparedFactory } {
  const extended = knex as Knex & { prepared: PreparedFactory };

  extended.prepared = function <TRecord extends {} = Record<string, unknown>, TResult = unknown[]>(
    tableName: string
  ): PreparedQueryBuilder<TRecord, TResult> {
    const builder = knex<TRecord, TResult>(tableName);
    (builder as unknown as Record<symbol, PreparedMetadata>)[PREPARED_SYMBOL] = { name: 'auto' };
    return builder as PreparedQueryBuilder<TRecord, TResult>;
  };

  return extended;
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
