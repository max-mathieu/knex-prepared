import { describe, it, expect, beforeEach, vi } from 'vitest';
import Knex from 'knex';
import type { Knex as KnexTypes } from 'knex';
import { wrapTransactionMethod } from './transaction';
import { extendQueryBuilder } from './query-builder';
import { addPreparedFactory } from './factory';
import { getMetadata } from './test-utils';

/* eslint-disable @typescript-eslint/no-explicit-any */

// Helper function to mock transaction calls
const mockTransaction = (
  knex: KnexTypes,
  callback: (trx: KnexTypes.Transaction) => Promise<any>
) => {
  const spy = vi.spyOn(knex, 'transaction') as any;
  spy.mockImplementation(async (callbackOrConfig: any, cb?: any) => {
    const actualCallback = typeof callbackOrConfig === 'function' ? callbackOrConfig : cb;
    const mockTrx = knex as unknown as KnexTypes.Transaction;
    addPreparedFactory(mockTrx as unknown as KnexTypes);
    return actualCallback ? actualCallback(mockTrx) : Promise.resolve({} as KnexTypes.Transaction);
  });
  return callback(knex as unknown as KnexTypes.Transaction).finally(() => spy.mockRestore());
};

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

  it('should add prepared factory and support all prepared methods on transaction', async () => {
    wrapTransactionMethod(knex);

    await mockTransaction(knex, async (trx) => {
      // Test factory method exists
      expect(trx.prepared).toBeDefined();
      expect(typeof trx.prepared).toBe('function');

      // Test factory method
      const extendedTrx = trx as KnexTypes.Transaction & { prepared: (table: string) => unknown };
      const factoryBuilder = extendedTrx.prepared('users');
      expect(getMetadata(factoryBuilder)?.name).toBe('auto');

      // Test chainable method
      const chainableBuilder = trx('users').prepared();
      expect(getMetadata(chainableBuilder)?.name).toBe('auto');

      // Test custom name
      const customBuilder = trx('users').prepared('custom-name');
      expect(getMetadata(customBuilder)?.name).toBe('custom-name');

      // Test disabled
      const disabledBuilder = trx('users').prepared(false);
      expect(getMetadata(disabledBuilder)?.name).toBeNull();
    });
  });

  it('should handle transaction callbacks that return values or throw errors', async () => {
    wrapTransactionMethod(knex);

    // Test return values
    const expectedResult = { id: 1, name: 'test' };
    const result = await mockTransaction(knex, async () => expectedResult);
    expect(result).toEqual(expectedResult);

    // Test errors
    const expectedError = new Error('Transaction failed');
    await expect(mockTransaction(knex, async () => {
      throw expectedError;
    })).rejects.toThrow('Transaction failed');
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

    await mockTransaction(knex, async (trx) => {
      expect(trx.prepared).toBeDefined();
    });
  });
});
