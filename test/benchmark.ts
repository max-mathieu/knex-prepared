#!/usr/bin/env tsx
/* eslint-disable no-console */

/**
 * Performance Benchmark for knex-prepared
 *
 * This script compares the performance of prepared statements vs regular queries.
 *
 * Usage:
 *   npm run benchmark
 *   or
 *   npx tsx test/benchmark.ts
 *
 * Configuration:
 *   Create a .env file (copy from .env.example) or set environment variables:
 *   - DB_HOST (default: localhost)
 *   - DB_PORT (default: 5432)
 *   - DB_USER (default: postgres)
 *   - DB_PASSWORD (default: postgres)
 *   - DB_NAME (default: knex_prepared_test)
 *   - BENCHMARK_ITERATIONS (default: 1000)
 */

import { config } from 'dotenv';
import Knex from 'knex';
import { knexPrepared } from '../src/index';
import { setupTestTables, seedTestData, teardownTestTables } from './setup';

// Load environment variables from .env file
config();

interface BenchmarkResult {
  name: string;
  totalTime: number;
  avgTime: number;
  opsPerSec: number;
  iterations: number;
}

const ITERATIONS = parseInt(process.env.BENCHMARK_ITERATIONS || '1000', 10);
const WARMUP_ITERATIONS = 100;

/**
 * Run a benchmark function multiple times and measure performance
 */
async function benchmark(
  name: string,
  fn: () => Promise<unknown>,
  iterations: number = ITERATIONS
): Promise<BenchmarkResult> {
  // Warmup
  for (let i = 0; i < WARMUP_ITERATIONS; i++) {
    await fn();
  }

  // Actual benchmark
  const start = process.hrtime.bigint();

  for (let i = 0; i < iterations; i++) {
    await fn();
  }

  const end = process.hrtime.bigint();
  const totalTime = Number(end - start) / 1_000_000; // Convert to milliseconds
  const avgTime = totalTime / iterations;
  const opsPerSec = (iterations / totalTime) * 1000;

  return {
    name,
    totalTime,
    avgTime,
    opsPerSec,
    iterations,
  };
}

/**
 * Format benchmark results as a table
 */
function formatResults(results: BenchmarkResult[]): void {
  console.log('\n' + '='.repeat(100));
  console.log('BENCHMARK RESULTS');
  console.log('='.repeat(100));
  console.log(
    `${'Test'.padEnd(50)} | ${'Total (ms)'.padStart(12)} | ${'Avg (ms)'.padStart(10)} | ${'Ops/sec'.padStart(12)}`
  );
  console.log('-'.repeat(100));

  for (const result of results) {
    console.log(
      `${result.name.padEnd(50)} | ${result.totalTime.toFixed(2).padStart(12)} | ${result.avgTime.toFixed(3).padStart(10)} | ${result.opsPerSec.toFixed(0).padStart(12)}`
    );
  }

  console.log('='.repeat(100));

  // Calculate speedup comparisons
  if (results.length >= 2) {
    console.log('\nSPEEDUP ANALYSIS:');
    console.log('-'.repeat(100));

    for (let i = 1; i < results.length; i += 2) {
      const baseline = results[i - 1];
      const prepared = results[i];
      const speedup = baseline.avgTime / prepared.avgTime;
      const improvement = ((speedup - 1) * 100).toFixed(1);

      console.log(`${prepared.name}:`);
      console.log(`  Speedup: ${speedup.toFixed(2)}x`);
      console.log(`  Improvement: ${improvement}% faster than ${baseline.name}`);
      console.log();
    }
  }

  console.log('='.repeat(100));
  console.log(`Iterations per test: ${ITERATIONS.toLocaleString()}`);
  console.log(`Warmup iterations: ${WARMUP_ITERATIONS}`);
  console.log('='.repeat(100) + '\n');
}

async function main() {
  console.log('🚀 Starting knex-prepared benchmark...\n');

  // Create base Knex instance (no prepared statements)
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

  // Create knex-prepared instance
  const preparedKnex = knexPrepared(
    Knex({
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
    })
  );

  try {
    // Setup database
    console.log('📊 Setting up test database...');
    await setupTestTables(baseKnex);
    const { user1Id } = await seedTestData(baseKnex);
    console.log('✅ Database ready\n');

    const results: BenchmarkResult[] = [];

    // Benchmark 1: Simple SELECT by ID
    console.log('📈 Benchmark 1: Simple SELECT by ID...');
    results.push(
      await benchmark('1a. Regular query - SELECT by ID', async () => {
        await baseKnex('users').where('id', user1Id).first();
      })
    );

    results.push(
      await benchmark('1b. Prepared query - SELECT by ID', async () => {
        await preparedKnex.prepared('users').where('id', user1Id).first();
      })
    );

    // Benchmark 2: SELECT with WHERE clause
    console.log('📈 Benchmark 2: SELECT with WHERE clause...');
    results.push(
      await benchmark('2a. Regular query - SELECT WHERE active', async () => {
        await baseKnex('users').where('active', true).select('*');
      })
    );

    results.push(
      await benchmark('2b. Prepared query - SELECT WHERE active', async () => {
        await preparedKnex.prepared('users').where('active', true).select('*');
      })
    );

    // Benchmark 3: SELECT with multiple WHERE clauses
    console.log('📈 Benchmark 3: SELECT with multiple WHERE clauses...');
    results.push(
      await benchmark('3a. Regular query - Multiple WHERE', async () => {
        await baseKnex('users').where('active', true).where('name', 'like', 'A%').select('*');
      })
    );

    results.push(
      await benchmark('3b. Prepared query - Multiple WHERE', async () => {
        await preparedKnex
          .prepared('users')
          .where('active', true)
          .where('name', 'like', 'A%')
          .select('*');
      })
    );

    // Benchmark 4: Simple JOIN
    console.log('📈 Benchmark 4: Simple JOIN...');
    results.push(
      await benchmark('4a. Regular query - Simple JOIN', async () => {
        await baseKnex('users')
          .join('posts', 'users.id', 'posts.user_id')
          .where('users.id', user1Id)
          .select('users.name', 'posts.title');
      })
    );

    results.push(
      await benchmark('4b. Prepared query - Simple JOIN', async () => {
        await preparedKnex
          .prepared('users')
          .join('posts', 'users.id', 'posts.user_id')
          .where('users.id', user1Id)
          .select('users.name', 'posts.title');
      })
    );

    // Benchmark 5: Complex JOIN with multiple conditions
    console.log('📈 Benchmark 5: Complex JOIN with conditions...');
    results.push(
      await benchmark('5a. Regular query - Complex JOIN', async () => {
        await baseKnex('users')
          .join('posts', 'users.id', 'posts.user_id')
          .where('users.active', true)
          .where('posts.published', true)
          .orderBy('posts.created_at', 'desc')
          .limit(10)
          .select('users.name', 'posts.title', 'posts.created_at');
      })
    );

    results.push(
      await benchmark('5b. Prepared query - Complex JOIN', async () => {
        await preparedKnex
          .prepared('users')
          .join('posts', 'users.id', 'posts.user_id')
          .where('users.active', true)
          .where('posts.published', true)
          .orderBy('posts.created_at', 'desc')
          .limit(10)
          .select('users.name', 'posts.title', 'posts.created_at');
      })
    );

    // Benchmark 6: Aggregation with GROUP BY
    console.log('📈 Benchmark 6: Aggregation with GROUP BY...');
    results.push(
      await benchmark('6a. Regular query - GROUP BY', async () => {
        await baseKnex('posts')
          .select('user_id')
          .count('* as post_count')
          .groupBy('user_id')
          .orderBy('user_id');
      })
    );

    results.push(
      await benchmark('6b. Prepared query - GROUP BY', async () => {
        await preparedKnex
          .prepared('posts')
          .select('user_id')
          .count('* as post_count')
          .groupBy('user_id')
          .orderBy('user_id');
      })
    );

    // Display results
    formatResults(results);

    // Cleanup
    console.log('🧹 Cleaning up...');
    await teardownTestTables(baseKnex);
    await baseKnex.destroy();
    await preparedKnex.destroy();

    console.log('✅ Benchmark complete!\n');
  } catch (error) {
    console.error('❌ Benchmark failed:', error);
    await baseKnex.destroy();
    await preparedKnex.destroy();
    process.exit(1);
  }
}

// Run benchmark if executed directly
if (require.main === module) {
  main().catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}
