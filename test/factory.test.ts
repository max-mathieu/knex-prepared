import { describe, it, expect, beforeAll } from 'vitest';
import Knex from 'knex';
import { addPreparedFactory } from '../src/factory';
import { extendQueryBuilder, PREPARED_SYMBOL } from '../src/query-builder';
import type { PreparedMetadata } from '../src/query-builder';

describe('addPreparedFactory', () => {
  let knex: ReturnType<typeof Knex> & { prepared: any };

  beforeAll(() => {
    const baseKnex = Knex({ client: 'pg' });
    extendQueryBuilder(baseKnex);
    knex = addPreparedFactory(baseKnex) as any;
  });

  it('should add .prepared() factory method to Knex instance', () => {
    expect(knex.prepared).toBeDefined();
    expect(typeof knex.prepared).toBe('function');
  });

  it('should create a QueryBuilder with prepared metadata', () => {
    const query = knex.prepared('users');

    expect(query).toBeDefined();
    const metadata = (query as any)[PREPARED_SYMBOL] as PreparedMetadata;
    expect(metadata).toBeDefined();
    expect(metadata.name).toBe('auto');
  });

  it('should return a chainable QueryBuilder', () => {
    const query = knex.prepared('users').select('*').where('id', 1);

    expect(query).toBeDefined();
    const metadata = (query as any)[PREPARED_SYMBOL] as PreparedMetadata;
    expect(metadata.name).toBe('auto');
  });

  it('should work with different table names', () => {
    const usersQuery = knex.prepared('users');
    const postsQuery = knex.prepared('posts');

    expect((usersQuery as any)[PREPARED_SYMBOL].name).toBe('auto');
    expect((postsQuery as any)[PREPARED_SYMBOL].name).toBe('auto');
  });

  it('should allow further chaining with .prepared() method', () => {
    // Start with factory, then override with chainable method
    const query = knex.prepared('users').prepared('custom-name');

    const metadata = (query as any)[PREPARED_SYMBOL] as PreparedMetadata;
    expect(metadata.name).toBe('custom-name');
  });

  it('should allow disabling prepared statements after factory call', () => {
    const query = knex.prepared('users').prepared(false);

    const metadata = (query as any)[PREPARED_SYMBOL] as PreparedMetadata;
    expect(metadata.name).toBeNull();
  });

  it('should create valid QueryBuilder that can be built to SQL', () => {
    const query = knex.prepared('users').select('id', 'name').where('active', true);

    // toSQL() should work
    const sql = query.toSQL();
    expect(sql).toBeDefined();
    expect(sql.sql).toContain('select');
    expect(sql.sql).toContain('users');
  });

  it('should preserve QueryBuilder methods', () => {
    const query = knex.prepared('users');

    // Check that standard QueryBuilder methods exist
    expect(typeof query.select).toBe('function');
    expect(typeof query.where).toBe('function');
    expect(typeof query.insert).toBe('function');
    expect(typeof query.update).toBe('function');
    expect(typeof query.delete).toBe('function');
    expect(typeof query.first).toBe('function');
  });

  it('should work with complex query building', () => {
    const query = knex
      .prepared('users')
      .select('users.id', 'users.name')
      .join('posts', 'users.id', 'posts.user_id')
      .where('users.active', true)
      .where('posts.published', true)
      .orderBy('users.created_at', 'desc')
      .limit(10);

    expect(query).toBeDefined();
    const metadata = (query as any)[PREPARED_SYMBOL] as PreparedMetadata;
    expect(metadata.name).toBe('auto');

    const sql = query.toSQL();
    expect(sql.sql).toContain('join');
    expect(sql.sql).toContain('order by');
  });

  it('should support different query types', () => {
    // SELECT
    const selectQuery = knex.prepared('users').select('*');
    expect((selectQuery as any)[PREPARED_SYMBOL].name).toBe('auto');

    // INSERT
    const insertQuery = knex.prepared('users').insert({ name: 'test' });
    expect((insertQuery as any)[PREPARED_SYMBOL].name).toBe('auto');

    // UPDATE
    const updateQuery = knex.prepared('users').where('id', 1).update({ name: 'new' });
    expect((updateQuery as any)[PREPARED_SYMBOL].name).toBe('auto');

    // DELETE
    const deleteQuery = knex.prepared('users').where('id', 1).delete();
    expect((deleteQuery as any)[PREPARED_SYMBOL].name).toBe('auto');
  });
});
