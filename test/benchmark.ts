#!/usr/bin/env tsx
/* eslint-disable no-console */

import { config } from 'dotenv';
import { writeFileSync } from 'fs';
import path from 'path';
import Knex from 'knex';
import { knexPrepared, KnexPreparedOptions } from '../src/index';

config();

const ITERATIONS = parseInt(process.env.BENCHMARK_ITERATIONS || '1000', 10);
const WARMUP_ITERATIONS = 50;
const TABLE_USER_ROWS = 1000;
const TABLE_POST_ROWS = 5000;
const MAX_WHERE_IN_SIZE = 20; // Test IN clause sizes from 1 to 20
const ITERATIONS_PER_IN_SIZE = 1;
const IN_CLAUSE_ITERATIONS = 250;

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

async function benchmark(
  fn: () => Promise<unknown>,
  iterations: number = ITERATIONS,
  warmup: number = WARMUP_ITERATIONS
): Promise<BenchmarkStats> {
  for (let i = 0; i < warmup; i++) {
    await fn();
  }

  const times: number[] = [];
  for (let i = 0; i < iterations; i++) {
    const start = process.hrtime.bigint();
    await fn();
    const end = process.hrtime.bigint();
    times.push(Number(end - start) / 1_000_000);
  }

  return calculateStats(times);
}

async function coolDown(delaySeconds: number) {
  console.log(`  ⏱ Cooling down for ${delaySeconds} ${delaySeconds === 1 ? 'second' : 'seconds'}...`);
  await new Promise((resolve) => setTimeout(resolve, delaySeconds * 0));
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
    markdown.push(`**Warmup iterations:** ${WARMUP_ITERATIONS} (excluded from measurements to ensure stable results)`);
    markdown.push(`**Connection pool:** Single connection (min: 1, max: 1) for consistent results`);
    markdown.push(`**Test Data:** ${TABLE_USER_ROWS.toLocaleString()} users, ${(TABLE_POST_ROWS).toLocaleString()} posts\n`);

    console.log('📈 Running benchmarks...\n');

    console.log('  1/7: Simple SELECT by ID...');
    const selectById = await benchmark(async () => {
      const knex = getBenchmarkKnex();
      await knex('users').where('id', 42).first();
      await knex.destroy();
    });
    await coolDown(1);
    const selectByIdPrepared = await benchmark(async () => {
      const preparedKnex = getPreparedKnex();
      await preparedKnex.prepared('users').where('id', 42).first();
      await preparedKnex.destroy();
    });
    markdown.push('## Simple SELECT by ID\n');
    markdown.push(formatStatsTable(selectById, selectByIdPrepared) + '\n');

    await coolDown(5);

    console.log('  2/7: SELECT with static WHERE clause...');
    const selectWhere = await benchmark(async () => {
      const knex = getBenchmarkKnex();
      await knex('users').where('active', true).select('*');
      await knex.destroy();
    });
    await coolDown(1);
    const selectWherePrepared = await benchmark(async () => {
      const preparedKnex = getPreparedKnex();
      await preparedKnex.prepared('users').where('active', true).select('*');
      await preparedKnex.destroy();
    });
    markdown.push('## SELECT with static WHERE clause\n');
    markdown.push(formatStatsTable(selectWhere, selectWherePrepared) + '\n');

    await coolDown(5);

    console.log('  3/7: Multiple WHERE conditions...');
    const multiWhere = await benchmark(async () => {
      const knex = getBenchmarkKnex();
      await knex('users').where('active', true).where('age', '>', 30).select('*');
      await knex.destroy();
    });
    await coolDown(1);
    const multiWherePrepared = await benchmark(async () => {
      const preparedKnex = getPreparedKnex();
      await preparedKnex.prepared('users').where('active', true).where('age', '>', 30).select('*');
      await preparedKnex.destroy();
    });
    markdown.push('## Multiple WHERE Conditions\n');
    markdown.push(formatStatsTable(multiWhere, multiWherePrepared) + '\n');

    await coolDown(5);

    console.log('  4/7: Simple JOIN...');
    const join = await benchmark(async () => {
      const knex = getBenchmarkKnex();
      await knex('users')
        .join('posts', 'users.id', 'posts.user_id')
        .where('users.id', 42)
        .select('users.name', 'posts.title');
      await knex.destroy();
    });
    await coolDown(1);
    const joinPrepared = await benchmark(async () => {
      const preparedKnex = getPreparedKnex();
      await preparedKnex
        .prepared('users')
        .join('posts', 'users.id', 'posts.user_id')
        .where('users.id', 42)
        .select('users.name', 'posts.title');
      await preparedKnex.destroy();
    });
    markdown.push('## Simple JOIN\n');
    markdown.push(formatStatsTable(join, joinPrepared) + '\n');

    await coolDown(5);

    console.log('  5/7: Complex JOIN with conditions...');
    const complexJoin = await benchmark(async () => {
      const knex = getBenchmarkKnex();
      await knex('users')
        .join('posts', 'users.id', 'posts.user_id')
        .where('users.active', true)
        .where('posts.published', true)
        .orderBy('posts.created_at', 'desc')
        .limit(10)
        .select('users.name', 'posts.title', 'posts.created_at');
      await knex.destroy();
    });
    await coolDown(1);
    const complexJoinPrepared = await benchmark(async () => {
      const preparedKnex = getPreparedKnex();
      await preparedKnex
        .prepared('users')
        .join('posts', 'users.id', 'posts.user_id')
        .where('users.active', true)
        .where('posts.published', true)
        .orderBy('posts.created_at', 'desc')
        .limit(10)
        .select('users.name', 'posts.title', 'posts.created_at');
      await preparedKnex.destroy();
    });
    markdown.push('## Complex JOIN with Conditions\n');
    markdown.push(formatStatsTable(complexJoin, complexJoinPrepared) + '\n');

    await coolDown(5);

    console.log('  6/7: Aggregation with GROUP BY...');
    const groupBy = await benchmark(async () => {
      const knex = getBenchmarkKnex();
      await knex('posts')
        .select('user_id')
        .count('* as post_count')
        .groupBy('user_id');
      await knex.destroy();
    });
    await coolDown(1);
    const groupByPrepared = await benchmark(async () => {
      const preparedKnex = getPreparedKnex();
      await preparedKnex
        .prepared('posts')
        .select('user_id')
        .count('* as post_count')
        .groupBy('user_id');
      await preparedKnex.destroy();
    });
    markdown.push('## Aggregation with GROUP BY\n');
    markdown.push(formatStatsTable(groupBy, groupByPrepared) + '\n');

    await coolDown(10);

    console.log('  7/7: IN clauses (with rewriteInClauses)...\n');
    markdown.push('## IN Clauses with rewriteInClauses Option\n');
    markdown.push(
      `The \`rewriteInClauses\` option enables prepared statement name generation that accounts for IN clause size. `
    );
    markdown.push(
      `This test cycles through sizes 1-${MAX_WHERE_IN_SIZE} (${ITERATIONS_PER_IN_SIZE} iterations each, ${MAX_WHERE_IN_SIZE * ITERATIONS_PER_IN_SIZE} total queries). `
    );
    markdown.push(
      `**Default**: No prepared statements. `
    );
    markdown.push(
      `**Prepared**: Uses prepared statements, creates ${MAX_WHERE_IN_SIZE} different statements (one per size). `
    );
    markdown.push(`**Prepared + Rewrite**: Uses prepared statements with \`rewriteInClauses\`, creates only 1 statement and reuses it.\n`);

    console.log(`    Testing whereIn with mixed sizes (1-${MAX_WHERE_IN_SIZE})...`);
    const whereInRegular = await benchmark(
      async () => {
        const knex = getBenchmarkKnex();
        for (let size = 1; size <= MAX_WHERE_IN_SIZE; size++) {
          const ids = Array.from({ length: size }, (_, i) => i + 1);
          for (let i = 0; i < ITERATIONS_PER_IN_SIZE; i++) {
            await knex('users').whereIn('id', ids).select('*');
          }
        }
        await knex.destroy();
      },
      IN_CLAUSE_ITERATIONS,
      0
    );
    await coolDown(5);
    const whereInPrepared = await benchmark(
      async () => {
        const preparedKnex = getPreparedKnex();
        for (let size = 1; size <= MAX_WHERE_IN_SIZE; size++) {
          const ids = Array.from({ length: size }, (_, i) => i + 1);
          for (let i = 0; i < ITERATIONS_PER_IN_SIZE; i++) {
            await preparedKnex.prepared('users').whereIn('id', ids).select('*');
          }
        }
        await preparedKnex.destroy();
      },
      IN_CLAUSE_ITERATIONS,
      0
    );
    await coolDown(5);
    const whereInRewrite = await benchmark(
      async () => {
        const rewriteKnex = getPreparedKnex({ rewriteInClauses: true });
        for (let size = 1; size <= MAX_WHERE_IN_SIZE; size++) {
          const ids = Array.from({ length: size }, (_, i) => i + 1);
          for (let i = 0; i < ITERATIONS_PER_IN_SIZE; i++) {
            await rewriteKnex.prepared('users').whereIn('id', ids).select('*');
          }
        }
        await rewriteKnex.destroy();
      },
      IN_CLAUSE_ITERATIONS,
      0
    );

    markdown.push(`### whereIn (mixed sizes 1-${MAX_WHERE_IN_SIZE})\n`);
    markdown.push(formatInClauseTable(whereInRegular, whereInPrepared, whereInRewrite) + '\n');

    await coolDown(10);

    console.log(`    Testing whereNotIn with mixed sizes (1-${MAX_WHERE_IN_SIZE})...`);
    const whereNotInRegular = await benchmark(
      async () => {
        const knex = getBenchmarkKnex();
        for (let size = 1; size <= MAX_WHERE_IN_SIZE; size++) {
          const ids = Array.from({ length: size }, (_, i) => i + 1);
          for (let i = 0; i < ITERATIONS_PER_IN_SIZE; i++) {
            await knex('users').whereNotIn('id', ids).select('*');
          }
        }
        await knex.destroy();
      },
      IN_CLAUSE_ITERATIONS,
      0
    );
    await coolDown(5);
    const whereNotInPrepared = await benchmark(
      async () => {
        const preparedKnex = getPreparedKnex();
        for (let size = 1; size <= MAX_WHERE_IN_SIZE; size++) {
          const ids = Array.from({ length: size }, (_, i) => i + 1);
          for (let i = 0; i < ITERATIONS_PER_IN_SIZE; i++) {
            await preparedKnex.prepared('users').whereNotIn('id', ids).select('*');
          }
        }
        await preparedKnex.destroy();
      },
      IN_CLAUSE_ITERATIONS,
      0
    );
    await coolDown(5);
    const whereNotInRewrite = await benchmark(
      async () => {
        const rewriteKnex = getPreparedKnex({ rewriteInClauses: true });
        for (let size = 1; size <= MAX_WHERE_IN_SIZE; size++) {
          const ids = Array.from({ length: size }, (_, i) => i + 1);
          for (let i = 0; i < ITERATIONS_PER_IN_SIZE; i++) {
            await rewriteKnex.prepared('users').whereNotIn('id', ids).select('*');
          }
        }
        await rewriteKnex.destroy();
      },
      IN_CLAUSE_ITERATIONS,
      0
    );

    markdown.push(`### whereNotIn (mixed sizes 1-${MAX_WHERE_IN_SIZE})\n`);
    markdown.push(formatInClauseTable(whereNotInRegular, whereNotInPrepared, whereNotInRewrite) + '\n');

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
