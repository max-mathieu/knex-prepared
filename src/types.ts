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
}
