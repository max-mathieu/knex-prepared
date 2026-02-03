import type { Knex } from 'knex';
import type { PreparedMetadata } from '../src/query-builder';
import { PREPARED_SYMBOL } from '../src/query-builder';

/**
 * Type for accessing internal Knex properties in tests
 */
export interface KnexInternal extends Knex {
  _events?: {
    query?: unknown;
    [key: string]: unknown;
  };
}

/**
 * Type for accessing prepared statement metadata in tests
 */
export interface QueryBuilderWithMetadata extends Knex.QueryBuilder {
  [PREPARED_SYMBOL]?: PreparedMetadata;
}

/**
 * Helper to safely access prepared statement metadata from a query builder
 */
export function getMetadata(query: Knex.QueryBuilder): PreparedMetadata | undefined {
  return (query as QueryBuilderWithMetadata)[PREPARED_SYMBOL];
}

/**
 * Helper to safely access Knex internal events
 */
export function getKnexEvents(knex: Knex): KnexInternal['_events'] {
  return (knex as KnexInternal)._events;
}
