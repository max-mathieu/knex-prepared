import { createHash } from 'crypto';

/**
 * Normalizes SQL text for consistent hashing by trimming and collapsing whitespace.
 *
 * @param sql - The SQL query string to normalize
 * @returns Normalized SQL string with trimmed and collapsed whitespace
 */
function normalizeSQL(sql: string): string {
  return sql.trim().replace(/\s+/g, ' ');
}

/**
 * Generates a deterministic prepared statement name from SQL text using SHA-256 hashing.
 *
 * The name format is `auto-${hash16}` where hash16 is the first 16 characters of the
 * SHA-256 hash of the normalized SQL text. This ensures:
 * - Deterministic naming: same SQL always gets the same name
 * - Collision resistance: SHA-256 provides strong collision resistance
 * - Reasonable length: 16 hex characters (64 bits) provide sufficient uniqueness
 *
 * @param sql - The SQL query string to generate a name for
 * @returns A prepared statement name in the format `auto-${hash16}`
 *
 * @example
 * ```typescript
 * const name = generatePreparedStatementName('SELECT * FROM users WHERE id = ?');
 * // Returns something like: 'auto-a1b2c3d4e5f6g7h8'
 * ```
 */
export function generatePreparedStatementName(sql: string): string {
  const normalized = normalizeSQL(sql);
  const hash = createHash('sha256').update(normalized).digest('hex');
  return `auto-${hash.substring(0, 16)}`;
}
