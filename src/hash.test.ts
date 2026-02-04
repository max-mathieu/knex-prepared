import { describe, it, expect } from 'vitest';
import { generatePreparedStatementName } from './hash';

describe('generatePreparedStatementName', () => {
  it('should generate a name with auto- prefix', () => {
    const name = generatePreparedStatementName('SELECT * FROM users');
    expect(name).toMatch(/^auto-[0-9a-f]{16}$/);
  });

  it('should be deterministic - same SQL produces same name', () => {
    const sql = 'SELECT * FROM users WHERE id = ?';
    const name1 = generatePreparedStatementName(sql);
    const name2 = generatePreparedStatementName(sql);
    expect(name1).toBe(name2);
  });

  it('should normalize whitespace - different whitespace produces same name', () => {
    const sql1 = 'SELECT * FROM users WHERE id = ?';
    const sql2 = 'SELECT   *   FROM   users   WHERE   id   =   ?';
    const sql3 = '  SELECT * FROM users WHERE id = ?  ';
    const sql4 = 'SELECT\n*\nFROM\nusers\nWHERE\nid\n=\n?';

    const name1 = generatePreparedStatementName(sql1);
    const name2 = generatePreparedStatementName(sql2);
    const name3 = generatePreparedStatementName(sql3);
    const name4 = generatePreparedStatementName(sql4);

    expect(name1).toBe(name2);
    expect(name1).toBe(name3);
    expect(name1).toBe(name4);
  });

  it('should produce different names for different SQL', () => {
    const name1 = generatePreparedStatementName('SELECT * FROM users');
    const name2 = generatePreparedStatementName('SELECT * FROM posts');
    expect(name1).not.toBe(name2);
  });
});
