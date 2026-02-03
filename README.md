# knex-prepared

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

[To be completed]

## License

MIT
