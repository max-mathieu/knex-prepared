import type { Knex } from 'knex';

/** Symbol used to store prepared statement metadata on QueryBuilder instances. */
export const PREPARED_SYMBOL = Symbol('knex-prepared');

/**
 * Metadata stored on QueryBuilder instances.
 * - 'auto': Generate name from SQL hash
 * - string: Use custom name
 * - null: Disabled
 */
export interface PreparedMetadata {
  name: 'auto' | string | null;
}

interface QueryBuilderConstructor {
  prototype: { prepared?: unknown };
  extend: (
    name: string,
    fn: (this: QueryBuilderInstance, arg?: string | boolean) => unknown
  ) => void;
}

interface QueryBuilderInstance {
  [key: symbol]: PreparedMetadata;
}

/**
 * Extends Knex QueryBuilder with the .prepared() chainable method.
 * Idempotent - safe to call multiple times.
 */
export const extendQueryBuilder = (knex: Knex): void => {
  const dummyQuery = knex.queryBuilder();
  const QueryBuilderConstructor = dummyQuery.constructor as unknown as QueryBuilderConstructor;

  if (QueryBuilderConstructor.prototype.prepared) {
    return;
  }

  QueryBuilderConstructor.extend(
    'prepared',
    function (this: QueryBuilderInstance, nameOrFlag?: string | boolean) {
      const name = determineNameValue(nameOrFlag);
      const metadata: PreparedMetadata = { name };
      this[PREPARED_SYMBOL] = metadata;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const self = this as any;
      const existingContext = self.queryContext() || {};
      const newContext = { ...existingContext, [PREPARED_SYMBOL]: metadata };
      self.queryContext(newContext);

      return this;
    }
  );
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
