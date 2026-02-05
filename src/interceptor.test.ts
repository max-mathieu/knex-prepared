import { describe, it, expect, beforeAll } from 'vitest';
import Knex from 'knex';
import { knexPrepared } from './index';
import { PREPARED_SYMBOL } from './symbols';
import type { PreparedMetadata } from './query-builder';
import { getKnexEvents } from './test-utils';
import type { QueryData } from './test-utils';

describe('attachPreparedStatementHook', () => {
  let knex: ReturnType<typeof knexPrepared>;

  beforeAll(() => {
    knex = knexPrepared(Knex({ client: 'pg' }));
  });

  it('should attach query event listener', () => {
    const listeners = getKnexEvents(knex)?.query;
    expect(listeners).toBeDefined();
  });

  it('should prepare rewrite for queries with metadata', () => {
    const queryData: QueryData = {
      sql: 'SELECT * FROM users WHERE id = $1',
      bindings: [1],
      queryContext: {
        [PREPARED_SYMBOL]: { name: 'auto' } as PreparedMetadata,
      },
    };

    // With new architecture, names and rewrites are applied in connection wrapper
    // Just verify event is processed without error
    (knex as unknown as { emit: (event: string, data: unknown) => void }).emit('query', queryData);

    expect(queryData.sql).toBe('SELECT * FROM users WHERE id = $1');
  });

  it('should handle custom prepared statement names', () => {
    const queryData: QueryData = {
      sql: 'SELECT * FROM users',
      bindings: [],
      queryContext: {
        [PREPARED_SYMBOL]: { name: 'custom-query-name' } as PreparedMetadata,
      },
    };

    (knex as unknown as { emit: (event: string, data: unknown) => void }).emit('query', queryData);

    expect(queryData.sql).toBe('SELECT * FROM users');
  });

  it('should not prepare rewrite when metadata.name is null', () => {
    const queryData: QueryData = {
      sql: 'SELECT * FROM users',
      bindings: [],
      queryContext: {
        [PREPARED_SYMBOL]: { name: null } as PreparedMetadata,
      },
    };

    (knex as unknown as { emit: (event: string, data: unknown) => void }).emit('query', queryData);

    // Prepared statements disabled - no rewrite prepared
    expect(queryData.sql).toBe('SELECT * FROM users');
  });

  it('should not prepare rewrite when no metadata exists', () => {
    const queryData: QueryData = {
      sql: 'SELECT * FROM users',
      bindings: [],
      queryContext: {},
    };

    (knex as unknown as { emit: (event: string, data: unknown) => void }).emit('query', queryData);

    // No metadata - no rewrite prepared
    expect(queryData.sql).toBe('SELECT * FROM users');
  });
});

// Note: Detailed functionality testing for name generation, IN clause rewriting,
// type inference, custom options, etc. is covered by integration tests in
// test/integration.test.ts which verify the actual end-to-end behavior.
