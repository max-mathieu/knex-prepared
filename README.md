# knex-prepared

[![npm version](https://badge.fury.io/js/knex-prepared.svg)](https://badge.fury.io/js/knex-prepared)
[![CI](https://github.com/max/knex-prepared/actions/workflows/ci.yml/badge.svg)](https://github.com/max/knex-prepared/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Extends Knex.js to support PostgreSQL prepared statements with simple, type-safe APIs.

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

// Factory method - auto-generates prepared statement name
await knex.prepared('users').select('*');

// Chainable method - auto-generates name
await knex('users').prepared().select('*');

// Custom name
await knex('users').prepared('get-all-users').select('*');

// Disable prepared statements for a specific query
await knex('users').prepared(false).select('*');
```

## Features

- **Two simple APIs**: Factory method and chainable method
- **Auto-naming**: Hash-based deterministic naming for prepared statements
- **Custom naming**: Provide your own statement names
- **Type-safe**: Full TypeScript support with preserved type inference
- **Performance**: Leverage PostgreSQL prepared statement caching
- **Zero dependencies**: Only peer dependencies on Knex and PostgreSQL driver

## API Documentation

### `knexPrepared(knex)`

The main entry point that extends a Knex instance with prepared statement support.

**Parameters:**
- `knex` - A Knex instance to extend

**Returns:**
- Extended Knex instance with `.prepared()` factory method and chainable method

**Example:**
```typescript
import Knex from 'knex';
import { knexPrepared } from 'knex-prepared';

const knex = knexPrepared(Knex({
  client: 'pg',
  connection: { /* ... */ },
}));
```

### Factory Method: `knex.prepared(tableName)`

Creates a QueryBuilder for the specified table with prepared statements enabled. The prepared statement name is auto-generated from the SQL hash.

**Parameters:**
- `tableName` - The name of the table to query

**Returns:**
- QueryBuilder instance with prepared statement metadata

**Examples:**
```typescript
// Simple SELECT
await knex.prepared('users').select('*');

// With WHERE clause
await knex.prepared('users').where('active', true).select('id', 'name');

// Complex join
await knex.prepared('users')
  .select('users.*', 'posts.title')
  .join('posts', 'users.id', 'posts.user_id')
  .where('posts.published', true);

// INSERT
await knex.prepared('users').insert({ name: 'Alice', email: 'alice@example.com' });

// UPDATE
await knex.prepared('users').where('id', 1).update({ name: 'Bob' });

// DELETE
await knex.prepared('users').where('id', 1).delete();
```

### Chainable Method: `query.prepared(nameOrFlag?)`

Enables prepared statements for a query builder. Can be called at any point in the query chain.

**Parameters:**
- `nameOrFlag` (optional):
  - `undefined` or `true` - Auto-generate name from SQL hash (default)
  - `false` - Disable prepared statements for this query
  - `string` - Use custom prepared statement name

**Returns:**
- The same QueryBuilder instance for chaining

**Examples:**
```typescript
// Auto-generate name (both equivalent)
await knex('users').prepared().select('*');
await knex('users').prepared(true).select('*');

// Custom name
await knex('users').prepared('get-active-users').where('active', true).select('*');

// Disable prepared statements
await knex('users').prepared(false).select('*');

// Can be called at any point in the chain
await knex('users').where('active', true).prepared().select('*');
```

## How It Works

### Prepared Statement Names

When you use prepared statements, knex-prepared generates a unique name for each SQL query:

- **Auto-generated names**: Format is `auto-{hash16}` where hash16 is the first 16 characters of the SHA-256 hash of the normalized SQL text
- **Deterministic**: Same SQL always gets the same name, enabling PostgreSQL to cache and reuse the execution plan
- **Custom names**: You can provide your own names for better debugging and monitoring

### Query Interception

knex-prepared hooks into Knex's `query` event to inject prepared statement names before execution. The PostgreSQL driver (`pg`) automatically handles:
- Parsing the SQL and caching the execution plan on first use
- Reusing cached plans for subsequent executions with the same name
- Managing prepared statements per connection

### Performance Benefits

Prepared statements provide several performance benefits:

1. **Plan Caching**: PostgreSQL parses and plans the query once, then reuses the plan
2. **Reduced Parsing**: No need to re-parse the SQL on each execution
3. **Optimized Execution**: The database can optimize for repeated execution patterns

For queries that execute frequently with different parameters, prepared statements can provide 10-30% performance improvements.

## TypeScript Support

knex-prepared is written in TypeScript and provides full type safety:

```typescript
interface User {
  id: number;
  name: string;
  email: string;
  active: boolean;
}

// Type inference works automatically
const users = await knex.prepared<User>('users').select('*');
// users: User[]

const user = await knex<User>('users').prepared().where('id', 1).first();
// user: User | undefined

// Custom names preserve types
const activeUsers = await knex('users')
  .prepared('get-active')
  .where('active', true)
  .select<Pick<User, 'id' | 'name'>>('id', 'name');
// activeUsers: Array<{ id: number; name: string }>
```

## Limitations

- **PostgreSQL Only**: This library only works with PostgreSQL. Other databases are not supported.
- **Connection Pooling**: Prepared statements are cached per connection. If you have connection pooling, each connection will maintain its own cache.
- **Long-Running Connections**: Prepared statements remain in memory for the lifetime of the connection. This is usually not an issue, but very long-running connections with many unique queries could accumulate prepared statements.
- **Transaction Isolation**: Prepared statements persist across transactions on the same connection.

## Monitoring Prepared Statements

You can query PostgreSQL to see active prepared statements:

```sql
SELECT name, statement, parameter_types, from_sql
FROM pg_prepared_statements
WHERE name LIKE 'auto-%' OR name = 'your-custom-name';
```

## Testing

### Running Tests

```bash
# Install dependencies
npm install

# Run unit tests (no database required)
npm test
```

### Integration Tests

Integration tests require a PostgreSQL database. Configure using a `.env` file or environment variables.

**Option 1: Using .env file (recommended)**

```bash
# Copy the example env file
cp .env.example .env

# Edit .env with your database credentials (if needed)
# The defaults work with the Docker command below

# Start PostgreSQL
docker run --name postgres-test -e POSTGRES_PASSWORD=postgres -p 5432:5432 -d postgres:16

# Run all tests (including integration tests)
npm test

# Stop PostgreSQL
docker stop postgres-test && docker rm postgres-test
```

**Option 2: Using environment variables**

```bash
export DB_HOST=localhost
export DB_PORT=5432
export DB_USER=postgres
export DB_PASSWORD=postgres
export DB_NAME=knex_prepared_test

npm test
```

### Environment Variables

- `DB_HOST` (default: localhost) - Database host
- `DB_PORT` (default: 5432) - Database port
- `DB_USER` (default: postgres) - Database user
- `DB_PASSWORD` (default: postgres) - Database password
- `DB_NAME` (default: knex_prepared_test) - Database name

## Benchmarks

Run performance benchmarks to compare prepared statements vs regular queries.

### Setup

```bash
# Copy the example env file (if not already done)
cp .env.example .env

# Edit .env to set BENCHMARK_ITERATIONS if desired (default: 1000)

# Start PostgreSQL
docker run --name postgres-test -e POSTGRES_PASSWORD=postgres -p 5432:5432 -d postgres:16
```

### Running Benchmarks

```bash
# Run benchmarks with settings from .env
npm run benchmark

# Or override iterations via environment variable
BENCHMARK_ITERATIONS=5000 npm run benchmark

# Stop PostgreSQL when done
docker stop postgres-test && docker rm postgres-test
```

### Benchmark Scenarios

The benchmark tests various query types:
- Simple SELECT by ID
- SELECT with WHERE clauses
- Simple JOINs
- Complex JOINs with multiple conditions
- Aggregations with GROUP BY

Results show total time, average time per operation, operations per second, and speedup analysis.

## Contributing

Contributions are welcome! Please:

1. Fork the repository
2. Create a feature branch
3. Add tests for any new functionality
4. Ensure all tests pass
5. Submit a pull request

## License

MIT
