import { describe, it, expect, beforeAll } from 'vitest';
import Knex from 'knex';
import { attachPreparedStatementHook } from './interceptor';
import { extendQueryBuilder, PREPARED_SYMBOL } from './query-builder';
import type { PreparedMetadata } from './query-builder';
import { getKnexEvents } from './test-utils';

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
    const queryData = {
      sql: 'SELECT * FROM users WHERE id = ?',
      bindings: [1],
      __knexQueryBuilder: {
        [PREPARED_SYMBOL]: { name: 'auto' } as PreparedMetadata,
      },
    };

    // Simulate the query event
    (knex as unknown as { emit: (event: string, data: unknown) => void }).emit('query', queryData);

    expect(queryData.name).toBeDefined();
    expect(queryData.name).toMatch(/^auto-[0-9a-f]{16}$/);
  });

  it('should inject custom name when metadata.name is a string', () => {
    const queryData = {
      sql: 'SELECT * FROM users',
      bindings: [],
      __knexQueryBuilder: {
        [PREPARED_SYMBOL]: { name: 'custom-query-name' } as PreparedMetadata,
      },
    };

    (knex as unknown as { emit: (event: string, data: unknown) => void }).emit('query', queryData);

    expect(queryData.name).toBe('custom-query-name');
  });

  it('should not inject name when metadata.name is null', () => {
    const queryData = {
      sql: 'SELECT * FROM users',
      bindings: [],
      __knexQueryBuilder: {
        [PREPARED_SYMBOL]: { name: null } as PreparedMetadata,
      },
    };

    (knex as unknown as { emit: (event: string, data: unknown) => void }).emit('query', queryData);

    expect(queryData.name).toBeUndefined();
  });

  it('should not inject name when no metadata exists', () => {
    const queryData = {
      sql: 'SELECT * FROM users',
      bindings: [],
      __knexQueryBuilder: {},
    };

    (knex as unknown as { emit: (event: string, data: unknown) => void }).emit('query', queryData);

    expect(queryData.name).toBeUndefined();
  });

  it('should not inject name when no builder is available', () => {
    const queryData = {
      sql: 'SELECT * FROM users',
      bindings: [],
    };

    (knex as unknown as { emit: (event: string, data: unknown) => void }).emit('query', queryData);

    expect(queryData.name).toBeUndefined();
  });

  it('should handle queries with same SQL getting same name', () => {
    const sql = 'SELECT * FROM users WHERE active = ?';

    const queryData1 = {
      sql,
      bindings: [true],
      __knexQueryBuilder: {
        [PREPARED_SYMBOL]: { name: 'auto' } as PreparedMetadata,
      },
    };

    const queryData2 = {
      sql,
      bindings: [false],
      __knexQueryBuilder: {
        [PREPARED_SYMBOL]: { name: 'auto' } as PreparedMetadata,
      },
    };

    (knex as unknown as { emit: (event: string, data: unknown) => void }).emit('query', queryData1);
    (knex as unknown as { emit: (event: string, data: unknown) => void }).emit('query', queryData2);

    expect(queryData1.name).toBe(queryData2.name);
    expect(queryData1.name).toMatch(/^auto-[0-9a-f]{16}$/);
  });

  it('should handle queries with different SQL getting different names', () => {
    const queryData1 = {
      sql: 'SELECT * FROM users',
      bindings: [],
      __knexQueryBuilder: {
        [PREPARED_SYMBOL]: { name: 'auto' } as PreparedMetadata,
      },
    };

    const queryData2 = {
      sql: 'SELECT * FROM posts',
      bindings: [],
      __knexQueryBuilder: {
        [PREPARED_SYMBOL]: { name: 'auto' } as PreparedMetadata,
      },
    };

    (knex as unknown as { emit: (event: string, data: unknown) => void }).emit('query', queryData1);
    (knex as unknown as { emit: (event: string, data: unknown) => void }).emit('query', queryData2);

    expect(queryData1.name).not.toBe(queryData2.name);
  });

  it('should handle missing SQL gracefully for auto-generation', () => {
    const queryData = {
      bindings: [],
      __knexQueryBuilder: {
        [PREPARED_SYMBOL]: { name: 'auto' } as PreparedMetadata,
      },
    };

    // Should not throw
    expect(() => {
      (knex as unknown as { emit: (event: string, data: unknown) => void }).emit(
        'query',
        queryData
      );
    }).not.toThrow();

    // Should not inject name
    expect(queryData.name).toBeUndefined();
  });

  it('should handle non-string SQL gracefully', () => {
    const queryData = {
      sql: 123,
      bindings: [],
      __knexQueryBuilder: {
        [PREPARED_SYMBOL]: { name: 'auto' } as PreparedMetadata,
      },
    };

    expect(() => {
      (knex as unknown as { emit: (event: string, data: unknown) => void }).emit(
        'query',
        queryData
      );
    }).not.toThrow();

    expect(queryData.name).toBeUndefined();
  });
});
