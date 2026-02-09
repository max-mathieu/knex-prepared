import { describe, it, expect, beforeAll } from 'vitest';
import Knex from 'knex';
import { addPreparedFactory, type PreparedFactory } from './factory';
import { extendQueryBuilder } from './query-builder';
import { getMetadata } from './test-utils';

describe('addPreparedFactory', () => {
  let knex: ReturnType<typeof Knex> & { prepared: PreparedFactory };

  beforeAll(() => {
    const baseKnex = Knex({ client: 'pg' });
    extendQueryBuilder(baseKnex);
    knex = addPreparedFactory(baseKnex);
  });

  it('should add .prepared() factory method to Knex instance', () => {
    expect(knex.prepared).toBeDefined();
    expect(typeof knex.prepared).toBe('function');
  });

  it('should create a QueryBuilder with prepared metadata', () => {
    const query = knex.prepared('users');

    expect(query).toBeDefined();
    const metadata = getMetadata(query);
    expect(metadata).toBeDefined();
    expect(metadata?.name).toBe('auto');
  });

  it('should return a chainable QueryBuilder', () => {
    const query = knex.prepared('users').select('*').where('id', 1);

    expect(query).toBeDefined();
    const metadata = getMetadata(query);
    expect(metadata?.name).toBe('auto');
  });

  it('should work with different table names', () => {
    const usersQuery = knex.prepared('users');
    const postsQuery = knex.prepared('posts');

    expect(getMetadata(usersQuery)?.name).toBe('auto');
    expect(getMetadata(postsQuery)?.name).toBe('auto');
  });

  it('should allow further chaining with .prepared() method', () => {
    // Start with factory, then override with chainable method
    const query = knex.prepared('users').prepared('custom-name');

    const metadata = getMetadata(query);
    expect(metadata?.name).toBe('custom-name');
  });

  it('should allow disabling prepared statements after factory call', () => {
    const query = knex.prepared('users').prepared(false);

    const metadata = getMetadata(query);
    expect(metadata?.name).toBeNull();
  });
});
