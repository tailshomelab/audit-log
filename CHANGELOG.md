# Changelog

All notable changes to `@nestbolt/audit-log` will be documented in this file.

## v0.2.0 — Core + ORM adapters (unreleased)

The public API is redesigned around an ORM-free core and one adapter per ORM. There is no migration guide: `0.1.0` has no known consumers. Pin `0.1.0` to keep the old API.

### BREAKING CHANGES

- **Core-only root entry point.** `@nestbolt/audit-log` exports only the ORM-free core (`@Auditable()`, `AuditableMixin`, `AuditLogService`, `AUDIT_LOG_EVENTS`, injection tokens, record, storage and option types, `AuditLogNotInitializedException`, `computeDiff`) and loads with no ORM installed. There is no implicit default ORM.
- **Adapters on subpaths.** TypeORM moves to `@nestbolt/audit-log/typeorm` and MikroORM is added at `@nestbolt/audit-log/mikro-orm`. Adapter entry points do not re-export the core.
- **TypeORM names.** `TypeOrmAuditLogModule`, `TypeOrmAuditLogEntity` and `TypeOrmAuditLogStorage` replace `AuditLogModule`, `AuditLogEntity` and the exported `AuditSubscriber`. The subscriber is internal. It now snapshots only mapped columns and takes the entity id from primary-key metadata; composite keys are joined with `:`.
- **Record type.** Public types and return values use the ORM-free `AuditLogRecord` instead of the TypeORM `AuditLogEntity`.
- **Dependency injection.** Subscribers receive `AuditLogService` through DI instead of `AuditLogService.getInstance()`. The static accessor remains only for the mixin's lookup.
- **Removed symbols.**
  - `AuditLogModule`, `AuditLogEntity`, `AuditSubscriber` (replaced, see above).
  - The unused `AuditContext` type.
  - The `"ActorResolver"` string injection token, replaced by the exported `AUDIT_LOG_ACTOR_RESOLVER` token.
  - The `uuid` runtime dependency (ids come from `crypto.randomUUID()` where the adapter generates them).
- **ESM-only.** The package is `"type": "module"` with an `exports` map (`.`, `./typeorm`, `./mikro-orm`); `main`/`types` are removed. CommonJS applications load it through `require(esm)` and need TypeScript `moduleResolution` `nodenext`, `node16` or `bundler`.
- **Node 26.** `engines.node` is `>=26.0.0`; Node 26 is the only supported line. CI runs Node 26 only (Node 20 and 22 are dropped).
- **Peers.** `@nestjs/common` and `@nestjs/core` are `^11`. `typeorm ^0.3`, `@nestjs/typeorm ^11`, `@mikro-orm/core ^7`, `@mikro-orm/nestjs ^7.1.0` and `@nestjs/event-emitter ^3` are optional peers.

### Features

- **Core.** A storage contract (`AuditLogStorage`), a shared audit recorder (filters, diff, actor and record building) used by both adapters, and a storage-backed `AuditLogService`.
- **MikroORM v7 adapter.** `MikroOrmAuditLogModule` (`forRoot`/`forRootAsync`), `MikroOrmAuditLogSchema` (a `defineEntity` schema for the same `audit_logs` table) and `MikroOrmAuditLogStorage`, with an internal event subscriber that writes the record inside the flush's transaction.
- **libSQL and Turso.** Supported through MikroORM's `@mikro-orm/libsql` driver: `:memory:`, local files and remote `libsql://` URLs with an auth token. Tests run on `:memory:` and a temporary file; Turso is documented and type-checked, not live-tested.
- **Events fix.** `audit.logged` is emitted through the application's `EventEmitter2` (looked up by class), so `EventEmitterModule.forRoot()` is all that is needed. `@nestjs/event-emitter` is loaded lazily and stays optional.
- **Bun: partial support.** The built core and MikroORM adapter on libSQL are verified on Bun by the `bun-smoke` CI job. The TypeORM adapter and the dev toolchain are not supported on Bun.
- **Behaviour parity.** One shared scenario suite runs against both adapters, and `pnpm run test:exports` checks each entry point with the other ORMs' packages blocked.

## v0.1.0 — Initial Release

### Features

- **Automatic entity tracking** — TypeORM subscriber automatically logs insert, update, and delete operations on `@Auditable()` entities
- **Change diff** — Records only changed fields with old and new values for updates
- **Actor resolution** — Configurable `ActorResolver` interface to track who made changes
- **Audit log entity** — Dedicated `audit_logs` table with entity type/id, actor, old/new values, metadata, IP address, and user agent
- **Field filtering** — Per-entity `only`/`except` lists and global excluded fields for sensitive data
- **Event filtering** — Choose which actions to track per entity (`created`, `updated`, `deleted`)
- **Manual logging** — `AuditLogService.log()` for custom audit entries
- **Query API** — Query audit logs by entity, actor, action, date range with pagination
- **Entity mixin** — `AuditableMixin()` adds `getAuditLogs()` and `getLatestAuditLog()` to entities
- **Events** — Emits `audit.logged` event via optional `@nestjs/event-emitter`
- **Module configuration** — `forRoot()` and `forRootAsync()` with global excluded fields, default actor, and custom actor resolver
