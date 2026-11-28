# Spec Delta

## Purpose

Defines how the audit log integrates with TypeORM in a NestJS application: module registration, the `audit_logs` table mapping, automatic change capture through TypeORM entity events, TypeORM-backed storage, and the TypeORM entry point.

## ADDED Requirements

### Requirement: TypeORM module registration
The TypeORM integration SHALL be registered globally via `forRoot(options)` and `forRootAsync({ imports, inject, useFactory })` with the core options, SHALL expose the audit service and the options token to the whole application, and SHALL require a configured TypeORM connection.

#### Scenario: Static registration
- **WHEN** an application imports a configured TypeORM connection and the TypeORM audit module via `forRoot({})`
- **THEN** the audit service can be resolved from any module and the options token resolves to `{}`

#### Scenario: Async registration with actor resolver
- **WHEN** the module is registered via `forRootAsync` whose factory returns options containing an `actorResolver` class
- **THEN** the resolver is instantiated and used for actor resolution

### Requirement: TypeORM audit table mapping
The TypeORM integration SHALL map audit records to table `audit_logs` with columns `id` (UUID, generated), `action`, `entity_type`, `entity_id`, `actor_type`, `actor_id`, `old_values`, `new_values`, `metadata` (JSON), `ip_address`, `user_agent`, `created_at` (set on insert), indexed on (`entity_type`,`entity_id`), (`actor_type`,`actor_id`), `action` and `created_at`.

#### Scenario: Schema synchronisation
- **WHEN** the audit entity is included in a TypeORM connection with schema synchronisation
- **THEN** the `audit_logs` table is created with the listed columns and indexed column sets

### Requirement: TypeORM change capture
The TypeORM integration SHALL record `created`, `updated` and `deleted` for auditable entities changed through entity-event-emitting operations (`save`, `remove`), using the triggering operation's transaction and applying all core filtering, diff, actor and event rules.

#### Scenario: Insert, update, delete via repository
- **WHEN** an auditable entity is saved, then modified and saved, then removed via a TypeORM repository
- **THEN** three records are written with actions `created`, `updated`, `deleted` in that order, each with the entity's primary key as `entityId`

#### Scenario: Only mapped columns are recorded
- **WHEN** an auditable entity carrying an unmapped (non-column) property is inserted
- **THEN** `newValues` contains only mapped column properties

#### Scenario: Bulk operations
- **WHEN** an auditable entity is changed with `repository.update()`, `repository.delete()` or a query-builder `update()` or `delete()`
- **THEN** no automatic record is written

#### Scenario: Rolled-back transaction
- **WHEN** an auditable entity is saved inside a TypeORM transaction that is rolled back
- **THEN** neither the entity nor its `created` record exists afterwards

### Requirement: TypeORM entry point
The TypeORM integration SHALL be importable only from the `typeorm` subpath, which SHALL load without any MikroORM package installed.

#### Scenario: TypeORM-only install
- **WHEN** an application with TypeORM installed and no MikroORM packages imports the `typeorm` subpath
- **THEN** module loading succeeds
