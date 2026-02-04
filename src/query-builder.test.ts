import { describe, it, expect, beforeAll } from 'vitest';
import Knex from 'knex';
import { extendQueryBuilder } from './query-builder';
import { getMetadata, type QueryBuilderWithMetadata } from './test-utils';

describe('extendQueryBuilder', () => {
  let knex: ReturnType<typeof Knex>;

  beforeAll(() => {
    knex = Knex({ client: 'pg' });
    extendQueryBuilder(knex);
  });

  it('should add .prepared() method to QueryBuilder', () => {
    const query = knex('users').select('*');

    expect(query.prepared).toBeDefined();
    expect(typeof query.prepared).toBe('function');
  });

  it('should return the QueryBuilder instance for chaining', () => {
    const query = knex('users').select('*');
    const result = query.prepared();

    expect(result).toBe(query);
  });

  it('should store "auto" metadata when called with no arguments', () => {
    const query = knex('users').select('*');
    query.prepared();

    const metadata = getMetadata(query);
    expect(metadata).toBeDefined();
    expect(metadata!.name).toBe('auto');
  });

  it('should store "auto" metadata when called with true', () => {
    const query = knex('users').select('*');
    query.prepared(true);

    const metadata = getMetadata(query);
    expect(metadata).toBeDefined();
    expect(metadata!.name).toBe('auto');
  });

  it('should store null metadata when called with false', () => {
    const query = knex('users').select('*');
    query.prepared(false);

    const metadata = getMetadata(query);
    expect(metadata).toBeDefined();
    expect(metadata!.name).toBeNull();
  });

  it('should store custom name when called with string', () => {
    const query = knex('users').select('*');
    query.prepared('custom-statement-name');

    const metadata = getMetadata(query);
    expect(metadata).toBeDefined();
    expect(metadata!.name).toBe('custom-statement-name');
  });

  it('should allow chaining with other query builder methods', () => {
    const query = knex('users').prepared('test').select('*').where('id', 1);

    expect(query).toBeDefined();
    const metadata = getMetadata(query);
    expect(metadata!.name).toBe('test');
  });

  it('should work with different query types', () => {
    // SELECT
    const selectQuery = knex('users').prepared().select('*');
    expect(getMetadata(selectQuery)?.name).toBe('auto');

    // INSERT
    const insertQuery = knex('users').prepared('insert-user').insert({ name: 'test' });
    expect(getMetadata(insertQuery)?.name).toBe('insert-user');

    // UPDATE
    const updateQuery = knex('users').prepared().where('id', 1).update({ name: 'new' });
    expect(getMetadata(updateQuery)?.name).toBe('auto');

    // DELETE
    const deleteQuery = knex('users').prepared(false).where('id', 1).delete();
    expect(getMetadata(deleteQuery)?.name).toBeNull();
  });

  it('should throw error for invalid argument types', () => {
    const query = knex('users').select('*');

    expect(() => {
      (query as QueryBuilderWithMetadata).prepared(123 as never);
    }).toThrow('Invalid argument to .prepared()');

    expect(() => {
      (query as QueryBuilderWithMetadata).prepared({} as never);
    }).toThrow('Invalid argument to .prepared()');
  });

  it('should allow calling .prepared() multiple times (last one wins)', () => {
    const query = knex('users').select('*');

    query.prepared('first');
    expect(getMetadata(query)?.name).toBe('first');

    query.prepared('second');
    expect(getMetadata(query)?.name).toBe('second');

    query.prepared(false);
    expect(getMetadata(query)?.name).toBeNull();
  });
});
