#!/usr/bin/env tsx
/* eslint-disable no-console */

import { config } from 'dotenv';
import { writeFileSync } from 'fs';
import path from 'path';
import Knex from 'knex';
import { knexPrepared, KnexPreparedOptions } from '../src/index';

config();

const ITERATIONS = parseInt(process.env.BENCHMARK_ITERATIONS || '1000', 10);
const WARMUP_ITERATIONS = 10;
const TABLE_USER_ROWS = 1000;
const TABLE_POST_ROWS = 5000;
const IN_CLAUSE_QUERY_VARIANTS = 10; // Number of different queries for in clauses benchmark

const DB_CONFIG = {
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432', 10),
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres',
  database: process.env.DB_NAME || 'knex_prepared_test',
};

interface BenchmarkStats {
  p50: number;
  p90: number;
  p99: number;
  avg: number;
}

function calculateStats(times: number[]): BenchmarkStats {
  const sorted = [...times].sort((a, b) => a - b);
  const len = sorted.length;

  return {
    p50: sorted[Math.floor(len * 0.5)],
    p90: sorted[Math.floor(len * 0.9)],
    p99: sorted[Math.floor(len * 0.99)],
    avg: sorted.reduce((a, b) => a + b, 0) / len,
  };
}

interface QueryConfig {
  tableName: string;
  build: (query: any) => any;
}

async function runBenchmark(
  name: string,
  fns: Array<() => Promise<unknown>>,
  iterations: number,
  warmup: number
): Promise<BenchmarkStats> {
  console.log(
    `  Running ${name}, ${iterations.toLocaleString()} iterations + ${warmup} warmup)...`
  );

  // Warmup: execute all query variants
  for (let i = 0; i < warmup; i++) {
    for (const fn of fns) {
      await fn();
    }
  }

  const allStart = process.hrtime.bigint();
  const times: number[] = [];
  for (let i = 0; i < iterations; i++) {
    const start = process.hrtime.bigint();
    // Execute all query variants in each iteration
    for (const fn of fns) {
      await fn();
    }
    const end = process.hrtime.bigint();
    times.push(Number(end - start) / 1_000_000);
  }

  console.log(
    `  ✓ ${name} complete in ${(Number(process.hrtime.bigint() - allStart) / 1e9).toFixed(1)}s (warmup excluded)`
  );

  return calculateStats(times);
}

async function benchmark(
  name: string,
  queryConfigs: QueryConfig[],
  iterations: number = ITERATIONS,
  warmup: number = WARMUP_ITERATIONS
): Promise<{ regular: BenchmarkStats; prepared: BenchmarkStats }> {
  const knex = getBenchmarkKnex();
  const regularFns = queryConfigs.map(
    (config) => async () => await config.build(knex(config.tableName))
  );
  const regular = await runBenchmark(`${name} on knex`, regularFns, iterations, warmup);
  await knex.destroy();

  await coolDown(2);

  const preparedKnex = getPreparedKnex();
  const preparedFns = queryConfigs.map(
    (config) => async () => await config.build(preparedKnex.prepared(config.tableName))
  );
  const prepared = await runBenchmark(`${name} on knexPrepared`, preparedFns, iterations, warmup);
  await preparedKnex.destroy();

  await coolDown(5);

  return { regular, prepared };
}

async function benchmarkInClauses(
  name: string,
  queryConfigs: QueryConfig[],
  iterations: number = ITERATIONS,
  warmup: number = WARMUP_ITERATIONS
): Promise<{
  regular: BenchmarkStats;
  prepared: BenchmarkStats;
  rewrite: BenchmarkStats;
}> {
  console.log(
    `  Running ${name} (${queryConfigs.length} variants, ${iterations.toLocaleString()} iterations + ${warmup} warmup)...`
  );

  const allStart = process.hrtime.bigint();

  // Run regular knex
  console.log(`    -> Regular knex...`);
  const knex = getBenchmarkKnex();
  const regularFns = queryConfigs.map(
    (config) => async () => await config.build(knex(config.tableName))
  );
  const regular = await runBenchmark(`${name} on knex`, regularFns, iterations, warmup);
  await knex.destroy();

  await coolDown(2);

  const preparedKnex = getPreparedKnex();
  const preparedFns = queryConfigs.map(
    (config) => async () => await config.build(preparedKnex.prepared(config.tableName))
  );
  const prepared = await runBenchmark(`${name} on knexPrepared`, preparedFns, iterations, warmup);
  await preparedKnex.destroy();

  await coolDown(2);

  const rewriteKnex = getPreparedKnex({ rewriteInClauses: true });
  const rewriteFns = queryConfigs.map(
    (config) => async () => await config.build(rewriteKnex.prepared(config.tableName))
  );
  const rewrite = await runBenchmark(
    `${name} on knexPrepared w/ rewriteInClauses`,
    rewriteFns,
    iterations,
    warmup
  );
  await rewriteKnex.destroy();

  console.log(
    `  ✓ ${name} complete in ${(Number(process.hrtime.bigint() - allStart) / 1e9).toFixed(1)}s`
  );

  await coolDown(5);

  return { regular, prepared, rewrite };
}

async function coolDown(delaySeconds: number) {
  console.log(
    `  ⏱ Cooling down for ${delaySeconds} ${delaySeconds === 1 ? 'second' : 'seconds'}...`
  );
  await new Promise((resolve) => setTimeout(resolve, delaySeconds * 1000));
}

function getBenchmarkKnex() {
  return Knex({
    client: 'pg',
    connection: DB_CONFIG,
    pool: { min: 1, max: 1 },
  });
}

function getPreparedKnex(options?: KnexPreparedOptions) {
  const baseKnex = getBenchmarkKnex();
  return knexPrepared(baseKnex, { disableWarnings: true, ...options });
}

async function teardown() {
  const knex = getBenchmarkKnex();
  await knex.schema.dropTableIfExists('posts');
  await knex.schema.dropTableIfExists('users');
  await knex.destroy();
}

async function setupDatabase() {
  const knex = getBenchmarkKnex();
  await teardown();

  await knex.schema.createTable('users', (table) => {
    table.increments('id').primary();
    table.string('name', 255).notNullable();
    table.string('email', 255).notNullable();
    table.boolean('active').defaultTo(true);
    table.integer('age');
    table.timestamps(true, true);
  });

  await knex.schema.createTable('posts', (table) => {
    table.increments('id').primary();
    table.integer('user_id').unsigned().notNullable().references('id').inTable('users');
    table.string('title', 255).notNullable();
    table.text('content');
    table.boolean('published').defaultTo(false);
    table.timestamps(true, true);
    table.index(['user_id'], 'idx_posts_user_id');
  });

  const userInserts = [];
  for (let i = 0; i < TABLE_USER_ROWS; i++) {
    userInserts.push({
      name: `User ${i}`,
      email: `user${i}@example.com`,
      active: i % 3 !== 0,
      age: 20 + (i % 50),
    });
  }
  await knex.batchInsert('users', userInserts, 100);

  const postInserts = [];
  for (let i = 0; i < TABLE_POST_ROWS * 10; i++) {
    postInserts.push({
      user_id: 1 + (i % TABLE_USER_ROWS),
      title: `Post ${i}`,
      content: `Content for post ${i}`,
      published: i % 2 === 0,
    });
  }
  await knex.batchInsert('posts', postInserts, 100);

  await knex.destroy();
}

function formatStatsTable(regular: BenchmarkStats, prepared: BenchmarkStats): string {
  const reduction = (metric: keyof BenchmarkStats) => {
    const pct = ((prepared[metric] - regular[metric]) / regular[metric]) * 100;
    return pct > 0 ? `+${pct.toFixed(1)}%` : `${pct.toFixed(1)}%`;
  };

  return `| Metric | Regular (ms) | Prepared (ms) | Change |
|--------|--------------|---------------|--------|
| P50 | ${regular.p50.toFixed(3)} | ${prepared.p50.toFixed(3)} | ${reduction('p50')} |
| P90 | ${regular.p90.toFixed(3)} | ${prepared.p90.toFixed(3)} | ${reduction('p90')} |
| P99 | ${regular.p99.toFixed(3)} | ${prepared.p99.toFixed(3)} | ${reduction('p99')} |
| Avg | ${regular.avg.toFixed(3)} | ${prepared.avg.toFixed(3)} | ${reduction('avg')} |`;
}

function formatInClauseTable(
  regular: BenchmarkStats,
  prepared: BenchmarkStats,
  rewrite: BenchmarkStats
): string {
  const change1 = (metric: keyof BenchmarkStats) => {
    const pct = ((prepared[metric] - regular[metric]) / regular[metric]) * 100;
    return pct > 0 ? `+${pct.toFixed(1)}%` : `${pct.toFixed(1)}%`;
  };
  const change2 = (metric: keyof BenchmarkStats) => {
    const pct = ((rewrite[metric] - regular[metric]) / regular[metric]) * 100;
    return pct > 0 ? `+${pct.toFixed(1)}%` : `${pct.toFixed(1)}%`;
  };

  return `| Metric | Default (ms) | Prepared (ms) | Prepared + Rewrite (ms) | Prepared Change | Rewrite Change |
|--------|--------------|---------------|-------------------------|-----------------|----------------|
| P50 | ${regular.p50.toFixed(3)} | ${prepared.p50.toFixed(3)} | ${rewrite.p50.toFixed(3)} | ${change1('p50')} | ${change2('p50')} |
| P90 | ${regular.p90.toFixed(3)} | ${prepared.p90.toFixed(3)} | ${rewrite.p90.toFixed(3)} | ${change1('p90')} | ${change2('p90')} |
| P99 | ${regular.p99.toFixed(3)} | ${prepared.p99.toFixed(3)} | ${rewrite.p99.toFixed(3)} | ${change1('p99')} | ${change2('p99')} |
| Avg | ${regular.avg.toFixed(3)} | ${prepared.avg.toFixed(3)} | ${rewrite.avg.toFixed(3)} | ${change1('avg')} | ${change2('avg')} |`;
}

async function main() {
  console.log('🚀 Starting knex-prepared benchmark...\n');

  try {
    console.log('📊 Setting up database...');
    await setupDatabase();
    console.log(`✅ Created ${TABLE_USER_ROWS} users and ${TABLE_POST_ROWS} posts\n`);

    const markdown: string[] = [];
    markdown.push('# knex-prepared Benchmark Results\n');
    markdown.push(`**Generated:** ${new Date().toISOString()}\n`);
    markdown.push(`**Iterations per test:** ${ITERATIONS.toLocaleString()}`);
    markdown.push(
      `**Warmup iterations:** ${WARMUP_ITERATIONS} (excluded from measurements to ensure stable results)`
    );
    markdown.push(`**Connection pool:** Single connection (min: 1, max: 1) for consistent results`);
    markdown.push(
      `**Test Data:** ${TABLE_USER_ROWS.toLocaleString()} users, ${TABLE_POST_ROWS.toLocaleString()} posts\n`
    );
    markdown.push(
      '**Methodology:** Each iteration executes all query variants to properly test prepared statement caching. '
    );
    markdown.push(
      'With named prepared statements, each distinct query is cached and reused. Without names, PostgreSQL must reparse/replan for each different query.\n'
    );

    console.log('📈 Running benchmarks...\n');

    console.log('1/7:  Simple SELECT queries');
    const { regular: selectById, prepared: selectByIdPrepared } = await benchmark(
      'Simple SELECT',
      [
        { tableName: 'users', build: (q) => q.where('id', 10).first() },
        { tableName: 'posts', build: (q) => q.where('id', 20).first() },
        { tableName: 'users', build: (q) => q.where('email', 'user10@example.com').first() },
        { tableName: 'posts', build: (q) => q.where('user_id', 15).first() },
        { tableName: 'users', build: (q) => q.where('name', 'User 25').first() },
        { tableName: 'posts', build: (q) => q.where('title', 'Post 30').first() },
        { tableName: 'users', build: (q) => q.where('age', 35).first() },
        { tableName: 'posts', build: (q) => q.where('published', true).first() },
        { tableName: 'users', build: (q) => q.where('active', true).first() },
        { tableName: 'posts', build: (q) => q.where('content', 'Content for post 40').first() },
      ],
      ITERATIONS,
      WARMUP_ITERATIONS
    );
    markdown.push('## Simple SELECT Queries\n');
    markdown.push(formatStatsTable(selectById, selectByIdPrepared) + '\n');

    console.log('2/7:  SELECT with WHERE clause');
    const { regular: selectWhere, prepared: selectWherePrepared } = await benchmark(
      'SELECT with WHERE',
      [
        { tableName: 'users', build: (q) => q.where('age', '>', 30).select('*') },
        { tableName: 'posts', build: (q) => q.where('published', false).select('*') },
        { tableName: 'users', build: (q) => q.where('active', true).select('id', 'name') },
        {
          tableName: 'posts',
          build: (q) => q.where('user_id', '<', 50).select('title', 'content'),
        },
        { tableName: 'users', build: (q) => q.where('name', 'like', 'User 1%').select('*') },
        { tableName: 'posts', build: (q) => q.where('title', 'like', 'Post 2%').select('*') },
        { tableName: 'users', build: (q) => q.where('age', '>=', 40).select('email', 'age') },
        { tableName: 'posts', build: (q) => q.where('id', '<=', 100).select('*') },
        {
          tableName: 'users',
          build: (q) => q.where('email', 'like', '%@example.com').select('name'),
        },
        { tableName: 'posts', build: (q) => q.whereNot('published', true).select('id', 'title') },
      ],
      ITERATIONS,
      WARMUP_ITERATIONS
    );
    markdown.push('## SELECT with WHERE Clause\n');
    markdown.push(formatStatsTable(selectWhere, selectWherePrepared) + '\n');

    console.log('3/7:  Multiple WHERE conditions');
    const { regular: multiWhere, prepared: multiWherePrepared } = await benchmark(
      'Multiple WHERE',
      [
        {
          tableName: 'users',
          build: (q) => q.where('active', true).where('age', '>', 30).select('*'),
        },
        {
          tableName: 'posts',
          build: (q) => q.where('published', true).where('user_id', '<', 50).select('*'),
        },
        {
          tableName: 'users',
          build: (q) => q.where('age', '>=', 25).where('name', 'like', 'User%').select('id'),
        },
        {
          tableName: 'posts',
          build: (q) =>
            q.where('published', false).where('title', 'like', 'Post%').select('id', 'title'),
        },
        {
          tableName: 'users',
          build: (q) =>
            q.where('active', true).where('email', 'like', '%@example.com').select('name'),
        },
        {
          tableName: 'posts',
          build: (q) => q.where('user_id', '>', 10).where('id', '<', 1000).select('*'),
        },
        {
          tableName: 'users',
          build: (q) => q.where('age', '<', 40).whereNot('active', false).select('*'),
        },
        {
          tableName: 'posts',
          build: (q) =>
            q.where('published', true).whereNot('content', null).select('title', 'content'),
        },
        {
          tableName: 'users',
          build: (q) => q.where('id', '>', 100).where('age', '<=', 50).select('id', 'name', 'age'),
        },
        {
          tableName: 'posts',
          build: (q) =>
            q.whereNot('user_id', 1).where('published', true).select('user_id', 'title'),
        },
      ],
      ITERATIONS,
      WARMUP_ITERATIONS
    );
    markdown.push('## Multiple WHERE Conditions\n');
    markdown.push(formatStatsTable(multiWhere, multiWherePrepared) + '\n');

    await coolDown(5);

    console.log('4/7:  Simple JOIN');
    const { regular: join, prepared: joinPrepared } = await benchmark(
      'Simple JOIN',
      [
        {
          tableName: 'users',
          build: (q) =>
            q
              .join('posts', 'users.id', 'posts.user_id')
              .where('users.id', 10)
              .select('users.name', 'posts.title'),
        },
        {
          tableName: 'posts',
          build: (q) =>
            q
              .join('users', 'posts.user_id', 'users.id')
              .where('posts.published', true)
              .select('posts.title', 'users.email'),
        },
        {
          tableName: 'users',
          build: (q) =>
            q
              .leftJoin('posts', 'users.id', 'posts.user_id')
              .where('users.active', true)
              .select('users.id', 'posts.id as post_id'),
        },
        {
          tableName: 'posts',
          build: (q) =>
            q
              .innerJoin('users', 'posts.user_id', 'users.id')
              .where('users.age', '>', 30)
              .select('posts.content', 'users.name'),
        },
        {
          tableName: 'users',
          build: (q) =>
            q
              .join('posts', 'users.id', 'posts.user_id')
              .where('posts.id', '<', 100)
              .select('users.email', 'posts.title', 'posts.id'),
        },
        {
          tableName: 'posts',
          build: (q) =>
            q
              .leftJoin('users', 'posts.user_id', 'users.id')
              .where('posts.user_id', '>', 5)
              .select('users.name', 'users.active', 'posts.published'),
        },
        {
          tableName: 'users',
          build: (q) =>
            q
              .join('posts', 'users.id', 'posts.user_id')
              .where('users.name', 'like', 'User%')
              .select('users.id', 'users.name'),
        },
        {
          tableName: 'posts',
          build: (q) =>
            q
              .join('users', 'posts.user_id', 'users.id')
              .where('posts.title', 'like', 'Post%')
              .select('posts.id', 'users.id as user_id'),
        },
        {
          tableName: 'users',
          build: (q) =>
            q
              .leftJoin('posts', 'users.id', 'posts.user_id')
              .where('users.id', '<=', 50)
              .select('users.name', 'users.age', 'posts.title'),
        },
        {
          tableName: 'posts',
          build: (q) =>
            q
              .innerJoin('users', 'posts.user_id', 'users.id')
              .whereNot('posts.published', false)
              .select('posts.title', 'posts.content', 'users.email'),
        },
      ],
      ITERATIONS,
      WARMUP_ITERATIONS
    );
    markdown.push('## Simple JOIN\n');
    markdown.push(formatStatsTable(join, joinPrepared) + '\n');

    await coolDown(5);

    console.log('5/7:  Complex JOIN with conditions');
    const { regular: complexJoin, prepared: complexJoinPrepared } = await benchmark(
      'Complex JOIN',
      [
        {
          tableName: 'users',
          build: (q) =>
            q
              .join('posts', 'users.id', 'posts.user_id')
              .where('users.active', true)
              .where('posts.published', true)
              .orderBy('posts.created_at', 'desc')
              .limit(10)
              .select('users.name', 'posts.title', 'posts.created_at'),
        },
        {
          tableName: 'posts',
          build: (q) =>
            q
              .leftJoin('users', 'posts.user_id', 'users.id')
              .where('users.age', '>', 25)
              .where('posts.id', '<', 500)
              .orderBy('users.name', 'asc')
              .limit(15)
              .select('posts.title', 'users.email', 'users.age'),
        },
        {
          tableName: 'users',
          build: (q) =>
            q
              .innerJoin('posts', 'users.id', 'posts.user_id')
              .whereNot('users.active', false)
              .where('posts.published', false)
              .orderBy('posts.id', 'asc')
              .limit(20)
              .select('users.id', 'users.name', 'posts.content'),
        },
        {
          tableName: 'posts',
          build: (q) =>
            q
              .join('users', 'posts.user_id', 'users.id')
              .where('users.name', 'like', 'User%')
              .where('posts.user_id', '>', 10)
              .orderBy('posts.title', 'desc')
              .limit(5)
              .select('posts.id', 'posts.title', 'users.active'),
        },
        {
          tableName: 'users',
          build: (q) =>
            q
              .leftJoin('posts', 'users.id', 'posts.user_id')
              .where('users.id', '<=', 100)
              .whereNot('posts.published', true)
              .orderBy('users.created_at', 'desc')
              .limit(8)
              .select('users.email', 'posts.title', 'posts.published'),
        },
        {
          tableName: 'posts',
          build: (q) =>
            q
              .innerJoin('users', 'posts.user_id', 'users.id')
              .where('posts.title', 'like', 'Post%')
              .where('users.active', true)
              .orderBy('users.age', 'asc')
              .limit(12)
              .select('posts.content', 'users.name', 'users.email'),
        },
        {
          tableName: 'users',
          build: (q) =>
            q
              .join('posts', 'users.id', 'posts.user_id')
              .where('users.age', '>=', 30)
              .where('posts.id', '>', 100)
              .orderBy('posts.updated_at', 'desc')
              .limit(25)
              .select('users.id', 'posts.id as post_id', 'posts.updated_at'),
        },
        {
          tableName: 'posts',
          build: (q) =>
            q
              .leftJoin('users', 'posts.user_id', 'users.id')
              .where('posts.published', true)
              .where('users.email', 'like', '%@example.com')
              .orderBy('posts.created_at', 'asc')
              .limit(7)
              .select('posts.title', 'posts.created_at', 'users.name'),
        },
        {
          tableName: 'users',
          build: (q) =>
            q
              .innerJoin('posts', 'users.id', 'posts.user_id')
              .where('users.active', false)
              .where('posts.content', 'like', 'Content%')
              .orderBy('users.id', 'desc')
              .limit(18)
              .select('users.name', 'users.active', 'posts.title'),
        },
        {
          tableName: 'posts',
          build: (q) =>
            q
              .join('users', 'posts.user_id', 'users.id')
              .whereNot('users.age', null)
              .where('posts.user_id', '<', 50)
              .orderBy('users.email', 'asc')
              .limit(30)
              .select('posts.id', 'users.age', 'users.email', 'posts.published'),
        },
      ],
      ITERATIONS,
      WARMUP_ITERATIONS
    );
    markdown.push('## Complex JOIN with Conditions\n');
    markdown.push(formatStatsTable(complexJoin, complexJoinPrepared) + '\n');

    await coolDown(5);

    console.log('6/7:  Aggregation with GROUP BY');
    const { regular: groupBy, prepared: groupByPrepared } = await benchmark(
      'Aggregation',
      [
        {
          tableName: 'posts',
          build: (q) => q.select('user_id').count('* as post_count').groupBy('user_id'),
        },
        {
          tableName: 'posts',
          build: (q) =>
            q.select('published').count('* as count').groupBy('published').orderBy('count', 'desc'),
        },
        {
          tableName: 'users',
          build: (q) => {
            const knex = q.client;
            return q
              .select('active')
              .avg('age as avg_age')
              .groupBy('active')
              .having(knex.raw('avg(age) > ?', [25]));
          },
        },
        {
          tableName: 'posts',
          build: (q) => {
            const knex = q.client;
            return q
              .select('user_id')
              .where('published', true)
              .count('id as total')
              .groupBy('user_id')
              .having(knex.raw('count(id) > ?', [5]));
          },
        },
        {
          tableName: 'users',
          build: (q) =>
            q.select('age').count('* as user_count').groupBy('age').orderBy('age', 'asc'),
        },
        {
          tableName: 'posts',
          build: (q) => {
            const knex = q.client;
            return q
              .select('published', 'user_id')
              .count('* as cnt')
              .groupBy('published', 'user_id')
              .having(knex.raw('count(*) > ?', [3]));
          },
        },
        {
          tableName: 'users',
          build: (q) =>
            q
              .select('active')
              .where('age', '>', 20)
              .count('id as total_users')
              .groupBy('active')
              .orderBy('total_users', 'desc'),
        },
        {
          tableName: 'posts',
          build: (q) => {
            const knex = q.client;
            return q
              .select('user_id')
              .where('id', '<', 1000)
              .sum('id as sum_ids')
              .groupBy('user_id')
              .having(knex.raw('sum(id) > ?', [100]));
          },
        },
        {
          tableName: 'users',
          build: (q) =>
            q
              .select('active', 'age')
              .count('* as count')
              .groupBy('active', 'age')
              .orderBy('count', 'asc'),
        },
        {
          tableName: 'posts',
          build: (q) => {
            const knex = q.client;
            return q
              .select('published')
              .where('user_id', '<', 50)
              .avg('user_id as avg_user_id')
              .groupBy('published')
              .having(knex.raw('avg(user_id) > ?', [10]));
          },
        },
      ],
      ITERATIONS,
      WARMUP_ITERATIONS
    );
    markdown.push('## Aggregation with GROUP BY\n');
    markdown.push(formatStatsTable(groupBy, groupByPrepared) + '\n');

    await coolDown(10);

    // Test 7 - IN clauses
    console.log('7/7:  IN clauses with rewriteInClauses');
    markdown.push('## IN Clauses with rewriteInClauses Option\n');
    markdown.push(
      `The \`rewriteInClauses\` option enables prepared statement name generation that accounts for IN clause size. `
    );
    markdown.push(
      `This test uses ${IN_CLAUSE_QUERY_VARIANTS} different IN clause sizes. Each iteration executes all ${IN_CLAUSE_QUERY_VARIANTS} queries. `
    );
    markdown.push(`**Default**: No prepared statements. `);
    markdown.push(
      `**Prepared**: Uses prepared statements, creates ${IN_CLAUSE_QUERY_VARIANTS} different statements (one per size). `
    );
    markdown.push(
      `**Prepared + Rewrite**: Uses prepared statements with \`rewriteInClauses\`, creates only 1 statement and reuses it.\n`
    );

    console.log('  Testing whereIn...');
    const {
      regular: whereInRegular,
      prepared: whereInPrepared,
      rewrite: whereInRewrite,
    } = await benchmarkInClauses(
      'whereIn',
      Array.from({ length: IN_CLAUSE_QUERY_VARIANTS }, (_, i) => ({
        tableName: 'users',
        build: (q: any) => {
          const ids = Array.from({ length: i + 1 }, (_, j) => j + 1);
          return q.whereIn('id', ids).select('*');
        },
      })),
      ITERATIONS,
      WARMUP_ITERATIONS
    );
    markdown.push(`### whereIn (sizes 1-${IN_CLAUSE_QUERY_VARIANTS})\n`);
    markdown.push(formatInClauseTable(whereInRegular, whereInPrepared, whereInRewrite) + '\n');

    await coolDown(10);

    console.log('  Testing whereNotIn...');
    const {
      regular: whereNotInRegular,
      prepared: whereNotInPrepared,
      rewrite: whereNotInRewrite,
    } = await benchmarkInClauses(
      'whereNotIn',
      Array.from({ length: IN_CLAUSE_QUERY_VARIANTS }, (_, i) => ({
        tableName: 'users',
        build: (q: any) => {
          const ids = Array.from({ length: i + 1 }, (_, j) => j + 1);
          return q.where('id', '<', 100).whereNotIn('id', ids).select('*');
        },
      })),
      ITERATIONS,
      WARMUP_ITERATIONS
    );
    markdown.push(`### whereNotIn (sizes 1-${IN_CLAUSE_QUERY_VARIANTS})\n`);
    markdown.push(
      formatInClauseTable(whereNotInRegular, whereNotInPrepared, whereNotInRewrite) + '\n'
    );

    markdown.push('---\n');
    markdown.push('*Benchmark run with knex-prepared on PostgreSQL*');

    const outputPath = path.join(__dirname, '..', 'BENCHMARK.md');
    writeFileSync(outputPath, markdown.join('\n'));
    console.log(`\n✅ Benchmark complete! Results written to BENCHMARK.md\n`);

    await teardown();
  } catch (error) {
    console.error('❌ Benchmark failed:', error);
    process.exit(1);
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}
