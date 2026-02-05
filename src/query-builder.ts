import type { KnexWithOptions, ResolvedKnexPreparedOptions } from './types';
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
   * Tracks IN clause rewrites for this query.
   * Key is the column identifier, value is the rewrite type.
   */
  inClauseRewrites?: Map<string, InClauseRewriteType>;
}

/**
 * Type of IN clause rewrite to apply.
 */
export type InClauseRewriteType = 'whereIn' | 'whereNotIn' | 'orWhereIn' | 'orWhereNotIn';

interface QueryBuilderConstructor {
  prototype: {
    prepared?: unknown;
    whereIn: (...args: unknown[]) => unknown;
    whereNotIn: (...args: unknown[]) => unknown;
    orWhereIn: (...args: unknown[]) => unknown;
    orWhereNotIn: (...args: unknown[]) => unknown;
    whereRaw: (...args: unknown[]) => unknown;
    orWhereRaw: (...args: unknown[]) => unknown;
  };
  extend: (
    name: string,
    fn: (this: QueryBuilderInstance, arg?: string | boolean) => unknown
  ) => void;
}

interface QueryBuilderInstance {
  [key: symbol]: PreparedMetadata | boolean | ResolvedKnexPreparedOptions;
  [key: string]: unknown;
  queryContext: (context?: unknown) => unknown;
  _knexPreparedMetadata?: PreparedMetadata;
  client: KnexClient;
  whereIn: (...args: unknown[]) => unknown;
  whereNotIn: (...args: unknown[]) => unknown;
  orWhereIn: (...args: unknown[]) => unknown;
  orWhereNotIn: (...args: unknown[]) => unknown;
  whereRaw: (...args: unknown[]) => unknown;
  orWhereRaw: (...args: unknown[]) => unknown;
}

interface KnexClient {
  [KNEX_PREPARED_OPTIONS_SYMBOL]: ResolvedKnexPreparedOptions;
  [key: string]: unknown;
}

/**
 * Stores prepared statement metadata on a QueryBuilder instance in multiple locations
 * for reliability across different code paths (Symbol, queryContext, and direct property).
 * Also merges the whereIn usage flag if it was set.
 */
export const setQueryBuilderMetadata = (
  builder: QueryBuilderInstance,
  metadata: PreparedMetadata
): void => {
  // Store using Symbol
  builder[PREPARED_SYMBOL] = metadata;

  // Store in queryContext for access in query events
  const existingContext = (builder.queryContext() as Record<symbol, unknown> | undefined) || {};
  const newContext = {
    ...existingContext,
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
  builder: QueryBuilderInstance
): PreparedMetadata | undefined => {
  const metadata = (builder[PREPARED_SYMBOL] as PreparedMetadata) || builder._knexPreparedMetadata;

  return metadata;
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
  const QueryBuilderConstructor = dummyQuery.constructor as unknown as QueryBuilderConstructor;

  const options = (knex as KnexWithOptions)[KNEX_PREPARED_OPTIONS_SYMBOL];

  // Store options on the client so query builders can access them at runtime
  const knexClient = (knex as unknown as { client: KnexClient }).client;
  knexClient[KNEX_PREPARED_OPTIONS_SYMBOL] = options;

  if (QueryBuilderConstructor.prototype.prepared) {
    return;
  }

  QueryBuilderConstructor.extend(
    'prepared',
    function (this: QueryBuilderInstance, nameOrFlag?: string | boolean) {
      const name = determineNameValue(nameOrFlag);
      const metadata: PreparedMetadata = { name };
      setQueryBuilderMetadata(this, metadata);
      return this;
    }
  );

  // Wrap whereIn/whereNotIn methods to track usage and optionally rewrite
  const methodsToWrap = ['whereIn', 'whereNotIn', 'orWhereIn', 'orWhereNotIn'] as const;

  for (const methodName of methodsToWrap) {
    const originalMethod = QueryBuilderConstructor.prototype[methodName];
    QueryBuilderConstructor.prototype[methodName] = function (...args: unknown[]) {
      const builder = this as QueryBuilderInstance;

      // Get options from the client at runtime (not from closure)
      const runtimeOptions = builder.client?.[KNEX_PREPARED_OPTIONS_SYMBOL] as ResolvedKnexPreparedOptions | undefined;

      // Get current metadata
      const metadata = getQueryBuilderMetadata(builder);

      // If rewriteInClauses is enabled, rewrite to = ANY() / <> ALL()
      if (runtimeOptions?.rewriteInClauses && args.length >= 2) {
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

      // Track that IN clause was used (for warning messages)
      if (metadata) {
        if (!metadata.inClauseRewrites) {
          metadata.inClauseRewrites = new Map();
        }
        metadata.inClauseRewrites.set(methodName, methodName as InClauseRewriteType);
        setQueryBuilderMetadata(builder, metadata);
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
