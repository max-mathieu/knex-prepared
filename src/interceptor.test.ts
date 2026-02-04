import { describe, it, expect, beforeAll } from 'vitest';
import Knex from 'knex';
import { knexPrepared } from './index';
import { PREPARED_SYMBOL } from './query-builder';
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

describe('generatePreparedStatementName (via interceptor)', () => {
  it('should generate a name with auto- prefix by default', () => {
    const knex = knexPrepared(Knex({ client: 'pg' }));
    const queryData: QueryData = {
      sql: 'SELECT * FROM users',
      bindings: [],
      queryContext: {
        [PREPARED_SYMBOL]: { name: 'auto' } as PreparedMetadata,
      },
    };

    (knex as unknown as { emit: (event: string, data: unknown) => void }).emit('query', queryData);

    expect(queryData.options?.name).toMatch(/^auto-[0-9a-f]{16}$/);
  });

  it('should be deterministic - same SQL produces same name', () => {
    const knex = knexPrepared(Knex({ client: 'pg' }));
    const sql = 'SELECT * FROM users WHERE id = ?';

    const queryData1: QueryData = {
      sql,
      bindings: [1],
      queryContext: {
        [PREPARED_SYMBOL]: { name: 'auto' } as PreparedMetadata,
      },
    };

    const queryData2: QueryData = {
      sql,
      bindings: [2],
      queryContext: {
        [PREPARED_SYMBOL]: { name: 'auto' } as PreparedMetadata,
      },
    };

    (knex as unknown as { emit: (event: string, data: unknown) => void }).emit('query', queryData1);
    (knex as unknown as { emit: (event: string, data: unknown) => void }).emit('query', queryData2);

    expect(queryData1.options?.name).toBe(queryData2.options?.name);
  });

  it('should normalize whitespace - different whitespace produces same name', () => {
    const knex = knexPrepared(Knex({ client: 'pg' }));
    const sql1 = 'SELECT * FROM users WHERE id = ?';
    const sql2 = 'SELECT   *   FROM   users   WHERE   id   =   ?';
    const sql3 = '  SELECT * FROM users WHERE id = ?  ';
    const sql4 = 'SELECT\n*\nFROM\nusers\nWHERE\nid\n=\n?';

    const queryData1: QueryData = {
      sql: sql1,
      bindings: [],
      queryContext: { [PREPARED_SYMBOL]: { name: 'auto' } as PreparedMetadata },
    };

    const queryData2: QueryData = {
      sql: sql2,
      bindings: [],
      queryContext: { [PREPARED_SYMBOL]: { name: 'auto' } as PreparedMetadata },
    };

    const queryData3: QueryData = {
      sql: sql3,
      bindings: [],
      queryContext: { [PREPARED_SYMBOL]: { name: 'auto' } as PreparedMetadata },
    };

    const queryData4: QueryData = {
      sql: sql4,
      bindings: [],
      queryContext: { [PREPARED_SYMBOL]: { name: 'auto' } as PreparedMetadata },
    };

    (knex as unknown as { emit: (event: string, data: unknown) => void }).emit('query', queryData1);
    (knex as unknown as { emit: (event: string, data: unknown) => void }).emit('query', queryData2);
    (knex as unknown as { emit: (event: string, data: unknown) => void }).emit('query', queryData3);
    (knex as unknown as { emit: (event: string, data: unknown) => void }).emit('query', queryData4);

    expect(queryData1.options?.name).toBe(queryData2.options?.name);
    expect(queryData1.options?.name).toBe(queryData3.options?.name);
    expect(queryData1.options?.name).toBe(queryData4.options?.name);
  });

  it('should produce different names for different SQL', () => {
    const knex = knexPrepared(Knex({ client: 'pg' }));

    const queryData1: QueryData = {
      sql: 'SELECT * FROM users',
      bindings: [],
      queryContext: { [PREPARED_SYMBOL]: { name: 'auto' } as PreparedMetadata },
    };

    const queryData2: QueryData = {
      sql: 'SELECT * FROM posts',
      bindings: [],
      queryContext: { [PREPARED_SYMBOL]: { name: 'auto' } as PreparedMetadata },
    };

    (knex as unknown as { emit: (event: string, data: unknown) => void }).emit('query', queryData1);
    (knex as unknown as { emit: (event: string, data: unknown) => void }).emit('query', queryData2);

    expect(queryData1.options?.name).not.toBe(queryData2.options?.name);
  });

  it('should use custom autoPrefix from options', () => {
    const knex = knexPrepared(Knex({ client: 'pg' }), { autoPrefix: 'stmt' });
    const queryData: QueryData = {
      sql: 'SELECT * FROM users',
      bindings: [],
      queryContext: {
        [PREPARED_SYMBOL]: { name: 'auto' } as PreparedMetadata,
      },
    };

    (knex as unknown as { emit: (event: string, data: unknown) => void }).emit('query', queryData);

    expect(queryData.options?.name).toMatch(/^stmt-[0-9a-f]{16}$/);
  });

  it('should use custom autoHashLength from options', () => {
    const knex = knexPrepared(Knex({ client: 'pg' }), { autoHashLength: 8 });
    const queryData: QueryData = {
      sql: 'SELECT * FROM users',
      bindings: [],
      queryContext: {
        [PREPARED_SYMBOL]: { name: 'auto' } as PreparedMetadata,
      },
    };

    (knex as unknown as { emit: (event: string, data: unknown) => void }).emit('query', queryData);

    expect(queryData.options?.name).toMatch(/^auto-[0-9a-f]{8}$/);
  });

  it('should use both custom prefix and length together', () => {
    const knex = knexPrepared(Knex({ client: 'pg' }), {
      autoPrefix: 'custom',
      autoHashLength: 12,
    });
    const queryData: QueryData = {
      sql: 'SELECT * FROM users',
      bindings: [],
      queryContext: {
        [PREPARED_SYMBOL]: { name: 'auto' } as PreparedMetadata,
      },
    };

    (knex as unknown as { emit: (event: string, data: unknown) => void }).emit('query', queryData);

    expect(queryData.options?.name).toMatch(/^custom-[0-9a-f]{12}$/);
  });
});
