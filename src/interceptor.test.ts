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

describe('IN clause rewriting', () => {
  it('should rewrite IN clause to = ANY() with integer array', () => {
    const knex = knexPrepared(Knex({ client: 'pg' }));
    const queryData: QueryData = {
      sql: 'select * from users where id in (?, ?, ?)',
      bindings: [1, 2, 3],
      queryContext: {
        [PREPARED_SYMBOL]: { name: 'auto' } as PreparedMetadata,
      },
    };

    (knex as unknown as { emit: (event: string, data: unknown) => void }).emit('query', queryData);

    expect(queryData.sql).toContain('= ANY($1::int[])');
    expect(queryData.sql).not.toContain('in (');
    expect(queryData.bindings).toEqual([[1, 2, 3]]);
  });

  it('should rewrite NOT IN clause to <> ALL() with text array', () => {
    const knex = knexPrepared(Knex({ client: 'pg' }));
    const queryData: QueryData = {
      sql: 'select * from users where status not in (?, ?)',
      bindings: ['inactive', 'banned'],
      queryContext: {
        [PREPARED_SYMBOL]: { name: 'auto' } as PreparedMetadata,
      },
    };

    (knex as unknown as { emit: (event: string, data: unknown) => void }).emit('query', queryData);

    expect(queryData.sql).toContain('<> ALL($1::text[])');
    expect(queryData.sql).not.toContain('not in');
    expect(queryData.bindings).toEqual([['inactive', 'banned']]);
  });

  it('should handle multiple IN clauses', () => {
    const knex = knexPrepared(Knex({ client: 'pg' }));
    const queryData: QueryData = {
      sql: 'select * from users where id in (?, ?) and status in (?, ?)',
      bindings: [1, 2, 'active', 'pending'],
      queryContext: {
        [PREPARED_SYMBOL]: { name: 'auto' } as PreparedMetadata,
      },
    };

    (knex as unknown as { emit: (event: string, data: unknown) => void }).emit('query', queryData);

    expect(queryData.sql).toContain('id = ANY($1::int[])');
    expect(queryData.sql).toMatch(/status = ANY\(\$\d+::text\[\]\)/);
    expect(queryData.bindings).toEqual([
      [1, 2],
      ['active', 'pending'],
    ]);
  });

  it('should preserve bindings after IN clause', () => {
    const knex = knexPrepared(Knex({ client: 'pg' }));
    const queryData: QueryData = {
      sql: 'select * from users where id in (?, ?) and active = ?',
      bindings: [1, 2, true],
      queryContext: {
        [PREPARED_SYMBOL]: { name: 'auto' } as PreparedMetadata,
      },
    };

    (knex as unknown as { emit: (event: string, data: unknown) => void }).emit('query', queryData);

    expect(queryData.sql).toContain('id = ANY($1::int[])');
    expect(queryData.sql).toContain('active = ?');
    expect(queryData.bindings).toEqual([[1, 2], true]);
  });

  it('should not rewrite when no IN clauses present', () => {
    const knex = knexPrepared(Knex({ client: 'pg' }));
    const queryData: QueryData = {
      sql: 'select * from users where id = ?',
      bindings: [1],
      queryContext: {
        [PREPARED_SYMBOL]: { name: 'auto' } as PreparedMetadata,
      },
    };

    (knex as unknown as { emit: (event: string, data: unknown) => void }).emit('query', queryData);

    expect(queryData.sql).toBe('select * from users where id = ?');
    expect(queryData.bindings).toEqual([1]);
  });

  it('should not rewrite when rewriteInClauses is disabled', () => {
    const knex = knexPrepared(Knex({ client: 'pg' }), { rewriteInClauses: false });
    const queryData: QueryData = {
      sql: 'select * from users where id in (?, ?)',
      bindings: [1, 2],
      queryContext: {
        [PREPARED_SYMBOL]: { name: 'auto' } as PreparedMetadata,
      },
    };

    (knex as unknown as { emit: (event: string, data: unknown) => void }).emit('query', queryData);

    expect(queryData.sql).toBe('select * from users where id in (?, ?)');
    expect(queryData.bindings).toEqual([1, 2]);
  });

  it('should not rewrite when prepared statements are disabled', () => {
    const knex = knexPrepared(Knex({ client: 'pg' }));
    const queryData: QueryData = {
      sql: 'select * from users where id in (?, ?)',
      bindings: [1, 2],
      queryContext: {
        [PREPARED_SYMBOL]: { name: null } as PreparedMetadata,
      },
    };

    (knex as unknown as { emit: (event: string, data: unknown) => void }).emit('query', queryData);

    expect(queryData.sql).toBe('select * from users where id in (?, ?)');
    expect(queryData.bindings).toEqual([1, 2]);
  });

  it('should handle case insensitive IN clause matching', () => {
    const knex = knexPrepared(Knex({ client: 'pg' }));
    const queryData: QueryData = {
      sql: 'SELECT * FROM users WHERE id IN (?, ?) AND status Not In (?, ?)',
      bindings: [1, 2, 'inactive', 'banned'],
      queryContext: {
        [PREPARED_SYMBOL]: { name: 'auto' } as PreparedMetadata,
      },
    };

    (knex as unknown as { emit: (event: string, data: unknown) => void }).emit('query', queryData);

    expect(queryData.sql).toContain('= ANY($1::int[])');
    expect(queryData.sql).toMatch(/<> ALL\(\$\d+::text\[\]\)/);
  });

  it('should handle quoted column names', () => {
    const knex = knexPrepared(Knex({ client: 'pg' }));
    const queryData: QueryData = {
      sql: 'select * from users where "userId" in (?, ?)',
      bindings: [1, 2],
      queryContext: {
        [PREPARED_SYMBOL]: { name: 'auto' } as PreparedMetadata,
      },
    };

    (knex as unknown as { emit: (event: string, data: unknown) => void }).emit('query', queryData);

    expect(queryData.sql).toContain('"userId" = ANY($1::int[])');
  });

  it('should infer correct types for different value types', () => {
    const knex = knexPrepared(Knex({ client: 'pg' }));

    // Boolean
    const queryData1: QueryData = {
      sql: 'select * from users where active in (?, ?)',
      bindings: [true, false],
      queryContext: { [PREPARED_SYMBOL]: { name: 'auto' } as PreparedMetadata },
    };
    (knex as unknown as { emit: (event: string, data: unknown) => void }).emit('query', queryData1);
    expect(queryData1.sql).toContain('= ANY($1::boolean[])');

    // Float
    const queryData2: QueryData = {
      sql: 'select * from products where price in (?, ?)',
      bindings: [10.5, 20.5],
      queryContext: { [PREPARED_SYMBOL]: { name: 'auto' } as PreparedMetadata },
    };
    (knex as unknown as { emit: (event: string, data: unknown) => void }).emit('query', queryData2);
    expect(queryData2.sql).toContain('= ANY($1::float[])');

    // Date
    const date1 = new Date('2024-01-01');
    const date2 = new Date('2024-01-02');
    const queryData3: QueryData = {
      sql: 'select * from events where date in (?, ?)',
      bindings: [date1, date2],
      queryContext: { [PREPARED_SYMBOL]: { name: 'auto' } as PreparedMetadata },
    };
    (knex as unknown as { emit: (event: string, data: unknown) => void }).emit('query', queryData3);
    expect(queryData3.sql).toContain('= ANY($1::timestamp[])');
  });
});
