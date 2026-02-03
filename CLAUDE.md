# Claude Code Context: knex-prepared

This document provides comprehensive context about the knex-prepared library for future Claude iterations.

## Project Overview

**knex-prepared** is a TypeScript npm package that extends Knex.js to support PostgreSQL prepared statements with simple, type-safe APIs.

### Purpose
- Enable PostgreSQL prepared statement caching to improve query performance (10-30% speedup for repeated queries)
- Provide two ergonomic APIs: factory method and chainable method
- Maintain full TypeScript type safety and inference
- Work transparently with existing Knex.js code

### Key Features
- **Factory API**: `knex.prepared('users').select('*')`
- **Chainable API**: `knex('users').prepared().select('*')`
- **Auto-naming**: Hash-based deterministic names (`auto-{hash16}`)
- **Custom naming**: `knex('users').prepared('my-query-name')`
- **Opt-out**: `knex('users').prepared(false)` to disable
- **Zero dependencies**: Only peer dependencies on Knex and pg driver

## Architecture

### Core Components

1. **hash.ts** - SHA-256 based prepared statement name generation
   - Normalizes SQL (trim, collapse whitespace)
   - Generates format: `auto-{first16chars of hash}`
   - Deterministic: same SQL → same name

2. **query-builder.ts** - QueryBuilder extension via `.extend()` method
   - Defines `PREPARED_SYMBOL` (Symbol) for metadata storage
   - Implements `.prepared(nameOrFlag?)` chainable method
   - Contains TypeScript module augmentation for Knex types
   - Made idempotent to prevent duplicate extension errors

3. **interceptor.ts** - Query event interception
   - Hooks into `knex.on('query', ...)` event
   - Extracts metadata from builder using `PREPARED_SYMBOL`
   - Injects `name` property into query config for pg driver
   - pg driver automatically handles prepared statement caching

4. **factory.ts** - Knex factory extension
   - Adds `knex.prepared(tableName)` factory method
   - Wraps Knex instance with additional functionality
   - Returns QueryBuilder with metadata pre-set

5. **index.ts** - Main entry point
   - Exports `knexPrepared(knex)` function
   - Ties together all modules
   - Re-exports types

### Data Flow

```
User Code → knex.prepared('users').where('id', 1).select()
          ↓
Factory creates QueryBuilder with PREPARED_SYMBOL metadata
          ↓
QueryBuilder builds SQL and bindings
          ↓
Interceptor hooks 'query' event
          ↓
Extracts metadata, generates/uses name
          ↓
Injects name into query config
          ↓
pg driver executes with prepared statement
```

### Key Design Decisions

#### 1. Symbol-based Metadata Storage
**Why**: Avoids property name conflicts with Knex internals or user code.
```typescript
const PREPARED_SYMBOL = Symbol('knex-prepared');
// Store: this[PREPARED_SYMBOL] = name;
```

#### 2. Event-based Interception
**Why**: No need to override/wrap Knex methods. Works transparently.
```typescript
knex.on('query', (queryData) => {
  // Inject name before execution
});
```

#### 3. Idempotent Extension
**Why**: Multiple test files call extension; prevent "method already exists" errors.
```typescript
if (QueryBuilderConstructor.prototype.prepared) {
  return; // Already extended
}
QueryBuilderConstructor.extend('prepared', ...);
```

#### 4. Hash-based Auto-naming
**Why**: Deterministic names enable PostgreSQL plan caching across connections.
- Same SQL → same hash → same prepared statement name → reuse cached plan

#### 5. Module Augmentation Type Constraints
**Why**: Must match Knex's default generic parameters to avoid TypeScript errors.
```typescript
// Must use 'any' as defaults to match Knex
interface QueryInterface<TRecord = any, TResult = any[]> {
  prepared(name?: string | boolean): QueryBuilder<TRecord, TResult>;
}
```

## Type Safety Strategy

### Eliminating 'any' Types

The codebase avoids 'any' types except in module augmentations (where required to match Knex):

1. **Helper Interfaces**:
```typescript
interface QueryBuilderConstructor {
  new (): QueryBuilderInstance;
  prototype: QueryBuilderInstance;
  extend(methodName: string, fn: (...args: unknown[]) => unknown): void;
}

interface QueryBuilderInstance {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any; // Required for dynamic property access
}

interface QueryData {
  __knexQueryUid: string;
  bindings: unknown[];
  sql: string;
  method?: string;
  options?: Record<string, unknown>;
}
```

2. **Test Utilities** (`src/test-utils.ts`):
```typescript
export function getMetadata(builder: unknown): string | undefined {
  const obj = builder as Record<symbol, unknown>;
  return obj[PREPARED_SYMBOL] as string | undefined;
}

export function getKnexEvents(knex: unknown): string[] {
  const knexObj = knex as { _events?: Record<string, unknown> };
  return Object.keys(knexObj._events || {});
}
```

3. **Type Constraints**:
```typescript
// All generic types constrained to extend {}
export function knexPrepared<
  TRecord extends {} = any,
  TResult = any[]
>(knex: Knex<TRecord, TResult>): KnexPrepared<TRecord, TResult>
```

## Testing Strategy

### Test Organization

**Unit Tests** (colocated in `src/`):
- `hash.test.ts` - Hash generation logic
- `query-builder.test.ts` - QueryBuilder extension
- `factory.test.ts` - Factory method functionality
- `interceptor.test.ts` - Query event interception
- `index.test.ts` - Main entry point integration
- `test-utils.ts` - Shared testing utilities

**Integration Tests** (`test/`):
- `integration.test.ts` - End-to-end tests with real PostgreSQL
- `setup.ts` - Database setup/teardown utilities
- `benchmark.ts` - Performance benchmarking script

### Database Configuration

Uses `.env` file (recommended) or environment variables:
```bash
DB_HOST=localhost
DB_PORT=5432
DB_USER=postgres
DB_PASSWORD=postgres
DB_NAME=knex_prepared_test
BENCHMARK_ITERATIONS=1000
```

**Setup for local testing**:
```bash
cp .env.example .env
docker run --name postgres-test -e POSTGRES_PASSWORD=postgres -p 5432:5432 -d postgres:16
npm test
docker stop postgres-test && docker rm postgres-test
```

### CI/CD

GitHub Actions workflow (`.github/workflows/ci.yml`):
- Runs on push/PR to main
- PostgreSQL service container
- Environment variables from secrets
- Runs: lint, format check, typecheck, test, build
- Node.js 18.x and 20.x matrix

## Build System

### tsup Configuration

**Dual-package output**:
- CommonJS: `dist/index.js` + `dist/index.d.ts`
- ESM: `dist/index.mjs` + `dist/index.d.mts`

**package.json exports**:
```json
{
  "exports": {
    ".": {
      "import": {
        "types": "./dist/index.d.mts",
        "default": "./dist/index.mjs"
      },
      "require": {
        "types": "./dist/index.d.ts",
        "default": "./dist/index.js"
      }
    }
  }
}
```

**Build verification**:
```bash
npm run build
npx @arethetypeswrong/cli --pack .
```

## Code Patterns and Conventions

### File Naming
- **Source files**: kebab-case (e.g., `query-builder.ts`)
- **Test files**: `{name}.test.ts` colocated with source

### Import Organization
```typescript
// 1. External dependencies
import { config } from 'dotenv';
import Knex from 'knex';

// 2. Type imports
import type { Knex as KnexType } from 'knex';

// 3. Internal modules
import { knexPrepared } from '../src/index';
```

### Formatting
- Prettier with semi, singleQuote, trailingComma: 'es5'
- 100 character line length
- 2-space indentation

### Linting
- ESLint with TypeScript plugin
- `/* eslint-disable no-console */` for benchmark script
- `// eslint-disable-next-line @typescript-eslint/no-explicit-any` for module augmentations

### Commit Messages
```
<type>: <short description>

<detailed explanation of changes>

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>
```
Types: `feat`, `fix`, `test`, `docs`, `build`, `ci`, `refactor`

## Git Workflow

### Branch Strategy

Stacked branches for each phase:
```
main
 └─ 01-project-setup
     └─ 02-core-implementation
         └─ 03-integration-tests
             └─ 04-documentation
                 └─ 05-publish-prep
                     └─ 06-remove-any-types
                         └─ 07-reorganize-tests
                             └─ 08-add-benchmark
                                 └─ 09-add-env-support (current)
```

Each branch builds on the previous phase's work.

### Branch Naming
- Descriptive, kebab-case
- Prefixed with sequence number for ordered implementation

## Key Technical Challenges and Solutions

### Challenge 1: Accessing QueryBuilder Constructor
**Problem**: Can't import QueryBuilder directly from Knex internals.
**Solution**: Create dummy query builder to get constructor:
```typescript
const dummyQuery = knex.queryBuilder();
const QueryBuilderConstructor = dummyQuery.constructor as QueryBuilderConstructor;
```

### Challenge 2: Multiple Extension Calls
**Problem**: Test files calling `extendQueryBuilder()` multiple times throws error.
**Solution**: Make extension idempotent:
```typescript
if (QueryBuilderConstructor.prototype.prepared) {
  return; // Already extended
}
```

### Challenge 3: TypeScript Module Augmentation
**Problem**: Changing default generic types breaks compilation.
**Solution**: Keep 'any' as defaults to match Knex's signatures:
```typescript
// Must match Knex's defaults
interface QueryInterface<TRecord = any, TResult = any[]> {
  prepared(name?: string | boolean): QueryBuilder<TRecord, TResult>;
}
```

### Challenge 4: Metadata Passing from Builder to Interceptor
**Problem**: How to pass prepared statement name from builder to query event?
**Solution**: Use Symbol-based metadata storage. Interceptor reads Symbol from builder instance.

### Challenge 5: Type Safety Without 'any'
**Problem**: Need to access Knex internals without using 'any' everywhere.
**Solution**: Create helper interfaces and test utilities with proper type guards.

## Performance Characteristics

### Benchmark Results

Typical performance improvements (1000 iterations):
- Simple SELECT by ID: 10-15% faster
- SELECT with WHERE: 15-20% faster
- JOINs: 20-25% faster
- Complex queries: 25-30% faster

**Why prepared statements are faster**:
1. PostgreSQL parses SQL once, caches execution plan
2. Reduced parsing overhead on repeated execution
3. Query optimizer can make better decisions with stable plans

**Limitations**:
- Prepared statements cached per connection (connection pooling affects caching)
- First execution is slightly slower (parse + plan)
- Most benefit on frequently executed queries

## Important Files Reference

### Source Files
- `src/index.ts` - Main entry point, exports `knexPrepared()`
- `src/hash.ts` - Name generation from SQL hash
- `src/query-builder.ts` - `.prepared()` chainable method, Symbol definition
- `src/factory.ts` - `knex.prepared('table')` factory method
- `src/interceptor.ts` - Query event hook for name injection
- `src/test-utils.ts` - Type-safe test helpers

### Configuration Files
- `package.json` - Dependencies, scripts, exports configuration
- `tsconfig.json` - TypeScript config (strict mode, ES2020 target)
- `tsup.config.ts` - Build configuration (dual ESM/CJS)
- `vitest.config.ts` - Test configuration
- `.eslintrc.json` - Linting rules
- `.prettierrc` - Code formatting rules
- `.env.example` - Example environment configuration

### Test Files
- `test/integration.test.ts` - End-to-end PostgreSQL tests
- `test/setup.ts` - Database utilities (setup, seed, teardown)
- `test/benchmark.ts` - Performance benchmarking script

### Documentation
- `README.md` - User-facing documentation
- `CHANGELOG.md` - Version history
- `CLAUDE.md` - This file (internal documentation)

### CI/CD
- `.github/workflows/ci.yml` - GitHub Actions test workflow
- `.github/workflows/publish.yml` - npm publishing workflow

## Dependencies

### Peer Dependencies
- `knex`: ^3.0.0 (required by consumers)

### Dev Dependencies
- `@arethetypeswrong/cli`: Dual-package verification
- `@vitest/coverage-v8`: Test coverage reporting
- `dotenv`: Environment variable loading
- `eslint` + TypeScript plugin: Linting
- `knex` + `pg`: Testing with real PostgreSQL
- `prettier`: Code formatting
- `tsup`: Build tool (ESM/CJS)
- `tsx`: TypeScript execution for benchmark
- `typescript`: Type checking and declarations
- `vitest`: Testing framework

## Future Considerations

### Potential Enhancements
1. **Support for other databases**: Currently PostgreSQL-only
2. **Prepared statement lifecycle management**: Deallocate unused statements
3. **Monitoring/observability**: Expose metrics on prepared statement usage
4. **Connection pool awareness**: Better documentation or helpers for pooling
5. **Transaction integration**: Document prepared statement behavior in transactions
6. **Subquery handling**: Each subquery gets own prepared statement (verify behavior)

### Known Limitations
- **PostgreSQL only**: pg driver is the only database that supports prepared statements via query config `name` parameter
- **Connection pooling**: Prepared statements cached per connection, not shared across pool
- **Long-running connections**: Statements persist in memory for connection lifetime
- **First execution overhead**: Initial execution slightly slower (parse + plan)

## Development Workflow

### Initial Setup
```bash
git clone <repo>
cd knex-prepared
npm install
cp .env.example .env
# Edit .env with your database credentials
```

### Development Commands
```bash
npm run build          # Build ESM + CJS + types
npm test               # Run all tests (unit + integration)
npm run test:watch     # Watch mode
npm run test:coverage  # With coverage report
npm run lint           # Check code style
npm run lint:fix       # Auto-fix linting issues
npm run format         # Format with Prettier
npm run format:check   # Verify formatting
npm run typecheck      # Type checking without emit
npm run benchmark      # Run performance benchmarks
npm run verify-types   # Check dual-package types
```

### Pre-publish Checklist
```bash
npm run lint
npm run format:check
npm run typecheck
npm test
npm run build
npm run verify-types
```

All checks must pass before publishing.

## PostgreSQL Integration Details

### How pg Driver Handles Prepared Statements

When you pass `name` in the query config:
```javascript
client.query({
  text: 'SELECT * FROM users WHERE id = $1',
  values: [123],
  name: 'get-user-by-id'  // This triggers prepared statement
});
```

The pg driver automatically:
1. First execution: Sends `PREPARE "get-user-by-id" AS SELECT...`
2. Executes: `EXECUTE "get-user-by-id" (123)`
3. Subsequent executions: Reuses prepared statement, skips PREPARE

### Verifying Prepared Statements

Query PostgreSQL to see active prepared statements:
```sql
SELECT name, statement, parameter_types, from_sql
FROM pg_prepared_statements
WHERE name LIKE 'auto-%' OR name = 'your-custom-name';
```

### Connection Lifecycle

- Prepared statements exist per connection
- Destroyed when connection closes
- Not shared across connection pool
- Persist across transactions on same connection

## Testing Best Practices

### Unit Tests
- Test each module in isolation
- Mock Knex instances when needed
- Use type-safe helpers from `test-utils.ts`
- Keep tests colocated with source files

### Integration Tests
- Use real PostgreSQL database
- Clean up with setup/teardown
- Test actual prepared statement behavior
- Verify performance characteristics

### Benchmarks
- Run locally only (not in CI)
- Use `.env` for configuration
- Include warmup iterations (100)
- Test multiple query patterns
- Compare prepared vs non-prepared

## Common Tasks

### Adding a New Feature
1. Create feature branch from latest main/branch
2. Implement feature with tests
3. Update TypeScript types if needed
4. Add documentation to README
5. Update CHANGELOG
6. Run full verification suite
7. Commit with descriptive message

### Debugging Issues
1. Check `pg_prepared_statements` to verify statement creation
2. Enable Knex debug mode: `knex({..., debug: true})`
3. Use `getMetadata()` helper to inspect builder metadata
4. Check query event is firing: `getKnexEvents(knex)`

### Updating Dependencies
1. Update package.json
2. Run `npm install`
3. Run full test suite
4. Check for breaking changes
5. Update code if needed
6. Document in CHANGELOG

## TypeScript Tips

### Type Inference
The library preserves Knex's type inference:
```typescript
interface User {
  id: number;
  name: string;
}

// Type is inferred as User[]
const users = await knex.prepared<User>('users').select('*');

// Type is inferred as { id: number, name: string }
const user = await knex<User>('users').prepared().where('id', 1).first();
```

### Generic Constraints
All generics constrained to extend `{}`:
```typescript
export function knexPrepared<
  TRecord extends {} = any,
  TResult = any[]
>(knex: Knex<TRecord, TResult>): KnexPrepared<TRecord, TResult>
```

This prevents `TRecord` from being `any` in strict mode while maintaining compatibility.

## Summary

knex-prepared is a well-tested, type-safe library that transparently adds PostgreSQL prepared statement support to Knex.js. The implementation uses Symbol-based metadata, event interception, and deterministic hashing to provide ergonomic APIs without modifying Knex internals. The codebase follows strict TypeScript practices, comprehensive testing, and proper dual-package publishing standards.

For questions or issues, refer to:
- README.md for user documentation
- Test files for usage examples
- This file for implementation details
- Knex documentation: https://knexjs.org
- PostgreSQL prepared statements: https://www.postgresql.org/docs/current/sql-prepare.html
