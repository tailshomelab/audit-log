# Spec Delta

## Purpose

Defines how the audit log integrates with MikroORM in a NestJS application, including libSQL/Turso databases: module registration, the `audit_logs` entity mapping, automatic change capture at parity with the TypeORM integration, and storage/query behaviour.

## ADDED Requirements

### Requirement: MikroORM module registration
The MikroORM integration SHALL be registered globally via `forRoot(options)` and `forRootAsync({ imports, inject, useFactory })` accepting the same options as the TypeORM integration, and SHALL require the application to have a configured MikroORM connection.

#### Scenario: Static registration
- **WHEN** an application configures MikroORM with the audit entity schema and imports the MikroORM audit module via `forRoot({})`
- **THEN** the audit service can be resolved from any module and the options token resolves to `{}`

#### Scenario: Async registration
- **WHEN** the module is registered via `forRootAsync` with an injected configuration provider
- **THEN** the factory's options (including `actorResolver`) take effect

### Requirement: MikroORM audit table mapping
The MikroORM integration SHALL provide an entity definition that maps to table `audit_logs` with the same column names, nullability, JSON columns and indexes as the TypeORM mapping, generating a UUID `id` and setting `created_at` on insert.

#### Scenario: Shared table across adapters
- **WHEN** the MikroORM schema generator creates the audit table on an empty SQLite/libSQL database
- **THEN** the table name, column names, nullability and indexed column sets match those defined for the TypeORM integration (index names and column storage types MAY differ)

#### Scenario: Entity not registered
- **WHEN** the MikroORM audit module is initialized but the audit entity definition was not added to the MikroORM configuration
- **THEN** startup fails with an error that names the missing audit entity

### Requirement: MikroORM change capture
The MikroORM integration SHALL record `created`, `updated` and `deleted` for auditable entities persisted through the unit of work (`persist`/`remove` + `flush`, including `em.transactional`), applying all core filtering, diff, actor and event rules.

#### Scenario: Insert, update, delete via flush
- **WHEN** an auditable entity is persisted and flushed, then modified and flushed, then removed and flushed
- **THEN** three records are written with actions `created`, `updated`, `deleted`, the entity's primary key as `entityId`, and payloads equivalent to the TypeORM integration for the same entity data

#### Scenario: Update diff uses persisted snapshot
- **WHEN** a loaded auditable entity has `name` changed from `Alice` to `Bob` and is flushed
- **THEN** the record's `oldValues` is `{ name: "Alice" }` and `newValues` is `{ name: "Bob" }`

#### Scenario: Several entities in one flush
- **WHEN** two auditable entities and one non-auditable entity are created in a single flush
- **THEN** exactly two `created` records are written

#### Scenario: Audit records are not audited
- **WHEN** an audit record is written
- **THEN** no further audit record is produced for it

#### Scenario: Native queries
- **WHEN** an auditable entity is changed via `nativeUpdate`, `nativeDelete`, `insert` or the query builder
- **THEN** no automatic record is written

### Requirement: MikroORM transactional consistency
Automatically captured records SHALL be written in the same transaction as the triggering flush, so a rolled-back transaction leaves no audit record for its changes.

#### Scenario: Rolled-back transaction
- **WHEN** an auditable entity is persisted inside `em.transactional()` whose callback throws after flushing
- **THEN** neither the entity nor its `created` record exists afterwards

### Requirement: MikroORM storage and queries
Manual logging and all query operations SHALL behave as defined by the core capability when the MikroORM integration is active, and SHALL work outside an HTTP request context.

#### Scenario: Query outside request context
- **WHEN** the audit service's query methods are called from a startup hook or background job with no request-scoped MikroORM context
- **THEN** results are returned without a global-context validation error

### Requirement: libSQL and Turso compatibility
The MikroORM integration SHALL work with the MikroORM libSQL driver for in-memory and local file databases. It SHALL take no connection settings of its own, so remote Turso databases are used only through MikroORM's `dbName` (URL) and `password` (auth token) options.

#### Scenario: In-memory libSQL
- **WHEN** MikroORM is configured with the libSQL driver and `dbName: ":memory:"`
- **THEN** change capture, manual logging and queries behave as specified

#### Scenario: Local libSQL file
- **WHEN** MikroORM is configured with the libSQL driver and a file path, records are written, and the ORM is closed and reopened
- **THEN** previously written records are returned by queries with JSON fields intact

#### Scenario: Documented Turso configuration compiles
- **WHEN** the documented Turso configuration (a `libsql://` URL as `dbName`, the auth token as `password`, the audit schema in `entities`) is type-checked together with the MikroORM audit module, without any network access
- **THEN** it compiles, with no audit-module option for the connection target

### Requirement: Bun runtime compatibility
The built package's core and MikroORM integration SHALL run on the current stable Bun release with the libSQL driver.

#### Scenario: Bun smoke run
- **WHEN** the built package is loaded under Bun, the MikroORM audit module is bootstrapped on libSQL `:memory:`, and an auditable entity is created, updated and removed
- **THEN** three records with actions `created`, `updated` and `deleted` are returned by the audit service

### Requirement: MikroORM subpath entry point
The MikroORM integration SHALL be importable from a dedicated `mikro-orm` subpath that does not require `typeorm` or `@nestjs/typeorm` to be installed.

#### Scenario: MikroORM-only install
- **WHEN** an application with MikroORM installed and no TypeORM packages imports the `mikro-orm` subpath
- **THEN** module loading succeeds
