import type { Knex } from 'knex';

/**
 * Symbol used to store prepared statement metadata on QueryBuilder instances.
 * Using a Symbol ensures no conflicts with existing Knex properties.
 */
export const PREPARED_SYMBOL = Symbol('knex-prepared');

/**
 * Metadata stored on QueryBuilder instances to track prepared statement configuration.
 */
export interface PreparedMetadata {
  /**
   * The prepared statement name to use.
   * - 'auto': Generate name automatically from SQL hash
   * - string: Use the provided custom name
   * - null: Disable prepared statements for this query
   */
  name: 'auto' | string | null;
}

/**
 * Extends Knex QueryBuilder with the .prepared() chainable method.
 *
 * This function should be called once during initialization to register the
 * prepared() method on all QueryBuilder instances.
 *
 * @param knex - A Knex instance to get access to the QueryBuilder constructor
 *
 * @example
 * ```typescript
 * import Knex from 'knex';
 * import { extendQueryBuilder } from './query-builder';
 *
 * const knex = Knex({ client: 'pg', connection: {...} });
 * extendQueryBuilder(knex);
 * ```
 */
export function extendQueryBuilder(knex: Knex): void {
  // Access QueryBuilder through a Knex instance
  // We create a dummy query to get access to the QueryBuilder constructor
  const dummyQuery = knex.queryBuilder();
  const QueryBuilderConstructor = dummyQuery.constructor as any;

  // Check if already extended to make this function idempotent
  if (QueryBuilderConstructor.prototype.prepared) {
    return;
  }

  QueryBuilderConstructor.extend('prepared', function (this: any, nameOrFlag?: string | boolean) {
    // Handle different argument types:
    // - undefined or true: auto-generate name
    // - false: disable prepared statements
    // - string: use custom name

    let metadata: PreparedMetadata;

    if (nameOrFlag === false) {
      metadata = { name: null };
    } else if (nameOrFlag === undefined || nameOrFlag === true) {
      metadata = { name: 'auto' };
    } else if (typeof nameOrFlag === 'string') {
      metadata = { name: nameOrFlag };
    } else {
      throw new Error(
        `Invalid argument to .prepared(): expected string, boolean, or undefined, got ${typeof nameOrFlag}`
      );
    }

    // Store metadata using Symbol
    this[PREPARED_SYMBOL] = metadata;

    // Return this for chaining
    return this;
  });
}

// TypeScript module augmentation to add .prepared() to Knex types
declare module 'knex' {
  namespace Knex {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
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
