import type { Knex } from 'knex';
import { addPreparedFactory } from './factory';
import type { KnexWithOptions } from './types';
import { KNEX_PREPARED_OPTIONS_SYMBOL } from './symbols';

interface KnexClient {
  [key: symbol]: unknown;
  [key: string]: unknown;
}

/**
 * Wraps Knex transaction method to add prepared factory to transaction instances.
 */
export const wrapTransactionMethod = (knex: Knex): void => {
  const originalTransaction = knex.transaction.bind(knex);

  // Get the options from the parent knex instance
  const parentOptions = (knex as KnexWithOptions)[KNEX_PREPARED_OPTIONS_SYMBOL];

  // Override transaction method using Object.defineProperty since it's read-only
  Object.defineProperty(knex, 'transaction', {
    value: function (
      ...args: Parameters<typeof originalTransaction>
    ): ReturnType<typeof originalTransaction> {
      // Get the callback from arguments (it could be in different positions depending on overload)
      const callbackIndex = args.findIndex((arg) => typeof arg === 'function');

      if (callbackIndex === -1) {
        // No callback provided, just pass through
        return originalTransaction(...args);
      }

      const originalCallback = args[callbackIndex] as (trx: Knex.Transaction) => Promise<unknown>;

      // Wrap the callback to extend the transaction instance
      const wrappedCallback = async (trx: Knex.Transaction): Promise<unknown> => {
        // Add prepared factory to transaction instance
        addPreparedFactory(trx as unknown as Knex);

        // Copy options to the transaction's client so query builders can access them
        const trxClient = (trx as unknown as { client: KnexClient }).client;
        if (trxClient && parentOptions) {
          trxClient[KNEX_PREPARED_OPTIONS_SYMBOL] = parentOptions;
        }

        return originalCallback(trx);
      };

      // Replace callback with wrapped version
      const newArgs = [...args];
      newArgs[callbackIndex] = wrappedCallback;

      return originalTransaction(...(newArgs as Parameters<typeof originalTransaction>));
    },
    writable: true,
    enumerable: true,
    configurable: true,
  });
};
