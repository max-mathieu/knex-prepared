import { describe, it, expect } from 'vitest';
import Knex from 'knex';
import { knexPrepared, PREPARED_SYMBOL } from './index';
import { getMetadata, getKnexEvents, getOptions } from './test-utils';
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

  it('should emit query events with prepared statement metadata', () => {
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

    // Verify the event was captured with metadata
    // (name injection happens in connection wrapper, not in event data)
    expect(capturedQueryData).not.toBeNull();
    expect(capturedQueryData!.queryContext?.[PREPARED_SYMBOL]).toBeDefined();
  });

  it('should work with default export', async () => {
    const { default: knexPreparedDefault } = await import('../src/index');
    const knex = knexPreparedDefault(Knex({ client: 'pg' }));

    expect(knex.prepared).toBeDefined();
    const query = knex.prepared('users').select('*');
    expect(getMetadata(query)!.name).toBe('auto');
  });
});

describe('knexPrepared options', () => {
  describe('default values', () => {
    it('should use default options for PostgreSQL client', () => {
      const knex = knexPrepared(Knex({ client: 'pg' }));
      const options = getOptions(knex);

      expect(options).toBeDefined();
      expect(options!.autoPrefix).toBe('auto');
      expect(options!.autoHashLength).toBe(16);
      expect(options!.rewriteInClauses).toBe(false);
      expect(options!.autoNameSelects).toBe(false);
    });

    it('should use default options for non-PostgreSQL clients', () => {
      const knex = knexPrepared(Knex({ client: 'sqlite3' }));
      const options = getOptions(knex);

      expect(options).toBeDefined();
      expect(options!.autoPrefix).toBe('auto');
      expect(options!.autoHashLength).toBe(16);
      expect(options!.rewriteInClauses).toBe(false);
      expect(options!.autoNameSelects).toBe(false);
    });
  });

  describe('custom options', () => {
    it('should accept custom autoPrefix', () => {
      const knex = knexPrepared(Knex({ client: 'pg' }), { autoPrefix: 'stmt' });
      const options = getOptions(knex);

      expect(options!.autoPrefix).toBe('stmt');
    });

    it('should accept custom autoHashLength', () => {
      const knex = knexPrepared(Knex({ client: 'pg' }), { autoHashLength: 8 });
      const options = getOptions(knex);

      expect(options!.autoHashLength).toBe(8);
    });

    it('should accept custom rewriteInClauses', () => {
      const knex = knexPrepared(Knex({ client: 'pg' }), { rewriteInClauses: false });
      const options = getOptions(knex);

      expect(options!.rewriteInClauses).toBe(false);
    });

    it('should accept all custom options together', () => {
      const knex = knexPrepared(Knex({ client: 'pg' }), {
        autoPrefix: 'custom',
        autoHashLength: 32,
        rewriteInClauses: false,
      });
      const options = getOptions(knex);

      expect(options!.autoPrefix).toBe('custom');
      expect(options!.autoHashLength).toBe(32);
      expect(options!.rewriteInClauses).toBe(false);
    });

    it('should freeze options to prevent modification', () => {
      const knex = knexPrepared(Knex({ client: 'pg' }));
      const options = getOptions(knex);

      expect(Object.isFrozen(options)).toBe(true);
    });
  });

  describe('validation', () => {
    it('should reject empty autoPrefix', () => {
      expect(() => {
        knexPrepared(Knex({ client: 'pg' }), { autoPrefix: '' });
      }).toThrow('autoPrefix must be a non-empty string');
    });

    it('should reject non-string autoPrefix', () => {
      expect(() => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        knexPrepared(Knex({ client: 'pg' }), { autoPrefix: 123 as any });
      }).toThrow('autoPrefix must be a non-empty string');
    });

    it('should reject autoHashLength less than 1', () => {
      expect(() => {
        knexPrepared(Knex({ client: 'pg' }), { autoHashLength: 0 });
      }).toThrow('autoHashLength must be an integer between 1 and 64');
    });

    it('should reject autoHashLength greater than 64', () => {
      expect(() => {
        knexPrepared(Knex({ client: 'pg' }), { autoHashLength: 65 });
      }).toThrow('autoHashLength must be an integer between 1 and 64');
    });

    it('should reject non-integer autoHashLength', () => {
      expect(() => {
        knexPrepared(Knex({ client: 'pg' }), { autoHashLength: 10.5 });
      }).toThrow('autoHashLength must be an integer between 1 and 64');
    });

    it('should reject non-number autoHashLength', () => {
      expect(() => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        knexPrepared(Knex({ client: 'pg' }), { autoHashLength: '16' as any });
      }).toThrow('autoHashLength must be an integer between 1 and 64');
    });
  });

  describe('rewriteInClauses option', () => {
    it('should default to false for all clients', () => {
      const pgKnex = knexPrepared(Knex({ client: 'pg' }));
      const pgOptions = getOptions(pgKnex);
      expect(pgOptions!.rewriteInClauses).toBe(false);

      const sqliteKnex = knexPrepared(Knex({ client: 'sqlite3' }));
      const sqliteOptions = getOptions(sqliteKnex);
      expect(sqliteOptions!.rewriteInClauses).toBe(false);
    });

    it('should allow explicit enabling of rewriteInClauses', () => {
      const knex = knexPrepared(Knex({ client: 'pg' }), { rewriteInClauses: true });
      const options = getOptions(knex);
      expect(options!.rewriteInClauses).toBe(true);
    });
  });
});
