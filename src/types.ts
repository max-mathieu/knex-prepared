/**
 * Configuration options for knex-prepared.
 */
export interface KnexPreparedOptions {
  /**
   * Prefix for auto-generated prepared statement names.
   * @default 'auto'
   */
  autoPrefix?: string;

  /**
   * Length of hash to use in auto-generated names.
   * Must be between 1 and 64.
   * @default 16
   */
  autoHashLength?: number;

  /**
   * Whether to rewrite IN clauses to = ANY() for better prepared statement caching.
   * Only applies to PostgreSQL. Defaults to true for PostgreSQL clients.
   * @default true (PostgreSQL), false (others)
   */
  rewriteInClauses?: boolean;
}

/**
 * Resolved configuration options with all defaults applied.
 */
export interface ResolvedKnexPreparedOptions {
  autoPrefix: string;
  autoHashLength: number;
  rewriteInClauses: boolean;
}
