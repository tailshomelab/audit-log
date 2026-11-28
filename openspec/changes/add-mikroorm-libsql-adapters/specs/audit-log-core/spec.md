# Spec Delta

## Purpose

Defines the ORM-agnostic audit-log behaviour shared by every persistence adapter: what an audit record contains, how changes are filtered and diffed, how actors and metadata are attached, how records are queried, and which events are emitted.

## ADDED Requirements

### Requirement: Audit record shape
Every audit record SHALL expose `id`, `action` (`created` | `updated` | `deleted`), `entityType`, `entityId` (string), `actorType`, `actorId`, `oldValues`, `newValues`, `metadata`, `ipAddress`, `userAgent` and `createdAt`, independent of the persistence adapter in use.

#### Scenario: Record returned by any adapter
- **WHEN** a record is written and read back through any supported adapter
- **THEN** it exposes all listed fields with the same names and value types, with JSON fields returned as plain objects or `null`

### Requirement: Auditable opt-in
Only entity classes marked as auditable SHALL produce automatic audit records. `auditableType` SHALL default to the class name unless overridden.

#### Scenario: Unmarked entity
- **WHEN** an entity class without the auditable marker is inserted, updated or deleted
- **THEN** no audit record is written

#### Scenario: Custom auditable type
- **WHEN** an entity is marked auditable with `auditableType: "AppUser"` and is inserted
- **THEN** the record's `entityType` is `AppUser`

### Requirement: Field filtering
Recorded values SHALL exclude `id`, `createdAt`, `updatedAt`, `created_at`, `updated_at`, the entity-level `except` list and the module-level `globalExcludedFields`. When an entity-level `only` list is set, only those fields SHALL be recorded.

#### Scenario: Except and global exclusions
- **WHEN** an auditable entity with `except: ["secret"]` is inserted while `globalExcludedFields` contains `password`
- **THEN** `newValues` contains neither `secret`, `password`, `id` nor timestamp fields

#### Scenario: Only list
- **WHEN** an auditable entity with `only: ["title"]` is updated on `title` and `body`
- **THEN** the record's `oldValues` and `newValues` contain only `title`

### Requirement: Update diff
For an update, the record SHALL contain only fields whose value changed, with previous values in `oldValues` and current values in `newValues`; structural equality SHALL be used for objects and arrays. An update with no effective change SHALL produce no record.

#### Scenario: Partial change
- **WHEN** an auditable entity's `name` changes from `Alice` to `Bob` and `email` is unchanged
- **THEN** `oldValues` is `{ name: "Alice" }` and `newValues` is `{ name: "Bob" }`

#### Scenario: Entity not loaded before the update
- **WHEN** an auditable entity is updated without being loaded first (only its primary key and a new `name` are set), and its persisted `name` is `Alice`
- **THEN** the record's `oldValues` is `{ name: "Alice" }` and `newValues` is `{ name: "Bob" }`, with no other field

#### Scenario: No effective change
- **WHEN** an auditable entity is saved with values identical to the persisted ones
- **THEN** no audit record is written

### Requirement: Create and delete payloads
A `created` record SHALL have `oldValues = null` and `newValues` set to the filtered entity values; a `deleted` record SHALL have `oldValues` set to the filtered entity values and `newValues = null`.

#### Scenario: Delete payload
- **WHEN** an auditable entity is removed
- **THEN** the record has action `deleted`, the removed entity's id as `entityId`, its filtered values in `oldValues`, and `newValues` null

### Requirement: Action filtering
An action SHALL NOT be recorded automatically when it is absent from the entity-level `events` list or present in the module-level `disabledActions` list.

#### Scenario: Entity-level events
- **WHEN** an entity marked with `events: ["created", "deleted"]` is updated
- **THEN** no `updated` record is written

#### Scenario: Module-level disabled action
- **WHEN** the module is configured with `disabledActions: ["deleted"]` and an auditable entity is removed
- **THEN** no `deleted` record is written

### Requirement: Actor and metadata attribution
Each record SHALL carry the actor from an explicit manual-log actor, else the configured actor resolver, else `defaultActor`, else null. `metadata` SHALL be the explicit manual-log metadata, else the module-level `metadata`, else null.

#### Scenario: Resolver actor on automatic capture
- **WHEN** an actor resolver returns `{ type: "User", id: "admin-1" }` and an auditable entity is inserted
- **THEN** the record has `actorType` `User` and `actorId` `admin-1`

#### Scenario: Async resolver
- **WHEN** the actor resolver returns a Promise
- **THEN** the resolved actor is recorded

### Requirement: Failure isolation for automatic capture
An error raised while building or writing an automatically captured audit record SHALL NOT be propagated to the caller of the entity operation; the audit record is skipped instead.

#### Scenario: Audit write error
- **WHEN** writing an automatic audit record throws (for example, the audit table is missing) on a database that does not abort the surrounding transaction on statement errors, such as SQLite or libSQL
- **THEN** the user's insert, update or delete still completes successfully and no audit record exists for it

### Requirement: Logged event
After each audit record is persisted, automatic or manual, the system SHALL emit `audit.logged` with payload `{ auditLog }` when an event emitter is available, and SHALL work without one. For automatic capture, the event SHALL be emitted only after the transaction that wrote the record commits, and SHALL NOT be emitted when that transaction rolls back.

#### Scenario: Emitter present
- **WHEN** an event emitter is registered and a record is written
- **THEN** `audit.logged` is emitted once with the persisted record

#### Scenario: Emitted after commit
- **WHEN** an event emitter is registered and auditable entities are created inside a transaction
- **THEN** `audit.logged` is not emitted before the transaction commits, and is emitted once per record after it commits

#### Scenario: No event for a rolled-back transaction
- **WHEN** an event emitter is registered and an auditable entity is created inside a transaction that rolls back
- **THEN** neither the record nor an `audit.logged` event exists afterwards

#### Scenario: Emitter absent
- **WHEN** no event emitter is registered and a record is written
- **THEN** the write succeeds without error

### Requirement: Manual logging
The service SHALL persist a record from explicit parameters (`action`, `entityType`, `entityId`, optional values, actor, metadata, ipAddress, userAgent) and return the persisted record with generated `id` and `createdAt`.

#### Scenario: Manual entry
- **WHEN** `log({ action: "created", entityType: "User", entityId: "user-1", newValues: { name: "Alice" } })` is called
- **THEN** a record with a generated id, those values and `createdAt` is returned and persisted

### Requirement: Query by entity and actor
The service SHALL return records for a given `entityType`+`entityId`, or `actorType`+`actorId`, ordered by `createdAt` descending, optionally filtered by `action`, inclusive `from`/`to` dates, and paginated by `limit`/`offset`.

#### Scenario: Filtered paginated query
- **WHEN** records exist for an entity with mixed actions and dates and a query passes `action`, `from`, `to`, `limit` and `offset`
- **THEN** only matching records are returned, newest first, honouring the page window

#### Scenario: Unknown entity
- **WHEN** records are queried for an entity with no records
- **THEN** an empty list is returned

### Requirement: Latest record lookup
The service SHALL return the most recent record for an `entityType`+`entityId`, or null when none exists.

#### Scenario: No records
- **WHEN** the latest record is requested for an entity without records
- **THEN** null is returned

### Requirement: Entity mixin helpers
Entities using the auditable mixin SHALL expose their auditable type, string id, audit records and latest record, and SHALL raise a not-initialized error when no audit module is active.

#### Scenario: Module not initialized
- **WHEN** an entity's mixin `getAuditLogs()` is called before any audit module is initialized
- **THEN** it rejects with the audit-log not-initialized error

### Requirement: ORM-free core entry point
The package root entry point SHALL expose only the core (decorator, mixin, service, storage contract, record and option types, events, tokens, exceptions, diff) and SHALL load without any ORM package installed. It SHALL NOT export adapter-specific symbols.

#### Scenario: No ORM installed
- **WHEN** the package root is loaded in an environment where neither TypeORM nor MikroORM packages are resolvable
- **THEN** loading succeeds and no TypeORM or MikroORM symbol is exported

### Requirement: Adapter behaviour parity
Every supported persistence adapter SHALL satisfy every scenario of this capability, verified by one shared scenario suite executed against each adapter.

#### Scenario: Shared suite against each adapter
- **WHEN** the shared core scenario suite runs once with the TypeORM adapter and once with the MikroORM adapter on libSQL
- **THEN** every scenario passes for both adapters with identical expected records
