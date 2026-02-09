import type { Knex } from 'knex';
import { addPreparedFactory } from './factory';
import { setOptions, getOptions } from './types';

/**
 * Type guard to check if a value is a function.
 */
function isFunction(value: unknown): value is (...args: unknown[]) => unknown {
  return typeof value === 'function';
}

/**
 * Wraps Knex transaction method to propagate options and factory to transaction instances.
 * This ensures transactions work with both chainable (.prepared()) and factory (trx.prepared()) APIs.
 */
export const wrapTransactionMethod = (knex: Knex): void => {
  const originalTransaction = knex.transaction.bind(knex);

  // Get the options from the parent knex client
  const parentOptions = getOptions(knex.client);

  // Override transaction method
  Object.defineProperty(knex, 'transaction', {
    value: function (
      ...args: Parameters<typeof originalTransaction>
    ): ReturnType<typeof originalTransaction> {
      // Find the callback function in the arguments
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
        // Propagate options to transaction's client
        if (parentOptions) {
          setOptions(trx.client, parentOptions);
        }

        // Add prepared factory to transaction instance
        addPreparedFactory(trx);

        return originalCallback(trx);
      };

      // Replace callback with wrapped version
      const newArgs: unknown[] = [...args];
      newArgs[callbackIndex] = wrappedCallback;

      type TransactionArgs = Parameters<typeof originalTransaction>;
      return originalTransaction(...(newArgs as TransactionArgs));
    },
    writable: true,
    enumerable: true,
    configurable: true,
  });
};
