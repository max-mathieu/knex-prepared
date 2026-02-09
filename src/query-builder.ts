import { Knex } from 'knex';
import { PREPARED_SYMBOL } from './symbols';
import { getOptions, type KnexClient } from './types';

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
 * QueryBuilder instance with access to client and queryContext.
 */
interface QueryBuilderWithClient {
  client: KnexClient;
  queryContext(context?: unknown): unknown;
}

/**
 * Type guard to check if a value is a QueryBuilder.
 */
function isQueryBuilder(builder: unknown): builder is QueryBuilderWithClient {
  return (
    typeof builder === 'object' &&
    builder !== null &&
    'queryContext' in builder &&
    typeof (builder as QueryBuilderWithClient).queryContext === 'function'
  );
}

/**
 * Stores prepared statement metadata on a QueryBuilder instance via queryContext.
 */
export const setQueryBuilderMetadata = (
  builder: Knex.QueryBuilder,
  metadata: PreparedMetadata
): void => {
  if (!isQueryBuilder(builder)) {
    throw new Error('Invalid QueryBuilder instance');
  }

  const existingContext = builder.queryContext();
  const contextObj = existingContext && typeof existingContext === 'object' ? existingContext : {};
  const newContext = {
    ...contextObj,
    [PREPARED_SYMBOL]: metadata,
  };
  builder.queryContext(newContext);
};

/**
 * Gets prepared statement metadata from a QueryBuilder instance.
 */
export const getQueryBuilderMetadata = (
  builder: Knex.QueryBuilder
): PreparedMetadata | undefined => {
  if (!isQueryBuilder(builder)) {
    return undefined;
  }

  const context = builder.queryContext();
  if (context && typeof context === 'object') {
    const contextWithSymbol = context as { [PREPARED_SYMBOL]?: PreparedMetadata };
    return contextWithSymbol[PREPARED_SYMBOL];
  }

  return undefined;
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
 * Determines the name value from the .prepared() argument.
 */
const determineNameValue = (nameOrFlag?: string | boolean): PreparedMetadata['name'] => {
  if (nameOrFlag === false) return null;
  if (nameOrFlag === undefined || nameOrFlag === true) return 'auto';
  if (typeof nameOrFlag === 'string') return nameOrFlag;

  throw new Error(
    `Invalid argument to .prepared(): expected string, boolean, or undefined, got ${typeof nameOrFlag}`
  );
};

/**
 * QueryBuilder class with extend method.
 */
interface QueryBuilderClass {
  extend(methodName: string, fn: unknown): void;
  prototype: Record<string, unknown>;
}

/**
 * Extends Knex QueryBuilder with the .prepared() chainable method.
 * Uses Knex's global QueryBuilder.extend() API, which automatically works for all query builders
 * including transactions.
 * Idempotent - safe to call multiple times.
 */
export const extendQueryBuilder = (knex: Knex): void => {
  // Get the QueryBuilder constructor from a dummy instance
  const dummyBuilder = knex.queryBuilder();
  const QueryBuilderConstructor = dummyBuilder.constructor as unknown as QueryBuilderClass;

  // Check if already extended
  if ('prepared' in QueryBuilderConstructor.prototype) {
    return;
  }

  // Extend with .prepared() method
  QueryBuilderConstructor.extend(
    'prepared',
    function (this: Knex.QueryBuilder, nameOrFlag?: string | boolean) {
      const name = determineNameValue(nameOrFlag);

      if (!isQueryBuilder(this)) {
        throw new Error('Invalid QueryBuilder instance');
      }

      // Get options from the query builder's client
      const options = getOptions(this.client);

      const metadata: PreparedMetadata = {
        name,
        rewriteInClauses: options?.rewriteInClauses,
      };

      setQueryBuilderMetadata(this, metadata);
      return this;
    }
  );

  // Wrap whereIn/whereNotIn methods to optionally rewrite to = ANY() / <> ALL()
  const methodsToWrap = ['whereIn', 'whereNotIn', 'orWhereIn', 'orWhereNotIn'] as const;

  for (const methodName of methodsToWrap) {
    const prototype = QueryBuilderConstructor.prototype;
    const originalMethod = prototype[methodName];
    if (typeof originalMethod !== 'function') {
      continue;
    }

    prototype[methodName] = function (this: Knex.QueryBuilder, ...args: unknown[]) {
      if (!isQueryBuilder(this)) {
        return originalMethod.apply(this, args);
      }

      // Get current metadata
      const metadata = getQueryBuilderMetadata(this);

      // If rewriteInClauses is enabled, rewrite to = ANY() / <> ALL()
      if (metadata?.rewriteInClauses && args.length >= 2) {
        const [column, values] = args;

        // Only rewrite if we have an array of values
        if (Array.isArray(values) && values.length > 0) {
          const isOr = methodName.startsWith('or');
          const isNot = methodName.includes('Not');

          // Use whereRaw/orWhereRaw with ANY/ALL operator
          const operator = isNot ? '<> ALL' : '= ANY';

          // Build the raw SQL expression
          // PostgreSQL ANY/ALL requires casting array to proper type
          const inferredType = inferPostgresArrayType(values[0]);
          const castType = `${inferredType}[]`;

          // Call whereRaw or orWhereRaw
          if (isOr) {
            return this.orWhereRaw(`?? ${operator}(?::${castType})`, [column, values]);
          } else {
            return this.whereRaw(`?? ${operator}(?::${castType})`, [column, values]);
          }
        }
      }

      return originalMethod.apply(this, args);
    };
  }
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
