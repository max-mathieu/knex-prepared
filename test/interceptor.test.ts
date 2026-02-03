import { describe, it, expect, beforeAll, vi } from 'vitest';
import Knex from 'knex';
import { attachPreparedStatementHook } from '../src/interceptor';
import { extendQueryBuilder, PREPARED_SYMBOL } from '../src/query-builder';
import type { PreparedMetadata } from '../src/query-builder';

describe('attachPreparedStatementHook', () => {
  let knex: ReturnType<typeof Knex>;

  beforeAll(() => {
    knex = Knex({ client: 'pg' });
    extendQueryBuilder(knex);
    attachPreparedStatementHook(knex);
  });

  it('should attach query event listener', () => {
    const listeners = (knex as any)._events?.query;
    expect(listeners).toBeDefined();
  });

  it('should inject auto-generated name when metadata.name is "auto"', () => {
    const queryData: any = {
      sql: 'SELECT * FROM users WHERE id = ?',
      bindings: [1],
      __knexQueryBuilder: {
        [PREPARED_SYMBOL]: { name: 'auto' } as PreparedMetadata,
      },
    };

    // Simulate the query event
    (knex as any).emit('query', queryData);

    expect(queryData.name).toBeDefined();
    expect(queryData.name).toMatch(/^auto-[0-9a-f]{16}$/);
  });

  it('should inject custom name when metadata.name is a string', () => {
    const queryData: any = {
      sql: 'SELECT * FROM users',
      bindings: [],
      __knexQueryBuilder: {
        [PREPARED_SYMBOL]: { name: 'custom-query-name' } as PreparedMetadata,
      },
    };

    (knex as any).emit('query', queryData);

    expect(queryData.name).toBe('custom-query-name');
  });

  it('should not inject name when metadata.name is null', () => {
    const queryData: any = {
      sql: 'SELECT * FROM users',
      bindings: [],
      __knexQueryBuilder: {
        [PREPARED_SYMBOL]: { name: null } as PreparedMetadata,
      },
    };

    (knex as any).emit('query', queryData);

    expect(queryData.name).toBeUndefined();
  });

  it('should not inject name when no metadata exists', () => {
    const queryData: any = {
      sql: 'SELECT * FROM users',
      bindings: [],
      __knexQueryBuilder: {},
    };

    (knex as any).emit('query', queryData);

    expect(queryData.name).toBeUndefined();
  });

  it('should not inject name when no builder is available', () => {
    const queryData: any = {
      sql: 'SELECT * FROM users',
      bindings: [],
    };

    (knex as any).emit('query', queryData);

    expect(queryData.name).toBeUndefined();
  });

  it('should handle queries with same SQL getting same name', () => {
    const sql = 'SELECT * FROM users WHERE active = ?';

    const queryData1: any = {
      sql,
      bindings: [true],
      __knexQueryBuilder: {
        [PREPARED_SYMBOL]: { name: 'auto' } as PreparedMetadata,
      },
    };

    const queryData2: any = {
      sql,
      bindings: [false],
      __knexQueryBuilder: {
        [PREPARED_SYMBOL]: { name: 'auto' } as PreparedMetadata,
      },
    };

    (knex as any).emit('query', queryData1);
    (knex as any).emit('query', queryData2);

    expect(queryData1.name).toBe(queryData2.name);
    expect(queryData1.name).toMatch(/^auto-[0-9a-f]{16}$/);
  });

  it('should handle queries with different SQL getting different names', () => {
    const queryData1: any = {
      sql: 'SELECT * FROM users',
      bindings: [],
      __knexQueryBuilder: {
        [PREPARED_SYMBOL]: { name: 'auto' } as PreparedMetadata,
      },
    };

    const queryData2: any = {
      sql: 'SELECT * FROM posts',
      bindings: [],
      __knexQueryBuilder: {
        [PREPARED_SYMBOL]: { name: 'auto' } as PreparedMetadata,
      },
    };

    (knex as any).emit('query', queryData1);
    (knex as any).emit('query', queryData2);

    expect(queryData1.name).not.toBe(queryData2.name);
  });

  it('should handle missing SQL gracefully for auto-generation', () => {
    const queryData: any = {
      bindings: [],
      __knexQueryBuilder: {
        [PREPARED_SYMBOL]: { name: 'auto' } as PreparedMetadata,
      },
    };

    // Should not throw
    expect(() => {
      (knex as any).emit('query', queryData);
    }).not.toThrow();

    // Should not inject name
    expect(queryData.name).toBeUndefined();
  });

  it('should handle non-string SQL gracefully', () => {
    const queryData: any = {
      sql: 123,
      bindings: [],
      __knexQueryBuilder: {
        [PREPARED_SYMBOL]: { name: 'auto' } as PreparedMetadata,
      },
    };

    expect(() => {
      (knex as any).emit('query', queryData);
    }).not.toThrow();

    expect(queryData.name).toBeUndefined();
  });
});
