import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestKnex, setupTestTables, seedTestData, teardownTestTables } from './setup';

describe('Integration tests with PostgreSQL', () => {
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
    it('should use the same prepared statement for identical queries', async () => {
      // Execute the same query multiple times
      const query1 = await knex.prepared('users').select('*').where('active', true);
      const query2 = await knex.prepared('users').select('*').where('active', true);
      const query3 = await knex.prepared('users').select('*').where('active', true);

      expect(query1).toHaveLength(2);
      expect(query2).toHaveLength(2);
      expect(query3).toHaveLength(2);

      // Query pg_prepared_statements to verify prepared statement exists
      const preparedStatements = await knex.raw<{ rows: Array<{ name: string }> }>(
        'SELECT name FROM pg_prepared_statements WHERE name LIKE ?',
        ['auto-%']
      );

      // Should have at least one prepared statement with auto- prefix
      expect(preparedStatements.rows.length).toBeGreaterThan(0);
    });

    it('should create different prepared statements for different queries', async () => {
      // Execute different queries
      await knex.prepared('users').select('*').where('active', true);
      await knex.prepared('users').select('*').where('active', false);
      await knex.prepared('posts').select('*').where('published', true);

      // Query pg_prepared_statements
      const preparedStatements = await knex.raw<{ rows: Array<{ name: string }> }>(
        'SELECT name FROM pg_prepared_statements WHERE name LIKE ?',
        ['auto-%']
      );

      // Should have multiple different prepared statements
      expect(preparedStatements.rows.length).toBeGreaterThanOrEqual(3);
    });

    it('should use custom prepared statement names', async () => {
      // Execute query with custom name
      await knex('users').prepared('my-custom-query').select('*').where('id', userIds.user1Id);

      // Query pg_prepared_statements
      const preparedStatements = await knex.raw<{ rows: Array<{ name: string }> }>(
        'SELECT name FROM pg_prepared_statements WHERE name = ?',
        ['my-custom-query']
      );

      expect(preparedStatements.rows).toHaveLength(1);
      expect(preparedStatements.rows[0].name).toBe('my-custom-query');
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
