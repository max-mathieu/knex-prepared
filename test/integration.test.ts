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

  describe('Factory method: knex.prepared(table)', () => {
    it('should execute SELECT query with auto-generated prepared statement', async () => {
      const users = await knex.prepared('users').select('*').orderBy('id');

      expect(users).toHaveLength(3);
      expect(users[0].name).toBe('Alice');
      expect(users[1].name).toBe('Bob');
      expect(users[2].name).toBe('Charlie');
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
      const [newUser] = await knex
        .prepared('users')
        .insert({
          name: 'David',
          email: 'david@example.com',
          active: true,
        })
        .returning('*');

      expect(newUser.name).toBe('David');
      expect(newUser.email).toBe('david@example.com');

      // Clean up
      await knex('users').where('id', newUser.id).delete();
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
      const users = await knex('users')
        .prepared('get-active-users')
        .select('*')
        .where('active', true)
        .orderBy('name');

      expect(users).toHaveLength(2);
      expect(users[0].name).toBe('Alice');
    });

    it('should work with prepared(false) to disable', async () => {
      // This should execute without a prepared statement
      const users = await knex('users').prepared(false).select('*');

      expect(users).toHaveLength(3);
    });
  });

  describe('Prepared statement caching verification', () => {
    it('should create prepared statements in PostgreSQL', async () => {
      // Use a raw connection to ensure all queries are on the same connection
      await knex.raw('SELECT 1', [], {
        connection: async (connection) => {
          // Execute queries with prepared statements using the same connection
          await knex('users')
            .prepared()
            .select('*')
            .where('active', true)
            .connection(connection);
          await knex('users')
            .prepared()
            .select('*')
            .where('active', true)
            .connection(connection);

          // Query pg_prepared_statements on the same connection
          const result = await knex
            .raw<{ rows: Array<{ name: string; statement: string }> }>(
              'SELECT name, statement FROM pg_prepared_statements WHERE name LIKE ?',
              ['auto-%']
            )
            .connection(connection);

          // Should have at least one prepared statement
          expect(result.rows.length).toBeGreaterThan(0);
          expect(result.rows[0].name).toMatch(/^auto-[0-9a-f]{16}$/);
          expect(result.rows[0].statement).toContain('SELECT');
        },
      });
    });

    it('should reuse the same prepared statement for identical queries', async () => {
      await knex.raw('SELECT 1', [], {
        connection: async (connection) => {
          // Execute the same query multiple times
          await knex('users')
            .prepared()
            .select('*')
            .where('active', true)
            .connection(connection);
          await knex('users')
            .prepared()
            .select('*')
            .where('active', true)
            .connection(connection);
          await knex('users')
            .prepared()
            .select('*')
            .where('active', true)
            .connection(connection);

          // Check that only ONE prepared statement was created for this SQL
          const result = await knex
            .raw<{ rows: Array<{ name: string }> }>(
              "SELECT name FROM pg_prepared_statements WHERE statement LIKE '%active%'"
            )
            .connection(connection);

          // Should have exactly 1 prepared statement (reused 3 times)
          expect(result.rows.length).toBe(1);
          expect(result.rows[0].name).toMatch(/^auto-[0-9a-f]{16}$/);
        },
      });
    });

    it('should create different prepared statements for different queries', async () => {
      await knex.raw('SELECT 1', [], {
        connection: async (connection) => {
          // Execute queries with different SQL
          await knex('users')
            .prepared()
            .select('*')
            .where('active', true)
            .connection(connection);
          await knex('users').prepared().select('id', 'name').connection(connection);
          await knex('posts')
            .prepared()
            .select('*')
            .where('published', true)
            .connection(connection);

          // Query all auto-generated prepared statements
          const result = await knex
            .raw<{ rows: Array<{ name: string }> }>(
              'SELECT name FROM pg_prepared_statements WHERE name LIKE ?',
              ['auto-%']
            )
            .connection(connection);

          // Should have at least 3 different prepared statements
          expect(result.rows.length).toBeGreaterThanOrEqual(3);
        },
      });
    });

    it('should use custom prepared statement names', async () => {
      await knex.raw('SELECT 1', [], {
        connection: async (connection) => {
          // Execute query with custom name
          await knex('users')
            .prepared('my-custom-query')
            .select('*')
            .where('id', userIds.user1Id)
            .connection(connection);

          // Verify the custom name appears in pg_prepared_statements
          const result = await knex
            .raw<{ rows: Array<{ name: string; statement: string }> }>(
              'SELECT name, statement FROM pg_prepared_statements WHERE name = ?',
              ['my-custom-query']
            )
            .connection(connection);

          expect(result.rows).toHaveLength(1);
          expect(result.rows[0].name).toBe('my-custom-query');
          expect(result.rows[0].statement).toContain('SELECT');
        },
      });
    });
  });

  describe('Complex queries', () => {
    it('should handle queries with multiple WHERE clauses', async () => {
      const results = await knex
        .prepared('users')
        .select('*')
        .where('active', true)
        .where('name', 'like', 'A%');

      expect(results).toHaveLength(1);
      expect(results[0].name).toBe('Alice');
    });

    it('should handle queries with WHERE IN', async () => {
      const results = await knex
        .prepared('users')
        .select('*')
        .whereIn('id', [userIds.user1Id, userIds.user2Id]);

      expect(results).toHaveLength(2);
    });

    it('should handle queries with ORDER BY and LIMIT', async () => {
      const results = await knex.prepared('users').select('*').orderBy('name', 'asc').limit(2);

      expect(results).toHaveLength(2);
      expect(results[0].name).toBe('Alice');
      expect(results[1].name).toBe('Bob');
    });

    it('should handle queries with OFFSET', async () => {
      const results = await knex
        .prepared('users')
        .select('*')
        .orderBy('name', 'asc')
        .limit(2)
        .offset(1);

      expect(results).toHaveLength(2);
      expect(results[0].name).toBe('Bob');
      expect(results[1].name).toBe('Charlie');
    });

    it('should handle queries with aggregations', async () => {
      const result = await knex.prepared('users').count('* as count').where('active', true).first();

      expect(result?.count).toBe('2');
    });

    it('should handle queries with GROUP BY', async () => {
      const results = await knex
        .prepared('posts')
        .select('user_id')
        .count('* as post_count')
        .groupBy('user_id')
        .orderBy('user_id');

      expect(results).toHaveLength(2);
      expect(results[0].post_count).toBe('2');
      expect(results[1].post_count).toBe('1');
    });

    it('should handle LEFT JOIN queries', async () => {
      // Create a user with no posts
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

      // Clean up
      await knex('users').where('id', lonelyUser.id).delete();
    });
  });

  describe('Subqueries', () => {
    it('should handle subqueries in WHERE clause', async () => {
      const subquery = knex('posts').select('user_id').where('published', true).groupBy('user_id');

      const results = await knex.prepared('users').select('*').whereIn('id', subquery);

      expect(results).toHaveLength(2);
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
