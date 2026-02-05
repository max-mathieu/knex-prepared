import type { Knex } from 'knex';
import { addPreparedFactory } from './factory';
import type { KnexWithClient } from './types';
import { KNEX_PREPARED_OPTIONS_SYMBOL } from './symbols';

/**
 * Type guard to check if a value is a function.
 */
function isFunction(value: unknown): value is (...args: unknown[]) => unknown {
  return typeof value === 'function';
}

/**
 * Wraps Knex transaction method to add prepared factory to transaction instances.
 */
export const wrapTransactionMethod = (knex: Knex): void => {
  const originalTransaction = knex.transaction.bind(knex);

  // Get the options from the parent knex instance
  const knexWithClient = knex as KnexWithClient;
  const parentOptions = knexWithClient.client[KNEX_PREPARED_OPTIONS_SYMBOL];

  // Override transaction method using Object.defineProperty since it's read-only
  Object.defineProperty(knex, 'transaction', {
    value: function (
      ...args: Parameters<typeof originalTransaction>
    ): ReturnType<typeof originalTransaction> {
      // Get the callback from arguments (it could be in different positions depending on overload)
      const callbackIndex = args.findIndex(isFunction);

      if (callbackIndex === -1) {
        // No callback provided, just pass through
        return originalTransaction(...args);
      }

      const originalCallback = args[callbackIndex];
      if (!isFunction(originalCallback)) {
        return originalTransaction(...args);
      }

      // Wrap the callback to extend the transaction instance
      const wrappedCallback = async (trx: Knex.Transaction): Promise<unknown> => {
        // Add prepared factory to transaction instance
        addPreparedFactory(trx);

        // Copy options to the transaction's client so query builders can access them
        const trxWithClient = trx as unknown as KnexWithClient;
        if (trxWithClient.client && parentOptions) {
          trxWithClient.client[KNEX_PREPARED_OPTIONS_SYMBOL] = parentOptions;
        }

        return originalCallback(trx);
      };

      // Replace callback with wrapped version
      const newArgs: unknown[] = [...args];
      newArgs[callbackIndex] = wrappedCallback;

      // We know the args structure matches the original transaction signature
      type TransactionArgs = Parameters<typeof originalTransaction>;
      return originalTransaction(...(newArgs as TransactionArgs));
    },
    writable: true,
    enumerable: true,
    configurable: true,
  });
};
