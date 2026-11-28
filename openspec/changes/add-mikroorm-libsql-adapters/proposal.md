# Proposal

## Why

`@nestbolt/audit-log` only works with TypeORM today. TypeORM is wired into the entity, the module, the query service and the subscriber (`src/entities/audit-log.entity.ts`, `src/audit-log.module.ts`, `src/audit-log.service.ts`, `src/audit-log.subscriber.ts`). Teams on MikroORM cannot use it. That includes teams using SQLite-compatible edge databases such as Turso through `@mikro-orm/libsql`. Most of the library does not depend on the ORM: the diff, field and event filtering, actor resolution, events, decorator, mixin and query contract. Separating that shared core from thin, symmetric ORM adapters lets us support MikroORM without forking the behaviour. No one consumes the current API, so the public surface can be redesigned freely.

## What Changes

- **BREAKING**: the package root `@nestbolt/audit-log` becomes the ORM-free **core**. It no longer exports any TypeORM symbol, and there is no implicit default ORM. Adapters are imported from `@nestbolt/audit-log/typeorm` and `@nestbolt/audit-log/mikro-orm`.
- The **core** holds:
  - the `AuditLogRecord` model, `computeDiff`, `@Auditable()`, `AuditableMixin`, `AUDIT_LOG_EVENTS`, options types and `AuditLogNotInitializedException`
  - a **storage contract** (`AuditLogStorage`) for persisting and querying records
  - a shared **audit recorder**, which applies the filters, builds the diff, resolves the actor and builds the record
  - a storage-backed `AuditLogService`
- **TypeORM adapter**: `TypeOrmAuditLogModule`, `TypeOrmAuditLogEntity` and `TypeOrmAuditLogStorage`.
  - **BREAKING**: these replace `AuditLogModule`, `AuditLogEntity` and the exported `AuditSubscriber`. The subscriber becomes internal.
  - The subscriber snapshots only mapped columns and takes the id from primary-key metadata, which brings it in line with MikroORM.
- **MikroORM adapter**: `MikroOrmAuditLogModule`, `MikroOrmAuditLogSchema` (a `defineEntity` schema for the same `audit_logs` table) and `MikroOrmAuditLogStorage`, plus an internal subscriber with the same capture behaviour as TypeORM.
- Support libSQL and Turso through MikroORM's `@mikro-orm/libsql` driver. That covers local files, `:memory:` and remote `libsql://` URLs with an auth token. Tests run only on libSQL `:memory:` and on a temporary local file. Turso is documented in the README, and there is no live Turso test or CI credential.
- **BREAKING**: subscribers get `AuditLogService` through DI instead of `AuditLogService.getInstance()`. The static accessor remains only as the mixin's lookup.
- **BREAKING**: public types use `AuditLogRecord` instead of the TypeORM `AuditLogEntity`.
- **BREAKING**: removals.
  - The unused `AuditContext` type is removed.
  - The unused `uuid` runtime dependency is removed.
  - The `"ActorResolver"` string token is replaced by an exported `AUDIT_LOG_ACTOR_RESOLVER` token.
- **BREAKING**: targets MikroORM v7 (`^7.0.0`). The package becomes **ESM-only** (`"type": "module"`, `nodenext`).
- **BREAKING**: requires Node `>=26`, the Active LTS as of 2026-11-26. Node 26 is the only supported line. CI drops Node 20 and 22 and runs Node 26 only. NestJS peers become `^11`.
- Bun: partial support. The built core and MikroORM adapter on libSQL are verified on Bun by a required CI smoke job, with a documented fallback (design.md D11). The TypeORM adapter and the dev toolchain on Bun are not supported (design.md D11).
- Behaviour-parity gate: every `audit-log-core` scenario runs through one shared test suite against both adapters. Existing tests may be moved, rewired or rewritten.
- Packaging: one package with subpath exports (decided). Every ORM peer dependency is optional.

## Capabilities

### New Capabilities
- `audit-log-core`: the shared behaviour, independent of any ORM. It covers record shape, diffing, field, event and action filtering, actor resolution, metadata, the `audit.logged` event, the storage and query contract, manual logging, the decorator and mixin, the ORM-free root entry point, and the rule that every adapter satisfies all of it.
- `audit-log-typeorm`: the TypeORM integration. It covers module registration, the `audit_logs` entity, subscriber-based change capture, TypeORM-backed storage, and the `typeorm` entry point.
- `audit-log-mikroorm`: the MikroORM integration. It covers module registration, the `audit_logs` entity schema, change capture through the event subscriber, transactional consistency, MikroORM-backed storage, libSQL/Turso compatibility, and the `mikro-orm` entry point.

### Modified Capabilities
- None. `openspec/specs/` is empty, so no capability exists yet.

## Impact

- **Code**: `src/` is reorganised into `src/core/`, `src/typeorm/` and `src/mikro-orm/`.
  - Entry files: `src/index.ts` (core), `src/typeorm/index.ts` and `src/mikro-orm/index.ts`.
  - The old top-level files are moved or removed.
- **Public API**: redesigned (see What Changes). There is no migration path, because there are no consumers.
- **Dependencies**:
  - Optional peers: `typeorm`, `@nestjs/typeorm`, `@mikro-orm/core` and `@mikro-orm/nestjs`. The MikroORM driver is the application's choice.
  - New dev dependencies: `@mikro-orm/core`, `@mikro-orm/nestjs` and `@mikro-orm/libsql`.
  - `uuid` and `@types/uuid` are removed. Ids come from `crypto.randomUUID()` where the adapter generates them.
- **Tests**: the existing TypeORM-specific tests are reorganised. Every core scenario moves into a shared parity suite run against both adapters.
- **Build and CI**:
  - `package.json` gets `"type": "module"`, an `exports` map and `engines >=26`. `main`/`types` are removed.
  - `tsconfig.json` moves to `module`/`moduleResolution: nodenext`. Relative imports gain `.js` extensions.
  - `vitest.config.ts` coverage excludes are updated.
  - `.github/workflows/tests.yml` uses the Node matrix `["26"]` and gains a `bun-smoke` job. `release.yml` moves to Node 26.
- **Docs**: README is rewritten around the core plus two adapters. CHANGELOG gets a `0.2.0` entry.
