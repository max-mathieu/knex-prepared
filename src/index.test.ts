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
      expect(options!.autoNamePrefix).toBe('auto');
      expect(options!.autoNameHashLength).toBe(16);
      expect(options!.rewriteInClauses).toBe(false);
      expect(options!.autoNameAllSelects).toBe(false);
    });

    it('should use default options for non-PostgreSQL clients', () => {
      const knex = knexPrepared(Knex({ client: 'sqlite3', useNullAsDefault: true }));
      const options = getOptions(knex);

      expect(options).toBeDefined();
      expect(options!.autoNamePrefix).toBe('auto');
      expect(options!.autoNameHashLength).toBe(16);
      expect(options!.rewriteInClauses).toBe(false);
      expect(options!.autoNameAllSelects).toBe(false);
    });
  });

  describe('custom options', () => {
    it('should accept custom autoNamePrefix', () => {
      const knex = knexPrepared(Knex({ client: 'pg' }), { autoNamePrefix: 'stmt' });
      const options = getOptions(knex);

      expect(options!.autoNamePrefix).toBe('stmt');
    });

    it('should accept custom autoNameHashLength', () => {
      const knex = knexPrepared(Knex({ client: 'pg' }), { autoNameHashLength: 8 });
      const options = getOptions(knex);

      expect(options!.autoNameHashLength).toBe(8);
    });

    it('should accept custom rewriteInClauses', () => {
      const knex = knexPrepared(Knex({ client: 'pg' }), { rewriteInClauses: false });
      const options = getOptions(knex);

      expect(options!.rewriteInClauses).toBe(false);
    });

    it('should accept all custom options together', () => {
      const knex = knexPrepared(Knex({ client: 'pg' }), {
        autoNamePrefix: 'custom',
        autoNameHashLength: 32,
        rewriteInClauses: false,
      });
      const options = getOptions(knex);

      expect(options!.autoNamePrefix).toBe('custom');
      expect(options!.autoNameHashLength).toBe(32);
      expect(options!.rewriteInClauses).toBe(false);
    });

    it('should freeze options to prevent modification', () => {
      const knex = knexPrepared(Knex({ client: 'pg' }));
      const options = getOptions(knex);

      expect(Object.isFrozen(options)).toBe(true);
    });
  });

  describe('validation', () => {
    it('should reject empty autoNamePrefix', () => {
      expect(() => {
        knexPrepared(Knex({ client: 'pg' }), { autoNamePrefix: '' });
      }).toThrow('autoNamePrefix must be a non-empty string');
    });

    it('should reject non-string autoNamePrefix', () => {
      expect(() => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        knexPrepared(Knex({ client: 'pg' }), { autoNamePrefix: 123 as any });
      }).toThrow('autoNamePrefix must be a non-empty string');
    });

    it('should reject autoNameHashLength less than 1', () => {
      expect(() => {
        knexPrepared(Knex({ client: 'pg' }), { autoNameHashLength: 0 });
      }).toThrow('autoNameHashLength must be an integer between 1 and 64');
    });

    it('should reject autoNameHashLength greater than 64', () => {
      expect(() => {
        knexPrepared(Knex({ client: 'pg' }), { autoNameHashLength: 65 });
      }).toThrow('autoNameHashLength must be an integer between 1 and 64');
    });

    it('should reject non-integer autoNameHashLength', () => {
      expect(() => {
        knexPrepared(Knex({ client: 'pg' }), { autoNameHashLength: 10.5 });
      }).toThrow('autoNameHashLength must be an integer between 1 and 64');
    });

    it('should reject non-number autoNameHashLength', () => {
      expect(() => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        knexPrepared(Knex({ client: 'pg' }), { autoNameHashLength: '16' as any });
      }).toThrow('autoNameHashLength must be an integer between 1 and 64');
    });
  });

  describe('rewriteInClauses option', () => {
    it('should default to false', () => {
      const pgKnex = knexPrepared(Knex({ client: 'pg' }));
      const pgOptions = getOptions(pgKnex);
      expect(pgOptions!.rewriteInClauses).toBe(false);
    });

    it('should allow explicit enabling of rewriteInClauses', () => {
      const knex = knexPrepared(Knex({ client: 'pg' }), { rewriteInClauses: true });
      const options = getOptions(knex);
      expect(options!.rewriteInClauses).toBe(true);
    });
  });
});
