# knex-prepared

[![npm version](https://badge.fury.io/js/knex-prepared.svg)](https://badge.fury.io/js/knex-prepared)
[![CI](https://github.com/max/knex-prepared/actions/workflows/ci.yml/badge.svg)](https://github.com/max/knex-prepared/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Control named prepared statements in PostgreSQL for Knex.js with type-safe APIs. While node-postgres uses unnamed prepared statements for query parameterization, this library enables explicit naming to maximize query plan caching and performance.

## Installation

```bash
npm install knex-prepared knex pg
```

## Quick Start

```typescript
import Knex from 'knex';
import { knexPrepared } from 'knex-prepared';

const knex = knexPrepared(Knex({
  client: 'pg',
  connection: {
    host: 'localhost',
    user: 'postgres',
    password: 'password',
    database: 'mydb',
  },
}));

// Factory method
await knex.prepared('users').select('*');

// Chainable method
await knex('users').prepared().select('*');

// Custom name
await knex('users').prepared('get-all-users').select('*');

// Disable for specific query
await knex('users').prepared(false).select('*');
```

## Features

- **Factory API**: Create queries with `knex.prepared('table')`
- **Chainable API**: Add `.prepared()` to any query chain
- **Auto-naming**: Deterministic hash-based statement names
- **Custom naming**: Use your own statement names
- **Type-safe**: Full TypeScript support with inference
- **Zero dependencies**: Only peer dependencies on Knex and pg

## API

### `knexPrepared(knex, options?)`

Extends a Knex instance with prepared statement support.

```typescript
const knex = knexPrepared(Knex({ client: 'pg', connection: { /* ... */ } }));

// With options
const knex = knexPrepared(Knex({ client: 'pg', connection: { /* ... */ } }), {
  autoNamePrefix: 'myapp',
  autoNameHashLength: 12,
  autoNameAllSelects: false,
  rewriteInClauses: false,
  disableWarnings: false,
  autoNameCacheSize: 1000,
});
```

#### Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `autoNamePrefix` | `string` | `'auto'` | Prefix for auto-generated prepared statement names |
| `autoNameHashLength` | `number` | `16` | Length of hash suffix in auto-generated names (1-64) |
| `autoNameAllSelects` | `boolean` | `false` | Automatically name all SELECT queries without calling `.prepared()` |
| `rewriteInClauses` | `boolean` | `false` | Rewrite IN clauses to `= ANY()` for better PostgreSQL performance |
| `disableWarnings` | `boolean` | `true` in production | Disable warnings about prepared queries with IN clauses |
| `autoNameCacheSize` | `number` | `1000` | LRU cache size for hash generation; set to 0 to disable |

### `knex.prepared(tableName)`

Factory method - creates a QueryBuilder with auto-generated prepared statement name.

```typescript
await knex.prepared('users').select('*');
await knex.prepared('users').where('id', 1).first();
await knex.prepared('users').insert({ name: 'Alice' });
await knex.prepared('users').where('id', 1).update({ name: 'Bob' });
await knex.prepared('users').where('id', 1).delete();
```

### `.prepared(nameOrFlag?)`

Chainable method - can be called anywhere in the query chain.

| Argument | Behavior |
|----------|----------|
| `undefined` or `true` | Auto-generate name from SQL hash |
| `false` | Disable prepared statements |
| `string` | Use custom name |

```typescript
await knex('users').prepared().select('*');
await knex('users').prepared('my-query').where('active', true).select('*');
await knex('users').where('active', true).prepared().select('*');
```

## Transactions

Prepared statements work seamlessly with Knex transactions:

```typescript
await knex.transaction(async (trx) => {
  // Chainable method
  await trx('users').prepared().where('id', 1).update({ balance: 100 });

  // Factory method
  await trx.prepared('audit_log').insert({
    action: 'balance_update',
    user_id: 1
  });

  // Custom names
  await trx('users').prepared('update-balance').where('id', 2).update({ balance: 200 });
});
```

**Note**: Transactions use a single database connection. Prepared statements created within a transaction remain available throughout the transaction and persist on the connection afterward.

## How It Works

### Naming
Auto-generated names use the format `auto-{first 16 chars of SHA-256 hash}`. Identical SQL produces identical names, enabling plan reuse across connections.

### Execution
The library hooks into Knex's `query` event to inject the `name` property before execution. The pg driver automatically caches prepared statement plans per connection.

### Performance
Prepared statements eliminate SQL parsing overhead on subsequent executions. Expect 10-30% performance improvement for frequently executed queries.

## TypeScript

Type inference is preserved:

```typescript
interface User { id: number; name: string; email: string; }

const users = await knex.prepared<User>('users').select('*');  // User[]
const user = await knex<User>('users').prepared().where('id', 1).first();  // User | undefined
```

## Database Support

### PostgreSQL
This library is designed specifically for PostgreSQL, which supports [named prepared statements](https://www.postgresql.org/docs/current/sql-prepare.html) that can be explicitly managed and reused across queries on the same connection.

### Other Databases
Knex supports several other databases that handle query optimization differently:

- **mysql** - Does not support prepared statements in the traditional sense. The [mysql driver](https://github.com/mysqljs/mysql#readme) uses query parameterization but does not cache query plans.

- **mysql2** - Implements its own [LRU cache for prepared statements](https://github.com/sidorares/node-mysql2#using-prepared-statements) using query hashes, automatically managing statement lifecycle without explicit naming.

- **mssql** - Query plan caching is managed by SQL Server itself through its [plan cache](https://learn.microsoft.com/en-us/sql/relational-databases/query-processing-architecture-guide#execution-plan-caching-and-reuse). No client-side statement management is needed.

This library does not support these databases because they either lack named prepared statement support or handle optimization automatically.

## Limitations

- **Per-connection caching** - Each pooled connection maintains its own cache
- **Connection lifetime** - Statements remain in memory for the connection's lifetime

## Monitoring

Query PostgreSQL to see active prepared statements:

```sql
SELECT name, statement FROM pg_prepared_statements WHERE name LIKE 'auto-%';
```

## Testing

Run unit tests (no database required):
```bash
npm install
npm test
```

For integration tests with PostgreSQL:
```bash
cp .env.example .env
docker run --name postgres-test -e POSTGRES_PASSWORD=postgres -p 5432:5432 -d postgres:16
npm test
docker stop postgres-test && docker rm postgres-test
```

Configure via environment variables: `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME` (defaults provided).

## Benchmarks

```bash
npm run benchmark
BENCHMARK_ITERATIONS=5000 npm run benchmark  # Override iterations
```

## Contributing

1. Fork the repository
2. Create a feature branch
3. Add tests for new functionality
4. Ensure all tests pass
5. Submit a pull request

## License

MIT
