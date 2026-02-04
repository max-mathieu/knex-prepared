# knex-prepared

[![npm version](https://badge.fury.io/js/knex-prepared.svg)](https://badge.fury.io/js/knex-prepared)
[![CI](https://github.com/max/knex-prepared/actions/workflows/ci.yml/badge.svg)](https://github.com/max/knex-prepared/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

PostgreSQL prepared statement support for Knex.js with type-safe APIs.

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

- **Two APIs**: Factory method (`knex.prepared('table')`) and chainable (`.prepared()`)
- **Auto-naming**: Deterministic hash-based names (`auto-{hash16}`)
- **Custom naming**: Use your own statement names
- **Type-safe**: Full TypeScript support
- **Zero dependencies**: Only peer deps on Knex and pg

## API

### `knexPrepared(knex)`

Extends a Knex instance with prepared statement support.

```typescript
const knex = knexPrepared(Knex({ client: 'pg', connection: { /* ... */ } }));
```

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

## How It Works

**Naming**: Auto-generated names use the format `auto-{first 16 chars of SHA-256 hash}`. Same SQL always produces the same name.

**Execution**: Hooks into Knex's `query` event to inject the `name` property. The pg driver automatically caches execution plans per connection.

**Performance**: Prepared statements skip SQL parsing on repeat execution. Expect 10-30% improvement for frequently executed queries.

## TypeScript

Type inference is preserved:

```typescript
interface User { id: number; name: string; email: string; }

const users = await knex.prepared<User>('users').select('*');  // User[]
const user = await knex<User>('users').prepared().where('id', 1).first();  // User | undefined
```

## Limitations

- **PostgreSQL only** - Other databases not supported
- **Per-connection caching** - Each pooled connection maintains its own prepared statement cache
- **Connection lifetime** - Statements persist in memory for the connection's lifetime

## Monitoring

Query PostgreSQL to see active prepared statements:

```sql
SELECT name, statement FROM pg_prepared_statements WHERE name LIKE 'auto-%';
```

## Testing

```bash
npm install
npm test  # Unit tests (no database required)
```

Integration tests require PostgreSQL:

```bash
cp .env.example .env
docker run --name postgres-test -e POSTGRES_PASSWORD=postgres -p 5432:5432 -d postgres:16
npm test
docker stop postgres-test && docker rm postgres-test
```

Environment variables: `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME` (all have sensible defaults).

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
