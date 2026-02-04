import { createHash } from 'crypto';

/**
 * Generates a deterministic prepared statement name from SQL using SHA-256 hashing.
 * Format: `auto-{first 16 hex chars of hash}`. Same SQL always produces the same name.
 */
export const generatePreparedStatementName = (sql: string): string => {
  const normalized = sql.trim().replace(/\s+/g, ' ');
  const hash = createHash('sha256').update(normalized).digest('hex');
  return `auto-${hash.substring(0, 16)}`;
};
