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
   * Only applies to PostgreSQL.
   * @default false
   */
  rewriteInClauses?: boolean;

  /**
   * Automatically prepare SELECT queries without calling .prepared().
   * @default false
   */
  autoNameSelects?: boolean;

  /**
   * Disable warnings for prepared queries with IN clauses when rewriteInClauses is false.
   * Defaults to true in production, false otherwise.
   * @default process.env.NODE_ENV === 'production'
   */
  disableInClausesWarning?: boolean;
}

/**
 * Resolved configuration options with all defaults applied.
 */
export interface ResolvedKnexPreparedOptions {
  autoPrefix: string;
  autoHashLength: number;
  rewriteInClauses: boolean;
  autoNameSelects: boolean;
  disableInClausesWarning: boolean;
}
