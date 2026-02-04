import type { Knex } from 'knex';
import type { PreparedMetadata } from './query-builder';
import { PREPARED_SYMBOL } from './query-builder';

export interface KnexInternal extends Knex {
  _events?: { query?: unknown; [key: string]: unknown };
}

export interface QueryBuilderWithMetadata extends Knex.QueryBuilder {
  [PREPARED_SYMBOL]?: PreparedMetadata;
}

export interface QueryData {
  sql: string;
  bindings: unknown[];
  name?: string;
  __knexQueryBuilder?: Partial<QueryBuilderWithMetadata>;
  [key: string]: unknown;
}

export function getMetadata(query: Knex.QueryBuilder): PreparedMetadata | undefined {
  return (query as QueryBuilderWithMetadata)[PREPARED_SYMBOL];
}

export function getKnexEvents(knex: Knex): KnexInternal['_events'] {
  return (knex as KnexInternal)._events;
}
