import type { Knex } from 'knex';
import { PREPARED_SYMBOL, type PreparedMetadata } from './query-builder';
import { generatePreparedStatementName } from './hash';

/**
 * Type for query data passed to Knex query event handlers
 */
interface QueryData {
  __knexQueryBuilder?: {
    [PREPARED_SYMBOL]?: PreparedMetadata;
  };
  sql?: string | unknown;
  name?: string;
  bindings?: unknown[];
}

/**
 * Attaches a query event hook to intercept queries and inject prepared statement names.
 *
 * This function hooks into Knex's 'query' event, which fires before each query execution.
 * It checks if the query builder has prepared statement metadata (stored via the Symbol),
 * and if so, modifies the query configuration to include the prepared statement name.
 *
 * For PostgreSQL, the `name` property in the query config tells the pg driver to use
 * prepared statements. The pg driver automatically handles caching and reuse.
 *
 * @param knex - The Knex instance to attach the hook to
 *
 * @example
 * ```typescript
 * import Knex from 'knex';
 * import { attachPreparedStatementHook } from './interceptor';
 *
 * const knex = Knex({ client: 'pg', connection: {...} });
 * attachPreparedStatementHook(knex);
 * ```
 */
export function attachPreparedStatementHook(knex: Knex): void {
  knex.on('query', (queryData: QueryData) => {
    // Get the builder instance if available
    // The queryData object may contain a __knexQueryUid or builder reference
    const builder = queryData.__knexQueryBuilder;

    if (!builder) {
      // No builder available, can't check for prepared metadata
      return;
    }

    // Check if the builder has prepared statement metadata
    const metadata = builder[PREPARED_SYMBOL] as PreparedMetadata | undefined;

    if (!metadata) {
      // No prepared statement requested
      return;
    }

    if (metadata.name === null) {
      // Explicitly disabled prepared statements
      return;
    }

    // Determine the final prepared statement name
    let preparedName: string;

    if (metadata.name === 'auto') {
      // Auto-generate from SQL hash
      const sql = queryData.sql;
      if (typeof sql !== 'string') {
        // Can't generate name without SQL string
        return;
      }
      preparedName = generatePreparedStatementName(sql);
    } else {
      // Use custom name
      preparedName = metadata.name;
    }

    // Inject the prepared statement name into the query config
    // For pg driver, setting the 'name' property enables prepared statements
    queryData.name = preparedName;
  });
}
