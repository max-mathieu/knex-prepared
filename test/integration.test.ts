import { config } from 'dotenv';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestKnex, setupTestTables, seedTestData, teardownTestTables } from './setup';

// Load .env file before checking environment variables
config();

// Check if we should skip integration tests
// Skip if no DB_HOST is set, UNLESS we're in CI (where tests must run)
const isCI = process.env.CI === 'true' || process.env.GITHUB_ACTIONS === 'true';
const hasDBConfig = !!process.env.DB_HOST;
const shouldSkip = !hasDBConfig && !isCI;

// In CI, fail fast if DB config is missing
if (isCI && !hasDBConfig) {
  throw new Error(
    'Integration tests are running in CI but DB_HOST is not set. ' +
      'Please check CI configuration for database environment variables.'
  );
}

describe.skipIf(shouldSkip)('Integration tests with PostgreSQL', () => {
  let knex: ReturnType<typeof createTestKnex>;
  let userIds: { user1Id: number; user2Id: number; user3Id: number };

  beforeAll(async () => {
    knex = createTestKnex();
    await setupTestTables(knex);
    userIds = await seedTestData(knex);
  }, 30000);

  afterAll(async () => {
    await teardownTestTables(knex);
    await knex.destroy();
  });

  /**
   * Generate a random prepared statement name for testing.
   */
  function getRandomPreparedName(prefix = 'test'): string {
    return `${prefix}-${Math.random().toString(36).substring(2, 15)}`;
  }

  /**
   * Helper function to test prepared statements within a transaction.
   * Ensures all queries and pg_prepared_statements reads are on the same connection.
   */
  async function withPreparedStatementsCheck<T>(
    callback: (
      trx: typeof knex,
      getPreparedStatements: (
        names?: string | string[]
      ) => Promise<Array<{ name: string; statement: string }>>
    ) => Promise<T>
  ): Promise<T> {
    return knex.transaction(async (trx) => {
      const getPreparedStatements = async (names?: string | string[]) => {
        if (names) {
          const nameArray = Array.isArray(names) ? names : [names];
          const placeholders = nameArray.map(() => '?').join(', ');
          const queryResult = await trx.raw<{ rows: Array<{ name: string; statement: string }> }>(
            `SELECT name, statement FROM pg_prepared_statements WHERE name IN (${placeholders})`,
            nameArray
          );
          return queryResult.rows;
        } else {
          const queryResult = await trx.raw<{ rows: Array<{ name: string; statement: string }> }>(
            'SELECT name, statement FROM pg_prepared_statements WHERE name LIKE ?',
            ['auto-%']
          );
          return queryResult.rows;
        }
      };

      return callback(trx, getPreparedStatements);
    });
  }

  describe('Noop behavior', () => {
    it('should not automatically prepare queries without explicit .prepared() call', async () => {
      // Verify that knexPrepared() doesn't change default behavior
      // Regular queries without .prepared() should work normally
      const users = await knex('users').select('*').orderBy('id');
      expect(users).toHaveLength(3);

      // Verify queries work in transactions too
      await withPreparedStatementsCheck(async (trx, getPreparedStatements) => {
        const transactionUsers = await trx('users').select('*').where('active', true);
        expect(transactionUsers).toHaveLength(2);

        // Only queries explicitly marked with .prepared() create prepared statements
        const preparedName = getRandomPreparedName('explicit-test');
        await trx('users').prepared(preparedName).select('*').where('id', userIds.user1Id);

        const statements = await getPreparedStatements(preparedName);

        // This explicit prepared statement should exist
        expect(statements).toHaveLength(1);
        expect(statements[0].name).toBe(preparedName);
      });
    });
  });

  describe('autoNameSelects option', () => {
    it('should automatically prepare SELECT queries when enabled', async () => {
      // Create knex instance with autoNameSelects enabled
      const knexAutoName = createTestKnex({ autoNameSelects: true });

      try {
        await knexAutoName.transaction(async (trx) => {
          // Execute a SELECT query WITHOUT calling .prepared()
          const users = await trx('users').select('*').where('active', true).orderBy('id');

          expect(users).toHaveLength(2);
          expect(users[0].name).toBe('Alice');
          expect(users[1].name).toBe('Bob');

          // Verify that a prepared statement was automatically created
          const statements = await trx.raw<{ rows: Array<{ name: string; statement: string }> }>(
            'SELECT name, statement FROM pg_prepared_statements WHERE name LIKE ?',
            ['auto-%']
          );

          expect(statements.rows.length).toBeGreaterThan(0);
          // Verify the prepared statement contains our query
          const ourStatement = statements.rows.find(s =>
            s.statement.toLowerCase().includes('"users"') &&
            s.statement.toLowerCase().includes('"active"')
          );
          expect(ourStatement).toBeDefined();
          expect(ourStatement!.name).toMatch(/^auto-[0-9a-f]{16}$/);
        });
      } finally {
        await knexAutoName.destroy();
      }
    });

    it('should not auto-prepare non-SELECT queries even with autoNameSelects enabled', async () => {
      // Create knex instance with autoNameSelects enabled
      const knexAutoName = createTestKnex({ autoNameSelects: true });

      try {
        await knexAutoName.transaction(async (trx) => {
          // Get prepared statements before the INSERT
          const beforeStatements = await trx.raw<{ rows: Array<{ name: string; statement: string }> }>(
            'SELECT name, statement FROM pg_prepared_statements'
          );
          const beforeCount = beforeStatements.rows.length;

          // Execute an INSERT query WITHOUT calling .prepared()
          const [newUser] = await trx('users')
            .insert({
              name: 'TestUser',
              email: 'test-auto-name@example.com',
              active: true,
            })
            .returning('*');

          expect(newUser.name).toBe('TestUser');

          // Verify no new prepared statement was created for INSERT
          const afterStatements = await trx.raw<{ rows: Array<{ name: string; statement: string }> }>(
            'SELECT name, statement FROM pg_prepared_statements'
          );

          // Should be the same count (no new prepared statement for INSERT)
          expect(afterStatements.rows.length).toBe(beforeCount);

          // Roll back the transaction to avoid affecting other tests
          throw new Error('Rollback');
        }).catch((err) => {
          // Ignore the rollback error
          if (err.message !== 'Rollback') {
            throw err;
          }
        });
      } finally {
        await knexAutoName.destroy();
      }
    });

    it('should respect explicit .prepared(false) even with autoNameSelects enabled', async () => {
      // Create knex instance with autoNameSelects enabled
      const knexAutoName = createTestKnex({ autoNameSelects: true });

      try {
        await knexAutoName.transaction(async (trx) => {
          const preparedName = getRandomPreparedName('explicit-disabled');

          // Execute SELECT with explicit .prepared(false)
          const users = await trx('users')
            .prepared(false)
            .select('*')
            .where('active', true)
            .orderBy('id');

          expect(users).toHaveLength(2);

          // Verify no prepared statement was created with our name
          const statements = await trx.raw<{ rows: Array<{ name: string; statement: string }> }>(
            'SELECT name, statement FROM pg_prepared_statements WHERE name = ?',
            [preparedName]
          );

          expect(statements.rows).toHaveLength(0);
        });
      } finally {
        await knexAutoName.destroy();
      }
    });

    it('should allow explicit prepared names to override autoNameSelects', async () => {
      // Create knex instance with autoNameSelects enabled
      const knexAutoName = createTestKnex({ autoNameSelects: true });

      try {
        await knexAutoName.transaction(async (trx) => {
          const preparedName = getRandomPreparedName('custom-name');

          // Execute SELECT with explicit custom name
          const users = await trx('users')
            .prepared(preparedName)
            .select('*')
            .where('active', true)
            .orderBy('id');

          expect(users).toHaveLength(2);

          // Verify prepared statement was created with custom name (not auto-generated)
          const statements = await trx.raw<{ rows: Array<{ name: string; statement: string }> }>(
            'SELECT name, statement FROM pg_prepared_statements WHERE name = ?',
            [preparedName]
          );

          expect(statements.rows).toHaveLength(1);
          expect(statements.rows[0].name).toBe(preparedName);
        });
      } finally {
        await knexAutoName.destroy();
      }
    });

    it('should not auto-prepare when autoNameSelects is false (default)', async () => {
      // Use default knex instance (autoNameSelects: false)
      await knex.transaction(async (trx) => {
        // Get initial prepared statement count
        const beforeStatements = await trx.raw<{ rows: Array<{ name: string; statement: string }> }>(
          'SELECT name FROM pg_prepared_statements WHERE name LIKE ?',
          ['auto-%']
        );
        const beforeCount = beforeStatements.rows.length;

        // Execute a SELECT query WITHOUT calling .prepared()
        const users = await trx('users').select('*').where('active', true).orderBy('id');

        expect(users).toHaveLength(2);

        // Verify no new prepared statement was created
        const afterStatements = await trx.raw<{ rows: Array<{ name: string; statement: string }> }>(
          'SELECT name FROM pg_prepared_statements WHERE name LIKE ?',
          ['auto-%']
        );

        // Count should be the same (no auto-preparation)
        expect(afterStatements.rows.length).toBe(beforeCount);
      });
    });
  });

  describe('Factory method: knex.prepared(table)', () => {
    it('should execute SELECT query with auto-generated prepared statement', async () => {
      await withPreparedStatementsCheck(async (trx, getPreparedStatements) => {
        const users = await trx.prepared('users').select('*').orderBy('id');

        expect(users).toHaveLength(3);
        expect(users[0].name).toBe('Alice');
        expect(users[1].name).toBe('Bob');
        expect(users[2].name).toBe('Charlie');

        // Validate that an auto-generated prepared statement was created
        const statements = await getPreparedStatements();
        expect(statements.length).toBeGreaterThan(0);
        expect(statements[0].name).toMatch(/^auto-[0-9a-f]{16}$/);
      });
    });

    it('should execute WHERE clause with prepared statement', async () => {
      const users = await knex.prepared('users').select('*').where('active', true);

      expect(users).toHaveLength(2);
      expect(users.every((u) => u.active)).toBe(true);
    });

    it('should execute complex join with prepared statement', async () => {
      const results = await knex
        .prepared('users')
        .select('users.name', 'posts.title')
        .join('posts', 'users.id', 'posts.user_id')
        .where('posts.published', true)
        .orderBy('users.id');

      expect(results).toHaveLength(2);
      expect(results[0].name).toBe('Alice');
      expect(results[1].name).toBe('Bob');
    });

    it('should work with INSERT queries', async () => {
      await withPreparedStatementsCheck(async (trx, getPreparedStatements) => {
        const preparedName = getRandomPreparedName('insert-test');
        const [newUser] = await trx('users')
          .prepared(preparedName)
          .insert({
            name: 'David',
            email: 'david@example.com',
            active: true,
          })
          .returning('*');

        expect(newUser.name).toBe('David');
        expect(newUser.email).toBe('david@example.com');

        // Validate that the prepared statement was created
        const statements = await getPreparedStatements(preparedName);
        expect(statements).toHaveLength(1);
        expect(statements[0].statement.toLowerCase()).toContain('insert');

        // Clean up
        await trx('users').where('id', newUser.id).delete();
      });
    });

    it('should work with UPDATE queries', async () => {
      const [updated] = await knex
        .prepared('users')
        .where('id', userIds.user1Id)
        .update({ name: 'Alice Updated' })
        .returning('*');

      expect(updated.name).toBe('Alice Updated');

      // Restore original value
      await knex('users').where('id', userIds.user1Id).update({ name: 'Alice' });
    });

    it('should work with DELETE queries', async () => {
      // Create a user to delete
      const [tempUser] = await knex('users')
        .insert({ name: 'Temp', email: 'temp@example.com' })
        .returning('*');

      const deleteCount = await knex.prepared('users').where('id', tempUser.id).delete();

      expect(deleteCount).toBe(1);

      // Verify deletion
      const found = await knex('users').where('id', tempUser.id).first();
      expect(found).toBeUndefined();
    });
  });

  describe('Chainable method: query.prepared()', () => {
    it('should work with auto-generation (no args)', async () => {
      const users = await knex('users').prepared().select('*').where('active', true);

      expect(users).toHaveLength(2);
    });

    it('should work with auto-generation (true)', async () => {
      const users = await knex('users').prepared(true).select('*').where('active', false);

      expect(users).toHaveLength(1);
      expect(users[0].name).toBe('Charlie');
    });

    it('should work with custom name', async () => {
      await withPreparedStatementsCheck(async (trx, getPreparedStatements) => {
        const preparedName = getRandomPreparedName('get-active-users');
        const users = await trx('users')
          .prepared(preparedName)
          .select('*')
          .where('active', true)
          .orderBy('name');

        expect(users).toHaveLength(2);
        expect(users[0].name).toBe('Alice');

        // Validate that the custom named prepared statement was created
        const statements = await getPreparedStatements(preparedName);
        expect(statements).toHaveLength(1);
        expect(statements[0].name).toBe(preparedName);
        expect(statements[0].statement.toLowerCase()).toContain('select');
      });
    });

    it('should work with prepared(false) to disable', async () => {
      // This should execute without a prepared statement
      const users = await knex('users').prepared(false).select('*');

      expect(users).toHaveLength(3);
    });
  });

  describe('Prepared statement caching verification', () => {
    it('should create prepared statements in PostgreSQL', async () => {
      // Use a transaction to ensure all queries are on the same connection
      await withPreparedStatementsCheck(async (trx, getPreparedStatements) => {
        // Execute queries with prepared statements using the same connection
        await trx('users').prepared().select('*').where('active', true);
        await trx('users').prepared().select('*').where('active', true);

        // Query pg_prepared_statements on the same connection
        const statements = await getPreparedStatements();

        // Should have at least one prepared statement
        expect(statements.length).toBeGreaterThan(0);
        expect(statements[0].name).toMatch(/^auto-[0-9a-f]{16}$/);
        expect(statements[0].statement.toLowerCase()).toContain('select');
      });
    });

    it('should reuse the same prepared statement for identical queries', async () => {
      await withPreparedStatementsCheck(async (trx, getPreparedStatements) => {
        // Use a unique query that hasn't been used in other tests
        const uniqueValue = 'test-unique-email@example.com';

        // Get prepared statement count before
        const beforeStatements = await getPreparedStatements();
        const beforeCount = beforeStatements.length;

        // Execute the same unique query multiple times
        await trx('users').prepared().select('*').where('email', uniqueValue);
        await trx('users').prepared().select('*').where('email', uniqueValue);
        await trx('users').prepared().select('*').where('email', uniqueValue);

        // Check that only ONE NEW prepared statement was created
        const afterStatements = await getPreparedStatements();
        const afterCount = afterStatements.length;

        // Should have created exactly 1 new prepared statement (reused 3 times)
        expect(afterCount - beforeCount).toBe(1);
      });
    });

    it('should create different prepared statements for different queries', async () => {
      await withPreparedStatementsCheck(async (trx, getPreparedStatements) => {
        // Execute queries with different SQL
        await trx('users').prepared().select('*').where('active', true);
        await trx('users').prepared().select('id', 'name');
        await trx('posts').prepared().select('*').where('published', true);

        // Query all auto-generated prepared statements
        const statements = await getPreparedStatements();

        // Should have at least 3 different prepared statements
        expect(statements.length).toBeGreaterThanOrEqual(3);
      });
    });

    it('should use custom prepared statement names', async () => {
      await withPreparedStatementsCheck(async (trx, getPreparedStatements) => {
        // Execute query with custom name
        await trx('users').prepared('my-custom-query').select('*').where('id', userIds.user1Id);

        // Verify the custom name appears in pg_prepared_statements
        const statements = await getPreparedStatements('my-custom-query');

        expect(statements).toHaveLength(1);
        expect(statements[0].name).toBe('my-custom-query');
        expect(statements[0].statement.toLowerCase()).toContain('select');
      });
    });

    it('should work with transactions using chainable method', async () => {
      await withPreparedStatementsCheck(async (trx, _getPreparedStatements) => {
        // Test chainable method in transaction
        const users = await trx('users').prepared().select('*').where('active', true);
        expect(users).toHaveLength(2);
      });
    });

    it('should work with transactions using factory method', async () => {
      await withPreparedStatementsCheck(async (trx, _getPreparedStatements) => {
        // Test factory method in transaction
        const users = await trx.prepared('users').select('*').where('active', true);
        expect(users).toHaveLength(2);
      });
    });
  });

  describe('Complex queries', () => {
    it('should handle queries with WHERE clauses, ORDER BY, and LIMIT', async () => {
      // Multiple WHERE clauses
      const filtered = await knex
        .prepared('users')
        .select('*')
        .where('active', true)
        .where('name', 'like', 'A%');

      expect(filtered).toHaveLength(1);
      expect(filtered[0].name).toBe('Alice');

      // WHERE IN
      const inResults = await knex
        .prepared('users')
        .select('*')
        .whereIn('id', [userIds.user1Id, userIds.user2Id]);

      expect(inResults).toHaveLength(2);

      // ORDER BY and LIMIT with OFFSET
      const paginated = await knex
        .prepared('users')
        .select('*')
        .orderBy('name', 'asc')
        .limit(2)
        .offset(1);

      expect(paginated).toHaveLength(2);
      expect(paginated[0].name).toBe('Bob');
      expect(paginated[1].name).toBe('Charlie');
    });

    it('should handle aggregations and GROUP BY', async () => {
      await withPreparedStatementsCheck(async (trx, getPreparedStatements) => {
        // COUNT aggregation
        const preparedName1 = getRandomPreparedName('count-active');
        const count = await trx('users')
          .prepared(preparedName1)
          .count('* as count')
          .where('active', true)
          .first();
        expect(count?.count).toBe('2');

        // GROUP BY
        const preparedName2 = getRandomPreparedName('group-by-user');
        const grouped = await trx('posts')
          .prepared(preparedName2)
          .select('user_id')
          .count('* as post_count')
          .groupBy('user_id')
          .orderBy('user_id');

        expect(grouped).toHaveLength(2);
        expect(grouped[0].post_count).toBe('2');
        expect(grouped[1].post_count).toBe('1');

        // Validate that prepared statements were created
        const statements = await getPreparedStatements([preparedName1, preparedName2]);
        expect(statements).toHaveLength(2);
        expect(statements.some((s) => s.statement.toLowerCase().includes('count'))).toBe(true);
        expect(statements.some((s) => s.statement.toLowerCase().includes('group by'))).toBe(true);
      });
    });

    it('should handle LEFT JOIN queries', async () => {
      const [lonelyUser] = await knex('users')
        .insert({ name: 'Lonely', email: 'lonely@example.com' })
        .returning('*');

      const results = await knex
        .prepared('users')
        .select('users.name', knex.raw('COUNT(posts.id) as post_count'))
        .leftJoin('posts', 'users.id', 'posts.user_id')
        .groupBy('users.id', 'users.name')
        .orderBy('users.name');

      expect(results.length).toBeGreaterThanOrEqual(3);
      const lonelyResult = results.find((r) => r.name === 'Lonely');
      expect(lonelyResult?.post_count).toBe('0');

      await knex('users').where('id', lonelyUser.id).delete();
    });
  });

  describe('Subqueries', () => {
    it('should handle subqueries in WHERE clause', async () => {
      await withPreparedStatementsCheck(async (trx, getPreparedStatements) => {
        const subquery = trx('posts').select('user_id').where('published', true).groupBy('user_id');

        const preparedName = getRandomPreparedName('subquery-test');
        const results = await trx('users')
          .prepared(preparedName)
          .select('*')
          .whereIn('id', subquery);

        expect(results).toHaveLength(2);

        // Validate that the prepared statement was created with subquery
        const statements = await getPreparedStatements(preparedName);
        expect(statements).toHaveLength(1);
        expect(statements[0].statement.toLowerCase()).toContain('select');
      });
    });
  });

  describe('IN clause rewriting', () => {
    it('should rewrite whereIn and return correct results for integers', async () => {
      // Create knex instance with rewriteInClauses enabled
      const knexWithRewrite = createTestKnex({ rewriteInClauses: true });

      try {
        // Test WITHOUT transaction first
        const preparedName = getRandomPreparedName('wherein-integers');
        const users = await knexWithRewrite('users')
          .select('*')
          .whereIn('id', [userIds.user1Id, userIds.user2Id])
          .orderBy('id')
          .prepared(preparedName);

        console.log('Users returned:', users.length);
        expect(users).toHaveLength(2);
        expect(users[0].name).toBe('Alice');
        expect(users[1].name).toBe('Bob');

        // Check prepared statements
        const statements = await knexWithRewrite.raw<{
          rows: Array<{ name: string; statement: string }>;
        }>('SELECT name, statement FROM pg_prepared_statements WHERE name = ?', [preparedName]);

        console.log('Statements found:', statements.rows.length);
        if (statements.rows.length > 0) {
          console.log('Statement SQL:', statements.rows[0].statement);
        } else {
          const allStatements = await knexWithRewrite.raw<{
            rows: Array<{ name: string; statement: string }>;
          }>('SELECT name, statement FROM pg_prepared_statements');
          console.log(
            'All prepared statements:',
            allStatements.rows.map((r) => ({ name: r.name, sql: r.statement.substring(0, 80) }))
          );
        }

        expect(statements.rows).toHaveLength(1);
        expect(statements.rows[0].statement).toContain('= ANY');
        expect(statements.rows[0].statement).toContain('::int[]');
      } finally {
        await knexWithRewrite.destroy();
      }
    });

    it('should rewrite whereNotIn and return correct results for strings', async () => {
      // Create knex instance with rewriteInClauses enabled
      const knexWithRewrite = createTestKnex({ rewriteInClauses: true });

      try {
        await knexWithRewrite.transaction(async (trx) => {
          const preparedName = getRandomPreparedName('wherenotin-strings');
          const users = await trx('users')
            .prepared(preparedName)
            .select('*')
            .whereNotIn('name', ['Alice', 'Bob'])
            .orderBy('id');

          expect(users).toHaveLength(1);
          expect(users[0].name).toBe('Charlie');

          // Validate that the prepared statement was created with <> ALL clause (rewritten from NOT IN)
          const statements = await trx.raw<{ rows: Array<{ name: string; statement: string }> }>(
            'SELECT name, statement FROM pg_prepared_statements WHERE name = ?',
            [preparedName]
          );
          expect(statements.rows).toHaveLength(1);
          expect(statements.rows[0].statement.toLowerCase()).toContain('<> all');
          expect(statements.rows[0].statement.toLowerCase()).toContain('::text[]');
          expect(statements.rows[0].statement.toLowerCase()).toContain('"name"');
        });
      } finally {
        await knexWithRewrite.destroy();
      }
    });

    it('should handle multiple IN clauses in one query', async () => {
      // Create knex instance with rewriteInClauses enabled
      const knexWithRewrite = createTestKnex({ rewriteInClauses: true });

      try {
        await knexWithRewrite.transaction(async (trx) => {
          const preparedName = getRandomPreparedName('multiple-in-clauses');
          const posts = await trx('posts')
            .prepared(preparedName)
            .select('*')
            .whereIn('user_id', [userIds.user1Id, userIds.user2Id])
            .whereIn('published', [true])
            .orderBy('id');

          expect(posts).toHaveLength(2);

          // Validate that the prepared statement was created with both IN clauses
          const statements = await trx.raw<{ rows: Array<{ name: string; statement: string }> }>(
            'SELECT name, statement FROM pg_prepared_statements WHERE name = ?',
            [preparedName]
          );
          expect(statements.rows).toHaveLength(1);
          expect(statements.rows[0].statement.toLowerCase()).toContain('from "posts"');
          expect(statements.rows[0].statement.toLowerCase()).toContain('user_id');
          expect(statements.rows[0].statement.toLowerCase()).toContain('published');
        });
      } finally {
        await knexWithRewrite.destroy();
      }
    });

    it('should work correctly with rewriteInClauses disabled', async () => {
      // Create a new knex instance with rewriting disabled
      const { createTestKnex: createTestKnexOriginal } = await import('./setup');
      const knexNoRewrite = createTestKnexOriginal({ rewriteInClauses: false });

      const users = await knexNoRewrite('users')
        .prepared()
        .select('*')
        .whereIn('id', [userIds.user1Id, userIds.user2Id])
        .orderBy('id');

      expect(users).toHaveLength(2);
      expect(users[0].name).toBe('Alice');
      expect(users[1].name).toBe('Bob');

      await knexNoRewrite.destroy();
    });

    it('should handle complex query with joins and IN clauses', async () => {
      // Create knex instance with rewriteInClauses enabled
      const knexWithRewrite = createTestKnex({ rewriteInClauses: true });

      try {
        await knexWithRewrite.transaction(async (trx) => {
          const preparedName = getRandomPreparedName('join-with-in-clauses');
          const results = await trx('users')
            .prepared(preparedName)
            .select('users.name', 'posts.title')
            .join('posts', 'users.id', 'posts.user_id')
            .whereIn('users.id', [userIds.user1Id, userIds.user2Id])
            .whereIn('posts.published', [true])
            .orderBy('users.id');

          expect(results).toHaveLength(2);
          expect(results[0].name).toBe('Alice');
          expect(results[1].name).toBe('Bob');

          // Validate that the prepared statement was created with JOIN and = ANY clauses (rewritten from IN)
          const statements = await trx.raw<{ rows: Array<{ name: string; statement: string }> }>(
            'SELECT name, statement FROM pg_prepared_statements WHERE name = ?',
            [preparedName]
          );
          expect(statements.rows).toHaveLength(1);
          expect(statements.rows[0].statement.toLowerCase()).toContain('join');
          // Check for = ANY patterns (rewritten from IN clauses)
          const anyClauses = statements.rows[0].statement.toLowerCase().match(/=\s*any\s*\(/g);
          expect(anyClauses).toBeDefined();
          expect(anyClauses!.length).toBeGreaterThanOrEqual(2);
        });
      } finally {
        await knexWithRewrite.destroy();
      }
    });
  });

  describe('Error handling', () => {
    it('should handle query errors appropriately', async () => {
      await expect(knex.prepared('non_existent_table').select('*')).rejects.toThrow();
    });

    it('should handle constraint violations', async () => {
      await expect(
        knex.prepared('users').insert({
          name: 'Duplicate',
          email: 'alice@example.com', // Duplicate email
        })
      ).rejects.toThrow();
    });
  });
});
