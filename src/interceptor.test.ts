import { describe, it, expect, beforeAll } from 'vitest';
import Knex from 'knex';
import { attachPreparedStatementHook } from './interceptor';
import { extendQueryBuilder, PREPARED_SYMBOL } from './query-builder';
import type { PreparedMetadata } from './query-builder';
import { getKnexEvents } from './test-utils';
import type { QueryData } from './test-utils';

describe('attachPreparedStatementHook', () => {
  let knex: ReturnType<typeof Knex>;

  beforeAll(() => {
    knex = Knex({ client: 'pg' });
    extendQueryBuilder(knex);
    attachPreparedStatementHook(knex);
  });

  it('should attach query event listener', () => {
    const listeners = getKnexEvents(knex)?.query;
    expect(listeners).toBeDefined();
  });

  it('should inject auto-generated name when metadata.name is "auto"', () => {
    const queryData: QueryData = {
      sql: 'SELECT * FROM users WHERE id = ?',
      bindings: [1],
      queryContext: {
        [PREPARED_SYMBOL]: { name: 'auto' } as PreparedMetadata,
      },
    };

    // Simulate the query event
    (knex as unknown as { emit: (event: string, data: unknown) => void }).emit('query', queryData);

    expect(queryData.options?.name).toBeDefined();
    expect(queryData.options?.name).toMatch(/^auto-[0-9a-f]{16}$/);
  });

  it('should inject custom name when metadata.name is a string', () => {
    const queryData: QueryData = {
      sql: 'SELECT * FROM users',
      bindings: [],
      queryContext: {
        [PREPARED_SYMBOL]: { name: 'custom-query-name' } as PreparedMetadata,
      },
    };

    (knex as unknown as { emit: (event: string, data: unknown) => void }).emit('query', queryData);

    expect(queryData.options?.name).toBe('custom-query-name');
  });

  it('should not inject name when metadata.name is null', () => {
    const queryData: QueryData = {
      sql: 'SELECT * FROM users',
      bindings: [],
      queryContext: {
        [PREPARED_SYMBOL]: { name: null } as PreparedMetadata,
      },
    };

    (knex as unknown as { emit: (event: string, data: unknown) => void }).emit('query', queryData);

    expect(queryData.options?.name).toBeUndefined();
  });

  it('should not inject name when no metadata exists', () => {
    const queryData: QueryData = {
      sql: 'SELECT * FROM users',
      bindings: [],
      queryContext: {},
    };

    (knex as unknown as { emit: (event: string, data: unknown) => void }).emit('query', queryData);

    expect(queryData.options?.name).toBeUndefined();
  });

  it('should handle queries with same SQL getting same name', () => {
    const sql = 'SELECT * FROM users WHERE active = ?';

    const queryData1: QueryData = {
      sql,
      bindings: [true],
      queryContext: {
        [PREPARED_SYMBOL]: { name: 'auto' } as PreparedMetadata,
      },
    };

    const queryData2: QueryData = {
      sql,
      bindings: [false],
      queryContext: {
        [PREPARED_SYMBOL]: { name: 'auto' } as PreparedMetadata,
      },
    };

    (knex as unknown as { emit: (event: string, data: unknown) => void }).emit('query', queryData1);
    (knex as unknown as { emit: (event: string, data: unknown) => void }).emit('query', queryData2);

    expect(queryData1.options?.name).toBe(queryData2.options?.name);
    expect(queryData1.options?.name).toMatch(/^auto-[0-9a-f]{16}$/);
  });

  it('should handle queries with different SQL getting different names', () => {
    const queryData1: QueryData = {
      sql: 'SELECT * FROM users',
      bindings: [],
      queryContext: {
        [PREPARED_SYMBOL]: { name: 'auto' } as PreparedMetadata,
      },
    };

    const queryData2: QueryData = {
      sql: 'SELECT * FROM posts',
      bindings: [],
      queryContext: {
        [PREPARED_SYMBOL]: { name: 'auto' } as PreparedMetadata,
      },
    };

    (knex as unknown as { emit: (event: string, data: unknown) => void }).emit('query', queryData1);
    (knex as unknown as { emit: (event: string, data: unknown) => void }).emit('query', queryData2);

    expect(queryData1.options?.name).not.toBe(queryData2.options?.name);
  });
});
