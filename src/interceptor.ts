import type { Knex } from 'knex';
import { PREPARED_SYMBOL, type PreparedMetadata } from './query-builder';
import { generatePreparedStatementName } from './hash';

interface QueryData {
  queryContext?: { [PREPARED_SYMBOL]?: PreparedMetadata };
  sql?: string | unknown;
  options?: Record<string, unknown>;
}

/**
 * Attaches a query event hook to inject prepared statement names before execution.
 * For PostgreSQL, the `name` property tells the pg driver to use prepared statements.
 */
export function attachPreparedStatementHook(knex: Knex): void {
  knex.on('query', (queryData: QueryData) => {
    const metadata = queryData.queryContext?.[PREPARED_SYMBOL];

    if (!metadata || metadata.name === null) {
      return;
    }

    let preparedName: string;
    if (metadata.name === 'auto') {
      if (typeof queryData.sql !== 'string') {
        return;
      }
      preparedName = generatePreparedStatementName(queryData.sql);
    } else {
      preparedName = metadata.name;
    }

    // Set name in options object (not directly on queryData)
    // The pg driver expects: queryConfig = extend(queryConfig, obj.options)
    queryData.options = queryData.options || {};
    queryData.options.name = preparedName;
  });
}
