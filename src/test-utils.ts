import type { Knex } from 'knex';
import type { PreparedMetadata } from './query-builder';
import type { KnexWithOptions, ResolvedKnexPreparedOptions } from './types';
import { PREPARED_SYMBOL, KNEX_PREPARED_OPTIONS_SYMBOL } from './symbols';

export interface KnexInternal extends Knex {
  _events?: { query?: unknown; [key: string]: unknown };
}

export interface QueryBuilderWithMetadata extends Knex.QueryBuilder {
  [PREPARED_SYMBOL]?: PreparedMetadata;
}

export interface QueryData {
  sql: string;
  bindings: unknown[];
  options?: { name?: string; [key: string]: unknown };
  queryContext?: { [PREPARED_SYMBOL]?: PreparedMetadata };
  [key: string]: unknown;
}

export const getMetadata = (query: Knex.QueryBuilder): PreparedMetadata | undefined => {
  return (query as QueryBuilderWithMetadata)[PREPARED_SYMBOL];
};

export const getKnexEvents = (knex: Knex): KnexInternal['_events'] => {
  return (knex as KnexInternal)._events;
};

export const getOptions = (knex: Knex): ResolvedKnexPreparedOptions | undefined => {
  return (knex as KnexWithOptions)[KNEX_PREPARED_OPTIONS_SYMBOL];
};
