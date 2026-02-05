import type { Knex } from 'knex';
import { setQueryBuilderMetadata } from './query-builder';
import type { ResolvedKnexPreparedOptions } from './types';
import { KNEX_PREPARED_OPTIONS_SYMBOL } from './symbols';

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

interface KnexClient {
  [KNEX_PREPARED_OPTIONS_SYMBOL]?: ResolvedKnexPreparedOptions;
  [key: string]: unknown;
}

/** Adds the `knex.prepared(tableName)` factory method. */
export const addPreparedFactory = (knex: Knex): Knex & { prepared: PreparedFactory } => {
  const extended = knex as Knex & { prepared: PreparedFactory };

  extended.prepared = function <TRecord extends {} = Record<string, unknown>, TResult = unknown[]>(
    tableName: string
  ): PreparedQueryBuilder<TRecord, TResult> {
    const builder = knex<TRecord, TResult>(tableName);

    // Get the rewriteInClauses option from the knex instance's client
    const knexClient = (knex as unknown as { client: KnexClient }).client;
    const options = knexClient?.[KNEX_PREPARED_OPTIONS_SYMBOL];

    const metadata = {
      name: 'auto' as const,
      rewriteInClauses: options?.rewriteInClauses,
    };

    // Type assertion needed to access internal QueryBuilder methods
    setQueryBuilderMetadata(builder as never, metadata);

    return builder as PreparedQueryBuilder<TRecord, TResult>;
  };

  return extended;
};

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
