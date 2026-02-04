import { describe, it, expect } from 'vitest';
import Knex from 'knex';
import { knexPrepared, PREPARED_SYMBOL } from './index';
import { getMetadata, getKnexEvents } from './test-utils';
import type { QueryData } from './test-utils';

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
    expect(metadata!.name).toBe('auto');
  });

  it('should work with chainable method', () => {
    const knex = knexPrepared(Knex({ client: 'pg' }));
    const query = knex('users').prepared().select('*');

    const metadata = getMetadata(query);
    expect(metadata).toBeDefined();
    expect(metadata!.name).toBe('auto');
  });

  it('should work with custom names', () => {
    const knex = knexPrepared(Knex({ client: 'pg' }));
    const query = knex('users').prepared('my-custom-name').select('*');

    const metadata = getMetadata(query);
    expect(metadata).toBeDefined();
    expect(metadata!.name).toBe('my-custom-name');
  });

  it('should work with disabled prepared statements', () => {
    const knex = knexPrepared(Knex({ client: 'pg' }));
    const query = knex('users').prepared(false).select('*');

    const metadata = getMetadata(query);
    expect(metadata).toBeDefined();
    expect(metadata!.name).toBeNull();
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

  it('should emit query events with prepared statement names', () => {
    const knex = knexPrepared(Knex({ client: 'pg' }));

    let capturedQueryData: QueryData | null = null;
    knex.on('query', (data) => {
      capturedQueryData = data as QueryData;
    });

    const query = knex.prepared('users').select('*');
    const sql = query.toSQL();
    const metadata = getMetadata(query);

    // Simulate query execution by emitting event with queryContext
    (knex as unknown as { emit: (event: string, data: unknown) => void }).emit('query', {
      sql: sql.sql,
      bindings: sql.bindings,
      queryContext: metadata ? { [PREPARED_SYMBOL]: metadata } : {},
    });

    expect(capturedQueryData).not.toBeNull();
    expect(capturedQueryData!.options?.name).toBeDefined();
    expect(capturedQueryData!.options?.name).toMatch(/^auto-[0-9a-f]{16}$/);
  });

  it('should work with default export', async () => {
    const { default: knexPreparedDefault } = await import('../src/index');
    const knex = knexPreparedDefault(Knex({ client: 'pg' }));

    expect(knex.prepared).toBeDefined();
    const query = knex.prepared('users').select('*');
    expect(getMetadata(query)!.name).toBe('auto');
  });
});
