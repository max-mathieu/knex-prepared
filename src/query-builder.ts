import type { KnexClient } from './types';
import { KNEX_PREPARED_OPTIONS_SYMBOL, PREPARED_SYMBOL } from './symbols';
import { Knex } from 'knex';

/**
 * Metadata stored on QueryBuilder instances.
 * - 'auto': Generate name from SQL hash
 * - string: Use custom name
 * - null: Disabled
 */
export interface PreparedMetadata {
  name: 'auto' | string | null;
  /**
   * Whether to rewrite IN clauses to ANY/ALL for this query.
   * Copied from options when .prepared() is called.
   */
  rewriteInClauses?: boolean;
}

/**
 * Type of IN clause rewrite to apply.
 */
export type InClauseRewriteType = 'whereIn' | 'whereNotIn' | 'orWhereIn' | 'orWhereNotIn';

/**
 * QueryBuilder instance with symbol-based property access.
 */
interface QueryBuilderWithSymbol extends Knex.QueryBuilder {
  [PREPARED_SYMBOL]?: PreparedMetadata;
  _knexPreparedMetadata?: PreparedMetadata;
  client: KnexClient;
}

/**
 * Type guard to check if a QueryBuilder has our symbol property.
 */
function isQueryBuilderWithSymbol(builder: unknown): builder is QueryBuilderWithSymbol {
  return (
    typeof builder === 'object' &&
    builder !== null &&
    'queryContext' in builder &&
    typeof builder.queryContext === 'function'
  );
}

/**
 * Stores prepared statement metadata on a QueryBuilder instance in multiple locations
 * for reliability across different code paths (Symbol, queryContext, and direct property).
 */
export const setQueryBuilderMetadata = (
  builder: Knex.QueryBuilder,
  metadata: PreparedMetadata
): void => {
  if (!isQueryBuilderWithSymbol(builder)) {
    throw new Error('Invalid QueryBuilder instance');
  }

  // Store using Symbol
  builder[PREPARED_SYMBOL] = metadata;

  // Store in queryContext for access in query events
  const existingContext = builder.queryContext();
  const contextObj = existingContext && typeof existingContext === 'object' ? existingContext : {};
  const newContext = {
    ...contextObj,
    [PREPARED_SYMBOL]: metadata,
  };
  builder.queryContext(newContext);

  // Store as direct property for additional access path
  builder._knexPreparedMetadata = metadata;
};

/**
 * Gets prepared statement metadata from a QueryBuilder instance.
 */
export const getQueryBuilderMetadata = (
  builder: Knex.QueryBuilder
): PreparedMetadata | undefined => {
  if (!isQueryBuilderWithSymbol(builder)) {
    return undefined;
  }

  return builder[PREPARED_SYMBOL] || builder._knexPreparedMetadata;
};

/**
 * Infers the PostgreSQL array type from a value.
 */
const inferPostgresArrayType = (value: unknown): string => {
  if (typeof value === 'number') {
    return Number.isInteger(value) ? 'int' : 'float';
  }
  if (typeof value === 'string') {
    return 'text';
  }
  if (typeof value === 'boolean') {
    return 'boolean';
  }
  if (value instanceof Date) {
    return 'timestamp';
  }
  return 'text';
};

/**
 * Extends Knex QueryBuilder with the .prepared() chainable method.
 * Also wraps whereIn/whereNotIn methods to replace with ANY if enabled in options.
 * Idempotent - safe to call multiple times.
 */
export const extendQueryBuilder = (knex: Knex): void => {
  const dummyQuery = knex.queryBuilder();
  const QueryBuilderClass = dummyQuery.constructor;

  // Check if prototype has the prepared method already
  if ('prepared' in QueryBuilderClass.prototype) {
    return;
  }

  // Use the static extend method that Knex provides
  const extendMethod = (QueryBuilderClass as { extend?: (name: string, fn: unknown) => void })
    .extend;
  if (!extendMethod) {
    throw new Error('QueryBuilder.extend method not found');
  }

  extendMethod.call(
    QueryBuilderClass,
    'prepared',
    function (this: Knex.QueryBuilder, nameOrFlag?: string | boolean) {
      const name = determineNameValue(nameOrFlag);

      if (!isQueryBuilderWithSymbol(this)) {
        throw new Error('Invalid QueryBuilder instance');
      }

      // Capture rewriteInClauses option from the query builder's client
      const builderOptions = this.client[KNEX_PREPARED_OPTIONS_SYMBOL];
      const metadata: PreparedMetadata = {
        name,
        rewriteInClauses: builderOptions?.rewriteInClauses,
      };
      setQueryBuilderMetadata(this, metadata);
      return this;
    }
  );

  // Wrap whereIn/whereNotIn methods to track usage and optionally rewrite
  const methodsToWrap = ['whereIn', 'whereNotIn', 'orWhereIn', 'orWhereNotIn'] as const;

  for (const methodName of methodsToWrap) {
    const prototype = QueryBuilderClass.prototype as Record<string, unknown>;
    const originalMethod = prototype[methodName];
    if (typeof originalMethod !== 'function') {
      continue;
    }

    prototype[methodName] = function (this: Knex.QueryBuilder, ...args: unknown[]) {
      if (!isQueryBuilderWithSymbol(this)) {
        return originalMethod.apply(this, args);
      }

      // Get current metadata
      const metadata = getQueryBuilderMetadata(this);

      // If rewriteInClauses is enabled in metadata, rewrite to = ANY() / <> ALL()
      if (metadata?.rewriteInClauses && args.length >= 2) {
        const [column, values] = args;

        // Only rewrite if we have an array of values
        if (Array.isArray(values)) {
          const isOr = methodName.startsWith('or');
          const isNot = methodName.includes('Not');

          // Use whereRaw/orWhereRaw with ANY/ALL operator
          const whereRawMethod = isOr ? 'orWhereRaw' : 'whereRaw';
          const operator = isNot ? '<> ALL' : '= ANY';

          // Build the raw SQL expression
          // PostgreSQL ANY/ALL requires casting array to proper type
          const inferredType = inferPostgresArrayType(values[0]);
          const castType = `${inferredType}[]`;

          return this[whereRawMethod](`?? ${operator}(?::${castType})`, [column, values]);
        }
      }

      return originalMethod.apply(this, args);
    };
  }
};

const determineNameValue = (nameOrFlag?: string | boolean): PreparedMetadata['name'] => {
  if (nameOrFlag === false) return null;
  if (nameOrFlag === undefined || nameOrFlag === true) return 'auto';
  if (typeof nameOrFlag === 'string') return nameOrFlag;

  throw new Error(
    `Invalid argument to .prepared(): expected string, boolean, or undefined, got ${typeof nameOrFlag}`
  );
};

// TypeScript module augmentation to add .prepared() to Knex types
declare module 'knex' {
  namespace Knex {
    // Must match Knex's own default type parameters
    // eslint-disable-next-line @typescript-eslint/no-unused-vars, @typescript-eslint/no-explicit-any
    interface QueryBuilder<TRecord = any, TResult = any> {
      /**
       * Enable prepared statements for this query.
       *
       * @param nameOrFlag - Controls prepared statement behavior:
       *   - `undefined` or `true`: Auto-generate name from SQL hash (default)
       *   - `false`: Disable prepared statements for this query
       *   - `string`: Use the provided custom name
       * @returns The QueryBuilder instance for chaining
       *
       * @example
       * ```typescript
       * // Auto-generate name
       * await knex('users').prepared().select('*');
       * await knex('users').prepared(true).select('*');
       *
       * // Custom name
       * await knex('users').prepared('get-all-users').select('*');
       *
       * // Disable prepared statements
       * await knex('users').prepared(false).select('*');
       * ```
       */
      prepared(nameOrFlag?: string | boolean): this;
    }
  }
}
