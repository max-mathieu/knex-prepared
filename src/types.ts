import { Knex } from 'knex';
import { KNEX_PREPARED_OPTIONS_SYMBOL } from './symbols';

/**
 * Configuration options for knex-prepared.
 */
export interface KnexPreparedOptions {
  /**
   * Prefix for auto-generated prepared statement names.
   * @default 'auto'
   */
  autoNamePrefix?: string;

  /**
   * Length of hash to use in auto-generated names.
   * Must be between 1 and 64.
   * @default 16
   */
  autoNameHashLength?: number;

  /**
   * Automatically name prepare SELECT queries without calling .prepared().
   * @default false
   */
  autoNameAllSelects?: boolean;

  /**
   * Whether to rewrite IN clauses to = ANY() for better prepared statement caching.
   * Only applies to PostgreSQL.
   * @default false
   */
  rewriteInClauses?: boolean;

  /**
   * Disable warnings for prepared queries with IN clauses when rewriteInClauses is false.
   * Defaults to true in production, false otherwise.
   * @default process.env.NODE_ENV === 'production'
   */
  disableWarnings?: boolean;

  /**
   * Maximum number of SQL statements to cache for auto-name hash generation.
   * Uses an LRU cache to avoid re-hashing the same SQL repeatedly.
   * Set to 0 to disable caching.
   * @default 1000
   */
  autoNameCacheSize?: number;
}

/**
 * Resolved configuration options with all defaults applied.
 */
export interface ResolvedKnexPreparedOptions {
  autoNamePrefix: string;
  autoNameHashLength: number;
  autoNameAllSelects: boolean;
  rewriteInClauses: boolean;
  disableWarnings: boolean;
  autoNameCacheSize: number;
}

/**
 * Knex instance with symbol property for storing options.
 */
export interface KnexWithSymbol {
  [key: symbol]: unknown;
}

export interface KnexWithOptions extends Knex, KnexWithSymbol {
  [KNEX_PREPARED_OPTIONS_SYMBOL]: ResolvedKnexPreparedOptions;
}

/**
 * Knex client interface with options symbol.
 */
export interface KnexClient {
  [KNEX_PREPARED_OPTIONS_SYMBOL]?: ResolvedKnexPreparedOptions;
  [key: string]: unknown;
}

/**
 * Knex instance with client property exposed.
 */
export interface KnexWithClient extends Knex {
  client: KnexClient;
}

/**
 * Type guard to check if a Knex instance has options configured.
 */
export function hasOptions(knex: Knex): knex is KnexWithOptions {
  const knexWithSymbol = knex as unknown as KnexWithSymbol;
  return KNEX_PREPARED_OPTIONS_SYMBOL in knexWithSymbol;
}

/**
 * Gets options from a Knex instance, throwing if not configured.
 */
export function getOptions(knex: Knex): ResolvedKnexPreparedOptions {
  if (!hasOptions(knex)) {
    throw new Error('knex-prepared options not found. Did you call knexPrepared()?');
  }
  return knex[KNEX_PREPARED_OPTIONS_SYMBOL];
}

/**
 * Sets options on a Knex instance.
 */
export function setOptions(knex: Knex, options: ResolvedKnexPreparedOptions): void {
  const knexWithSymbol = knex as unknown as KnexWithSymbol;
  knexWithSymbol[KNEX_PREPARED_OPTIONS_SYMBOL] = options;
}

/**
 * Gets options from a Knex client.
 */
export function getClientOptions(client: KnexClient): ResolvedKnexPreparedOptions | undefined {
  return client[KNEX_PREPARED_OPTIONS_SYMBOL];
}
