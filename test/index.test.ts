import { describe, it, expect } from 'vitest';
import Knex from 'knex';
import { knexPrepared } from '../src/index';
import { getMetadata, getKnexEvents } from './test-utils';

describe('knexPrepared integration', () => {
  it('should initialize all features in one call', () => {
    const knex = knexPrepared(Knex({ client: 'pg' }));

    // Factory method should exist
    expect(knex.prepared).toBeDefined();
    expect(typeof knex.prepared).toBe('function');

    // Chainable method should exist
    const query = knex('users');
    expect(query.prepared).toBeDefined();
    expect(typeof query.prepared).toBe('function');

    // Query event listeners should be attached
    const listeners = getKnexEvents(knex)?.query;
    expect(listeners).toBeDefined();
  });

  it('should work with factory method', () => {
    const knex = knexPrepared(Knex({ client: 'pg' }));
    const query = knex.prepared('users').select('*');

    const metadata = getMetadata(query);
    expect(metadata).toBeDefined();
    expect(metadata.name).toBe('auto');
  });

  it('should work with chainable method', () => {
    const knex = knexPrepared(Knex({ client: 'pg' }));
    const query = knex('users').prepared().select('*');

    const metadata = getMetadata(query);
    expect(metadata).toBeDefined();
    expect(metadata.name).toBe('auto');
  });

  it('should work with custom names', () => {
    const knex = knexPrepared(Knex({ client: 'pg' }));
    const query = knex('users').prepared('my-custom-name').select('*');

    const metadata = getMetadata(query);
    expect(metadata).toBeDefined();
    expect(metadata.name).toBe('my-custom-name');
  });

  it('should work with disabled prepared statements', () => {
    const knex = knexPrepared(Knex({ client: 'pg' }));
    const query = knex('users').prepared(false).select('*');

    const metadata = getMetadata(query);
    expect(metadata).toBeDefined();
    expect(metadata.name).toBeNull();
  });

  it('should allow combining factory and chainable methods', () => {
    const knex = knexPrepared(Knex({ client: 'pg' }));

    // Factory then override with chainable
    const query1 = knex.prepared('users').prepared('custom');
    expect(getMetadata(query1)?.name).toBe('custom');

    // Factory then disable
    const query2 = knex.prepared('users').prepared(false);
    expect(getMetadata(query2)?.name).toBeNull();
  });

  it('should handle complex queries', () => {
    const knex = knexPrepared(Knex({ client: 'pg' }));

    const query = knex
      .prepared('users')
      .select('users.*', 'posts.title')
      .leftJoin('posts', 'users.id', 'posts.user_id')
      .where('users.active', true)
      .whereIn('users.role', ['admin', 'user'])
      .orderBy('users.created_at', 'desc')
      .limit(10)
      .offset(20);

    const metadata = getMetadata(query);
    expect(metadata.name).toBe('auto');

    const sql = query.toSQL();
    expect(sql.sql).toContain('select');
    expect(sql.sql).toContain('left join');
    expect(sql.sql).toContain('where');
  });

  it('should work with different query types', () => {
    const knex = knexPrepared(Knex({ client: 'pg' }));

    // SELECT
    const select = knex.prepared('users').select('*');
    expect(getMetadata(select)?.name).toBe('auto');

    // INSERT
    const insert = knex.prepared('users').insert({ name: 'test', email: 'test@test.com' });
    expect(getMetadata(insert)?.name).toBe('auto');

    // UPDATE
    const update = knex.prepared('users').where('id', 1).update({ name: 'updated' });
    expect(getMetadata(update)?.name).toBe('auto');

    // DELETE
    const del = knex.prepared('users').where('id', 1).delete();
    expect(getMetadata(del)?.name).toBe('auto');
  });

  it('should emit query events with prepared statement names', () => {
    const knex = knexPrepared(Knex({ client: 'pg' }));

    let capturedQueryData: unknown = null;
    knex.on('query', (data) => {
      capturedQueryData = data;
    });

    const query = knex.prepared('users').select('*');
    const sql = query.toSQL();

    // Simulate query execution by emitting event with builder
    (knex as unknown as { emit: (event: string, data: unknown) => void }).emit('query', {
      sql: sql.sql,
      bindings: sql.bindings,
      __knexQueryBuilder: query,
    });

    expect(capturedQueryData).not.toBeNull();
    expect(capturedQueryData.name).toBeDefined();
    expect(capturedQueryData.name).toMatch(/^auto-[0-9a-f]{16}$/);
  });

  it('should preserve Knex instance type and methods', () => {
    const baseKnex = Knex({ client: 'pg' });
    const knex = knexPrepared(baseKnex);

    // Standard Knex methods should still exist
    expect(typeof knex.select).toBe('function');
    expect(typeof knex.raw).toBe('function');
    expect(typeof knex.transaction).toBe('function');
    expect(typeof knex.destroy).toBe('function');
    expect(typeof knex.schema).toBe('object');
  });

  it('should work with default export', async () => {
    const { default: knexPreparedDefault } = await import('../src/index');
    const knex = knexPreparedDefault(Knex({ client: 'pg' }));

    expect(knex.prepared).toBeDefined();
    const query = knex.prepared('users').select('*');
    expect(getMetadata(query).name).toBe('auto');
  });
});
