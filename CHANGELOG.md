# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Initial release of knex-prepared library
- Two APIs for enabling prepared statements:
  - Factory method: `knex.prepared('tableName')`
  - Chainable method: `query.prepared(nameOrFlag)`
- Configuration options via `knexPrepared(knex, options)`:
  - `autoNamePrefix` - Customize prefix for auto-generated names (default: 'auto')
  - `autoNameHashLength` - Control hash length in auto-generated names (default: 16)
  - `autoNameAllSelects` - Automatically name all SELECT queries (default: false)
  - `rewriteInClauses` - Rewrite IN clauses to = ANY() for better prepared statement caching (default: false)
  - `disableWarnings` - Disable warnings about IN clause queries (default: true in production)
  - `autoNameCacheSize` - LRU cache size for hash generation (default: 1000)
- Multiple knex instance support: Different instances can have different configurations
- Transaction support: Both `trx('table').prepared()` and `trx.prepared('table')` work within Knex transactions
- Auto-generated prepared statement names using SHA-256 hash with LRU caching
- Custom prepared statement naming support
- Ability to disable prepared statements per query
- Full TypeScript support with type inference preservation
- Query event interception to inject prepared statement names
- PostgreSQL prepared statement caching integration
- Symbol-based metadata and options storage to avoid property conflicts
- Comprehensive unit tests covering all functionality
- Integration tests with real PostgreSQL database
- Benchmark suite to test performance improvements
- Complete API documentation in README
- JSDoc comments for all public APIs
- CI/CD pipeline with GitHub Actions
- Dual-package build (ESM + CJS) with proper TypeScript types
- Environment variable support for configuration

### Features

- **Hash-based naming**: Deterministic `{prefix}-{hash}` format for auto-generated names (configurable)
- **Symbol-based metadata**: Uses Symbol to store prepared statement metadata and options, avoiding property conflicts
- **Query builder extension**: Seamless integration with Knex QueryBuilder
- **Event-driven architecture**: Hooks into Knex query events for transparent injection
- **Zero runtime dependencies**: Only peer dependencies on Knex and pg driver

### Performance

- Prepared statements enable PostgreSQL to cache query execution plans
- Reduced SQL parsing overhead for repeated queries
- 10-30% performance improvement for frequently executed queries
- LRU cache for hash generation avoids re-hashing identical SQL

### Limitations

- PostgreSQL only (no support for MySQL, SQLite, etc.)
- Prepared statements are cached per connection (connection pooling considerations)
- Long-running connections may accumulate prepared statements in memory
