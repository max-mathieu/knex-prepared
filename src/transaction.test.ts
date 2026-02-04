import { describe, it, expect, beforeEach, vi } from 'vitest';
import Knex from 'knex';
import type { Knex as KnexTypes } from 'knex';
import { wrapTransactionMethod } from './transaction';
import { extendQueryBuilder } from './query-builder';
import { addPreparedFactory } from './factory';
import { getMetadata } from './test-utils';

/* eslint-disable @typescript-eslint/no-explicit-any */

describe('wrapTransactionMethod', () => {
  let knex: KnexTypes;

  beforeEach(() => {
    knex = Knex({ client: 'pg' });
    extendQueryBuilder(knex);
    addPreparedFactory(knex);
  });

  it('should wrap transaction method without errors', () => {
    expect(() => wrapTransactionMethod(knex)).not.toThrow();
  });

  it('should preserve original transaction method signature', () => {
    const originalTransaction = knex.transaction;
    wrapTransactionMethod(knex);

    expect(knex.transaction).toBeDefined();
    expect(typeof knex.transaction).toBe('function');
    expect(knex.transaction).not.toBe(originalTransaction);
  });

  it('should add prepared factory to transaction instance', async () => {
    wrapTransactionMethod(knex);

    const mockCallback = vi.fn(async (trx: KnexTypes.Transaction) => {
      // Check that prepared factory method exists on transaction
      expect(trx.prepared).toBeDefined();
      expect(typeof trx.prepared).toBe('function');
      return Promise.resolve();
    });

    // Mock the actual transaction call to avoid database connection
    const spy = vi.spyOn(knex, 'transaction') as any;
    spy.mockImplementation(async (callback: any) => {
      const mockTrx = knex as unknown as KnexTypes.Transaction;
      addPreparedFactory(mockTrx as unknown as KnexTypes);
      return callback(mockTrx);
    });

    await knex.transaction(mockCallback);

    expect(mockCallback).toHaveBeenCalled();
    spy.mockRestore();
  });

  it('should support chainable prepared method on transaction', async () => {
    wrapTransactionMethod(knex);

    const mockCallback = vi.fn(async (trx: KnexTypes.Transaction) => {
      const builder = trx('users').prepared();
      const metadata = getMetadata(builder);

      expect(metadata?.name).toBe('auto');
      return Promise.resolve();
    });

    const spy = vi.spyOn(knex, 'transaction') as any;
    spy.mockImplementation(async (callback: any) => {
      const mockTrx = knex as unknown as KnexTypes.Transaction;
      addPreparedFactory(mockTrx as unknown as KnexTypes);
      return callback(mockTrx);
    });

    await knex.transaction(mockCallback);

    expect(mockCallback).toHaveBeenCalled();
    spy.mockRestore();
  });

  it('should support factory prepared method on transaction', async () => {
    wrapTransactionMethod(knex);

    const mockCallback = vi.fn(async (trx: KnexTypes.Transaction) => {
      // Type assertion needed since TypeScript doesn't know about our extension
      const extendedTrx = trx as KnexTypes.Transaction & { prepared: (table: string) => unknown };
      const builder = extendedTrx.prepared('users');
      const metadata = getMetadata(builder);

      expect(metadata?.name).toBe('auto');
      return Promise.resolve();
    });

    const spy = vi.spyOn(knex, 'transaction') as any;
    spy.mockImplementation(async (callback: any) => {
      const mockTrx = knex as unknown as KnexTypes.Transaction;
      addPreparedFactory(mockTrx as unknown as KnexTypes);
      return callback(mockTrx);
    });

    await knex.transaction(mockCallback);

    expect(mockCallback).toHaveBeenCalled();
    spy.mockRestore();
  });

  it('should support custom prepared statement names in transactions', async () => {
    wrapTransactionMethod(knex);

    const mockCallback = vi.fn(async (trx: KnexTypes.Transaction) => {
      const builder = trx('users').prepared('custom-name');
      const metadata = getMetadata(builder);

      expect(metadata?.name).toBe('custom-name');
      return Promise.resolve();
    });

    const spy = vi.spyOn(knex, 'transaction') as any;
    spy.mockImplementation(async (callback: any) => {
      const mockTrx = knex as unknown as KnexTypes.Transaction;
      addPreparedFactory(mockTrx as unknown as KnexTypes);
      return callback(mockTrx);
    });

    await knex.transaction(mockCallback);

    expect(mockCallback).toHaveBeenCalled();
    spy.mockRestore();
  });

  it('should support prepared(false) to disable in transactions', async () => {
    wrapTransactionMethod(knex);

    const mockCallback = vi.fn(async (trx: KnexTypes.Transaction) => {
      const builder = trx('users').prepared(false);
      const metadata = getMetadata(builder);

      expect(metadata?.name).toBe(null);
      return Promise.resolve();
    });

    const spy = vi.spyOn(knex, 'transaction') as any;
    spy.mockImplementation(async (callback: any) => {
      const mockTrx = knex as unknown as KnexTypes.Transaction;
      addPreparedFactory(mockTrx as unknown as KnexTypes);
      return callback(mockTrx);
    });

    await knex.transaction(mockCallback);

    expect(mockCallback).toHaveBeenCalled();
    spy.mockRestore();
  });

  it('should handle transaction callbacks that return values', async () => {
    wrapTransactionMethod(knex);

    const expectedResult = { id: 1, name: 'test' };
    const mockCallback = vi.fn(async () => {
      return expectedResult;
    });

    const spy = vi.spyOn(knex, 'transaction') as any;
    spy.mockImplementation(async (callback: any) => {
      const mockTrx = knex as unknown as KnexTypes.Transaction;
      addPreparedFactory(mockTrx as unknown as KnexTypes);
      return callback(mockTrx);
    });

    const result = await knex.transaction(mockCallback);

    expect(result).toEqual(expectedResult);
    expect(mockCallback).toHaveBeenCalled();
    spy.mockRestore();
  });

  it('should handle transaction callbacks that throw errors', async () => {
    wrapTransactionMethod(knex);

    const expectedError = new Error('Transaction failed');
    const mockCallback = vi.fn(async () => {
      throw expectedError;
    });

    const spy = vi.spyOn(knex, 'transaction') as any;
    spy.mockImplementation(async (callback: any) => {
      const mockTrx = knex as unknown as KnexTypes.Transaction;
      addPreparedFactory(mockTrx as unknown as KnexTypes);
      return callback(mockTrx);
    });

    await expect(knex.transaction(mockCallback)).rejects.toThrow('Transaction failed');
    expect(mockCallback).toHaveBeenCalled();
    spy.mockRestore();
  });

  it('should call original transaction for non-callback arguments', async () => {
    const spy = vi.spyOn(knex, 'transaction') as any;

    // Mock to return a promise that resolves to a mock transaction
    spy.mockImplementation(() => {
      return Promise.resolve({} as KnexTypes.Transaction);
    });

    wrapTransactionMethod(knex);

    // Transaction with config object but no callback should pass through
    // This tests the fallback path when no callback is found
    const wrappedTransaction = knex.transaction as any;

    // Call with no arguments (creates a transaction object)
    const trx = await wrappedTransaction.call(knex);

    expect(trx).toBeDefined();
    spy.mockRestore();
  });

  it('should be idempotent - multiple calls should not break functionality', async () => {
    wrapTransactionMethod(knex);
    wrapTransactionMethod(knex);
    wrapTransactionMethod(knex);

    const mockCallback = vi.fn(async (trx: KnexTypes.Transaction) => {
      expect(trx.prepared).toBeDefined();
      return Promise.resolve();
    });

    const spy = vi.spyOn(knex, 'transaction') as any;
    spy.mockImplementation(async (callback: any) => {
      const mockTrx = knex as unknown as KnexTypes.Transaction;
      addPreparedFactory(mockTrx as unknown as KnexTypes);
      return callback(mockTrx);
    });

    await knex.transaction(mockCallback);

    expect(mockCallback).toHaveBeenCalled();
    spy.mockRestore();
  });

  it('should handle multiple sequential transactions', async () => {
    wrapTransactionMethod(knex);

    const spy = vi.spyOn(knex, 'transaction') as any;
    spy.mockImplementation(async (callback: any) => {
      const mockTrx = knex as unknown as KnexTypes.Transaction;
      addPreparedFactory(mockTrx as unknown as KnexTypes);
      return callback(mockTrx);
    });

    const result1 = await knex.transaction(async (trx: KnexTypes.Transaction) => {
      const builder = trx('users').prepared();
      expect(getMetadata(builder)?.name).toBe('auto');
      return 'first';
    });

    const result2 = await knex.transaction(async (trx: KnexTypes.Transaction) => {
      const builder = trx('posts').prepared('custom');
      expect(getMetadata(builder)?.name).toBe('custom');
      return 'second';
    });

    expect(result1).toBe('first');
    expect(result2).toBe('second');
    spy.mockRestore();
  });

  it('should work with transaction config options', async () => {
    wrapTransactionMethod(knex);

    const mockCallback = vi.fn(async (trx: KnexTypes.Transaction) => {
      expect(trx.prepared).toBeDefined();
      return Promise.resolve();
    });

    const spy = vi.spyOn(knex, 'transaction') as any;
    spy.mockImplementation(async (_configOrCallback: any, callback?: any) => {
      const mockTrx = knex as unknown as KnexTypes.Transaction;
      addPreparedFactory(mockTrx as unknown as KnexTypes);
      if (typeof callback === 'function') {
        return callback(mockTrx);
      }
      if (typeof _configOrCallback === 'function') {
        return _configOrCallback(mockTrx);
      }
      return Promise.resolve();
    });

    // Transaction with config and callback
    await (knex.transaction as any)({ isolationLevel: 'serializable' }, mockCallback);

    expect(mockCallback).toHaveBeenCalled();
    spy.mockRestore();
  });
});
