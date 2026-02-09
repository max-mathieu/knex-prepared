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
 * Knex client interface with options symbol.
 */
export interface KnexClient extends Knex.Client {
  [KNEX_PREPARED_OPTIONS_SYMBOL]?: ResolvedKnexPreparedOptions;
}

/**
 * Type for objects that can have symbol properties.
 */
export interface WithSymbol {
  [key: symbol]: unknown;
}

/**
 * Gets options from a Knex client.
 */
export function getOptions(client: Knex.Client): ResolvedKnexPreparedOptions | undefined {
  const clientWithSymbol = client as unknown as WithSymbol;
  return clientWithSymbol[KNEX_PREPARED_OPTIONS_SYMBOL] as ResolvedKnexPreparedOptions | undefined;
}

/**
 * Sets options on a Knex client.
 */
export function setOptions(client: Knex.Client, options: ResolvedKnexPreparedOptions): void {
  const clientWithSymbol = client as unknown as WithSymbol;
  clientWithSymbol[KNEX_PREPARED_OPTIONS_SYMBOL] = options;
}
