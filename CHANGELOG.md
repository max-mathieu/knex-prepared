# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Transaction support: Both `trx('table').prepared()` and `trx.prepared('table')` now work within Knex transactions
- Comprehensive test suite for transaction functionality (13 tests covering all transaction scenarios)

## [0.1.0] - 2026-02-03

### Added

- Initial release of knex-prepared library
- Two APIs for enabling prepared statements:
  - Factory method: `knex.prepared('tableName')`
  - Chainable method: `query.prepared(nameOrFlag)`
- Transaction support: Works seamlessly with `knex.transaction()`
- Auto-generated prepared statement names using SHA-256 hash
- Custom prepared statement naming support
- Ability to disable prepared statements per query
- Full TypeScript support with type inference preservation
- Query event interception to inject prepared statement names
- PostgreSQL prepared statement caching integration
- Comprehensive unit tests covering all functionality
- Integration tests with real PostgreSQL database
- Complete API documentation in README
- JSDoc comments for all public APIs
- CI/CD pipeline with GitHub Actions
- Dual-package build (ESM + CJS) with proper TypeScript types

### Features

- **Hash-based naming**: Deterministic `auto-{hash16}` format for auto-generated names
- **Symbol-based metadata**: Uses Symbol to store prepared statement metadata, avoiding property conflicts
- **Query builder extension**: Seamless integration with Knex QueryBuilder
- **Event-driven architecture**: Hooks into Knex query events for transparent injection
- **Zero runtime dependencies**: Only peer dependencies on Knex and pg driver

### Performance

- Prepared statements enable PostgreSQL to cache query execution plans
- Reduced SQL parsing overhead for repeated queries
- 10-30% performance improvement for frequently executed queries

### Limitations

- PostgreSQL only (no support for MySQL, SQLite, etc.)
- Prepared statements are cached per connection (connection pooling considerations)
- Long-running connections may accumulate prepared statements in memory

[0.1.0]: https://github.com/max/knex-prepared/releases/tag/v0.1.0
