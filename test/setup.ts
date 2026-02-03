import { config } from 'dotenv';
import Knex from 'knex';
import type { Knex as KnexType } from 'knex';
import { knexPrepared } from '../src/index';

// Load environment variables from .env file
config();

/**
 * Test setup utilities for PostgreSQL integration tests.
 *
 * ## Running Integration Tests
 *
 * Integration tests require a PostgreSQL database. You can run them in two ways:
 *
 * ### 1. Using .env file (recommended for local development)
 * Create a .env file (copy from .env.example):
 * ```bash
 * cp .env.example .env
 * # Edit .env with your database credentials
 * npm test
 * ```
 *
 * ### 2. Using environment variables
 * ```bash
 * export DB_HOST=localhost
 * export DB_PORT=5432
 * export DB_USER=postgres
 * export DB_PASSWORD=postgres
 * export DB_NAME=knex_prepared_test
 * npm test
 * ```
 *
 * ### 3. Docker (recommended for testing)
 * ```bash
 * docker run --name postgres-test -e POSTGRES_PASSWORD=postgres -p 5432:5432 -d postgres:16
 * npm test
 * docker stop postgres-test && docker rm postgres-test
 * ```
 *
 * ### 4. CI (GitHub Actions)
 * Tests run automatically in CI with PostgreSQL service container.
 */

/**
 * Creates a test Knex instance connected to PostgreSQL.
 *
 * Connection configuration is loaded from environment variables (.env file or process.env):
 * - DB_HOST (default: localhost)
 * - DB_PORT (default: 5432)
 * - DB_USER (default: postgres)
 * - DB_PASSWORD (default: postgres)
 * - DB_NAME (default: knex_prepared_test)
 *
 * @returns A Knex instance with prepared statement support
 */
export function createTestKnex() {
  const baseKnex = Knex({
    client: 'pg',
    connection: {
      host: process.env.DB_HOST || 'localhost',
      port: parseInt(process.env.DB_PORT || '5432', 10),
      user: process.env.DB_USER || 'postgres',
      password: process.env.DB_PASSWORD || 'postgres',
      database: process.env.DB_NAME || 'knex_prepared_test',
    },
    pool: {
      min: 2,
      max: 10,
    },
  });

  return knexPrepared(baseKnex);
}

/**
 * Sets up test tables in the database.
 *
 * @param knex - The Knex instance to use
 */
export async function setupTestTables(knex: KnexType) {
  // Drop existing tables if they exist
  await knex.schema.dropTableIfExists('posts');
  await knex.schema.dropTableIfExists('users');

  // Create users table
  await knex.schema.createTable('users', (table) => {
    table.increments('id').primary();
    table.string('name', 255).notNullable();
    table.string('email', 255).notNullable().unique();
    table.boolean('active').defaultTo(true);
    table.timestamps(true, true);
  });

  // Create posts table
  await knex.schema.createTable('posts', (table) => {
    table.increments('id').primary();
    table.integer('user_id').unsigned().notNullable().references('id').inTable('users');
    table.string('title', 255).notNullable();
    table.text('content');
    table.boolean('published').defaultTo(false);
    table.timestamps(true, true);
  });
}

/**
 * Seeds the database with test data.
 *
 * @param knex - The Knex instance to use
 * @returns Object containing the created record IDs
 */
export async function seedTestData(knex: KnexType) {
  // Insert test users
  const [user1Id] = await knex('users')
    .insert({
      name: 'Alice',
      email: 'alice@example.com',
      active: true,
    })
    .returning('id');

  const [user2Id] = await knex('users')
    .insert({
      name: 'Bob',
      email: 'bob@example.com',
      active: true,
    })
    .returning('id');

  const [user3Id] = await knex('users')
    .insert({
      name: 'Charlie',
      email: 'charlie@example.com',
      active: false,
    })
    .returning('id');

  // Insert test posts
  await knex('posts').insert([
    {
      user_id: user1Id,
      title: 'First Post',
      content: 'This is the first post',
      published: true,
    },
    {
      user_id: user1Id,
      title: 'Second Post',
      content: 'This is the second post',
      published: false,
    },
    {
      user_id: user2Id,
      title: 'Bob Post',
      content: 'This is Bob post',
      published: true,
    },
  ]);

  return {
    user1Id,
    user2Id,
    user3Id,
  };
}

/**
 * Cleans up test tables.
 *
 * @param knex - The Knex instance to use
 */
export async function teardownTestTables(knex: KnexType) {
  await knex.schema.dropTableIfExists('posts');
  await knex.schema.dropTableIfExists('users');
}
