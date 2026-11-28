# Design

## Context

The motivation is in proposal.md (Why). Requirements are in `specs/audit-log-core`, `specs/audit-log-typeorm` and `specs/audit-log-mikroorm`.

The user confirmed two decisions:
- Backward compatibility with the current API does not matter, because nobody consumes this fork. Breaking changes are allowed.
- The target is MikroORM v7.

**Observed facts** (read from the repo at commit `0a558d9`):

- **Package.** Single npm package `@nestbolt/audit-log@0.1.0`. It is not a monorepo, and pnpm 9 is the package manager.
  - Build: `tsc -p tsconfig.build.json` produces CommonJS (`module: commonjs`, moduleResolution node10) in `dist/`.
  - `exports` has only `"."`.
  - Engines: `node >=20`. CI (`.github/workflows/tests.yml`) runs Node 20 and 22 with `pnpm install --frozen-lockfile`, `pnpm run build` and `pnpm test`. `release.yml` builds, tests and publishes on Node 22.
  - Peers: `@nestjs/common` and `@nestjs/core` 10 or 11, `@nestjs/event-emitter` (optional), `@nestjs/typeorm` 10 or 11, `typeorm ^0.3`, `reflect-metadata`.
  - The runtime dependency `uuid` is declared but never imported in `src/`.
- **TypeORM coupling.** It is confined to four files:
  - `src/entities/audit-log.entity.ts`: `@Entity("audit_logs")`, `simple-json` columns, a UUID `PrimaryGeneratedColumn`, `CreateDateColumn created_at`, and four `@Index`es.
  - `src/audit-log.module.ts`: global; uses `TypeOrmModule.forFeature`; registers the resolver under the `"ActorResolver"` string token.
  - `src/audit-log.service.ts`: an injected `Repository` and `createQueryBuilder` queries. It keeps a static singleton (`getInstance`) and emits through an optional `"EventEmitter2"` token.
  - `src/audit-log.subscriber.ts`: a `DataSource`-injected class that registers itself through `dataSource.subscribers.push`.
- **Subscriber behaviour.**
  - Hooks: `afterInsert`, `beforeUpdate`/`afterUpdate`, `afterRemove`. Old values for updates come from a WeakMap snapshot of `event.databaseEntity`, falling back to `findOne` by `id`.
  - It writes through `event.manager`, so the audit write runs in the same transaction as the triggering operation. It swallows every write error.
  - It gets options and the actor through `AuditLogService.getInstance()` and calls the private `emit` through an `any` cast.
  - The record id comes from `entity.id` (or `event.entityId` on remove). The values come from `Object.keys(entity)`.
- **ORM-agnostic code:**
  - `src/utils/diff.ts`, `src/decorators/*`, `src/events/*`, `src/exceptions/*`, `src/interfaces/*`
  - `src/mixins/auditable.mixin.ts`, which only type-imports `AuditLogEntity` and depends on the static singleton
  - `AuditContext` is exported but unused
  - `extractValues` repeats the `ALWAYS_EXCLUDED` list from `diff.ts`
- **Tests.**
  - Vitest 4, `test/**/*.spec.ts`, TypeORM on `better-sqlite3` `:memory:`. There are 7 files and roughly 90 cases.
  - Several files wire `AuditLogService` by hand.
  - Some setup already relies on `design:paramtypes`: the `AuditSubscriber(dataSource: DataSource)` constructor has no `@Inject`.
  - `node_modules` is not installed, so no test run was observed.
- **OpenSpec.** `openspec/specs/` is empty, and `config.yaml` has no `context` or `rules`.

**MikroORM v7 facts** (context7, `/mikro-orm/mikro-orm/v7.2.5`):

- **Packaging:**
  - Native ESM. Node 22.17+ is required.
  - TypeScript must use `moduleResolution` `node20`, `nodenext` or `bundler`.
  - It can still be consumed from CommonJS on Node versions that support `require(esm)`.
- **API changes from v6:**
  - Decorators moved to `@mikro-orm/decorators` (`/legacy` or `/es`).
  - `knex` was replaced by `kysely` (`@mikro-orm/knex` is now `@mikro-orm/sql`).
  - `em.persistAndFlush`/`removeAndFlush` were removed. Use `em.persist(x).flush()`. `em.create()` persists automatically.
  - Schema generator methods were renamed: `orm.schema.createSchema()` is now `orm.schema.create()`, and likewise `refresh()`, `drop()` and so on.
  - `MikroORM.init(config)` and `MikroOrmModule.forRoot(config)` now require an explicit config.
- **Entity definitions:** `EntitySchema` is still supported (`name`/`class`, `tableName`, `properties`, `indexes`). `defineEntity` with the `p` property builder is the recommended form, and `setClass` attaches a real class.
- **Subscribers:**
  - The hooks `afterCreate`, `afterUpdate` and `afterDelete` receive `EventArgs<T> = { entity, em, changeSet? }`. The `changeSet` has `type`, `payload`, `persisted` and `originalEntity` (the snapshot taken when the entity was loaded).
  - Flush events are `beforeFlush`, `onFlush` (`uow.getChangeSets()`, `uow.computeChangeSet()`) and `afterFlush`.
  - Hooks must not call `flush` or `persist`.
  - Subscribers that need NestJS DI are `@Injectable` and call `em.getEventManager().registerSubscriber(this)`.
- **Native writes:** `em.insert(entityName, data)` is a native insert that does not trigger hooks. Native EntityManager calls run in the em's current transaction context; a forked em has none.
- **libSQL / Turso:** `defineConfig` from `@mikro-orm/libsql` with `dbName` (path, `:memory:` or `libsql://` URL) and `password` (auth token). Embedded replicas use `driverOptions: { syncUrl, syncPeriod }`.
- **Not confirmed by the docs:** the exact `@mikro-orm/nestjs` v7 version and its `@nestjs/*` peer range. Task 1.2 checks them (A2).

## Goals / Non-Goals

**Goals:**
- One shared implementation of filtering, diff, actor, metadata and events. Adapters only capture changes and persist records.
- Symmetric adapters. Both pass one shared scenario suite (core spec, "Adapter behaviour parity"). That suite is the acceptance gate.
- MikroORM v7 capture writes in the same transaction as the flush.
- libSQL is the only MikroORM test driver: `:memory:` and local file databases. Turso is documented, not live-tested (D9).

**Non-Goals:**
- Any compatibility layer, deprecation alias or migration path for the 0.1.0 API.
- Running both adapters in one process at the same time. The mixin's static lookup assumes a single active module.
- Supporting MikroORM v6, or ORMs and drivers beyond TypeORM and MikroORM SQL drivers.
- Interchangeable stored data when one physical table is moved between ORMs. Column names match, but Date and JSON encodings are each ORM's own.
- Automatic ipAddress and userAgent capture, and new filters.
- Bun as a development runtime, and the TypeORM adapter on Bun (D11).

## Decisions

### D0. Module format: ESM-only package
The whole package becomes ESM: `"type": "module"`.

- **tsconfig.json:**
  - `module` and `moduleResolution` set to `nodenext`, with `target: ES2022`.
  - The decorator flags (`experimentalDecorators`, `emitDecoratorMetadata`) stay.
  - `baseUrl` is dropped.
  - Every relative import gains a `.js` extension.
- **package.json:**
  - `"type": "module"`.
  - An `exports` map with `types` + `default` conditions (D1).
  - `main`/`types` are removed and there is no `typesVersions`. node10 resolution cannot consume an ESM package that depends on MikroORM v7 correctly anyway.
  - `engines.node` becomes `>=26.0.0` (D8). That is above MikroORM v7's 22.17 floor.
- **CommonJS consumers.** Most NestJS apps are CommonJS. They can still load us through `require(esm)`, which is stable on every supported Node line. They need `moduleResolution: node16`/`nodenext`/`bundler` for types, which MikroORM v7 already demands. The README states this.
- **Vitest.** The config file is already ESM syntax and keeps working under `"type": "module"`. Only the coverage excludes change (task 6.2). Tests import sources with `.js` extensions. Vite resolves `.js` to `.ts` automatically.
- **TypeORM under ESM:**
  - We use `typeorm` 0.3 (assumption A4: it ships an ESM entry) and `@nestjs/typeorm`, which is CommonJS and is imported through Node's CJS named-export interop.
  - Circular entity imports combined with `emitDecoratorMetadata` can hit temporal-dead-zone errors under ESM. The audit entity has no relations, so this matters only for user entities. The README documents TypeORM's `Relation<>` wrapper.
  - The CJS→ESM smoke check (task 6.3) imports every TypeORM symbol we use.
- **CI.**
  - `tests.yml`: the Node matrix changes from `[20, 22]` to `["26"]` (D8).
  - `tests.yml` also gains a `bun-smoke` job (D11).
  - `release.yml`: moves from Node 22 to `"26"`.
- **Alternative: a dual CJS + ESM build.** This is the dual-package hazard: two copies of `AuditLogService` (static mixin lookup), two `AuditLogNotInitializedException` classes, and `instanceof` failures. It also needs two tsc passes or a bundler. There is no consumer who needs native CJS. Rejected.
- **Alternative: ESM only for the `mikro-orm` subpath inside a CJS package.** It needs per-directory `package.json` `type` overrides or `.mts` files, two tsconfigs, and CJS core code consumed from an ESM adapter. The same class-identity problem appears between the core and the adapter. Rejected.
- **Alternative: stay CJS and `require()` MikroORM v7 through `require(esm)`.** TypeScript would emit `require` calls into an ESM-only package. It works only if no MikroORM module uses top-level await, which is fragile and unverified, and it brings no benefit once compatibility no longer matters. Rejected.

### D1. Packaging: one package with subpath exports
Decided by the user (OQ1 closed).

```
@nestbolt/audit-log            -> dist/index.js           (core only, loads with no ORM installed)
@nestbolt/audit-log/typeorm    -> dist/typeorm/index.js   (TypeORM adapter symbols only)
@nestbolt/audit-log/mikro-orm  -> dist/mikro-orm/index.js (MikroORM adapter symbols only)
```

- Adapter entry points do not re-export the core, so each symbol has exactly one import path.
- Every ORM peer is optional in `peerDependenciesMeta`.
- **Why one package:** the library is about 600 lines with one release workflow. Subpath exports give the same peer isolation, because no entry point imports an ORM it does not need. Separate packages would add a workspace, a per-package release pipeline and version coordination, with no isolation gained.
- **Alternative: separate npm packages in a pnpm workspace** (`@nestbolt/audit-log`, `-typeorm`, `-mikro-orm`). Rejected by the user's decision.

### D2. Source layout and public names

```
src/
  index.ts                         # core public surface
  core/
    audit-log.constants.ts         # AUDIT_LOG_OPTIONS, AUDITABLE_METADATA_KEY, AUDIT_LOG_STORAGE, AUDIT_LOG_ACTOR_RESOLVER
    audit-log.service.ts           # storage-backed
    audit-recorder.ts              # shared capture pipeline (D4)
    audit-log-providers.ts         # builds forRoot/forRootAsync providers for any adapter
    interfaces/                    # options, actor, AuditLogRecord, AuditLogDraft, AuditLogStorage (AuditContext removed)
    decorators/  mixins/  events/  exceptions/  utils/diff.ts
  typeorm/
    index.ts                       # TypeOrmAuditLogModule, TypeOrmAuditLogEntity, TypeOrmAuditLogStorage
    typeorm-audit-log.entity.ts
    typeorm-audit.subscriber.ts    # internal, not exported
    typeorm-audit-log.storage.ts
    typeorm-audit-log.module.ts
  mikro-orm/
    index.ts                       # MikroOrmAuditLogModule, MikroOrmAuditLogSchema, MikroOrmAuditLogStorage
    mikro-orm-audit-log.schema.ts
    mikro-orm-audit.subscriber.ts  # internal, not exported
    mikro-orm-audit-log.storage.ts
    mikro-orm-audit-log.module.ts
```

- The names are symmetric: `TypeOrm*` and `MikroOrm*`.
- Subscribers are internal, because the modules register them.
- Storages are exported so tests and advanced users can wire `AuditLogService` themselves.
- `AUDIT_LOG_ACTOR_RESOLVER` is a `Symbol` that replaces the `"ActorResolver"` string.
- Removed:
  - `AuditLogModule`, `AuditLogEntity`, `AuditSubscriber` and the `AuditContext` type
  - `uuid` and `@types/uuid` from `package.json`
- `AuditLogNotInitializedException` gets a message that does not name a module.
- Tests: `test/core/*` for pure units, `test/parity/*` for the shared scenario suite (D10), and `test/typeorm/*` and `test/mikro-orm/*` for adapter-only behaviour. Existing tests are moved, rewired or rewritten as needed.

### D3. Storage contract

```ts
interface AuditLogRecord { id; action; entityType; entityId; actorType; actorId; oldValues; newValues; metadata; ipAddress; userAgent; createdAt }
type AuditLogDraft = Omit<AuditLogRecord, "id" | "createdAt">;
interface AuditLogStorage {
  save(draft: AuditLogDraft): Promise<AuditLogRecord>;
  findByEntity(entityType, entityId, q?: AuditLogQueryOptions): Promise<AuditLogRecord[]>;
  findByActor(actorType, actorId, q?: AuditLogQueryOptions): Promise<AuditLogRecord[]>;
  findLatest(entityType, entityId): Promise<AuditLogRecord | null>;
}
```

- `AuditLogService` injects `AUDIT_LOG_OPTIONS`, `AUDIT_LOG_STORAGE`, `ModuleRef` and the optional `AUDIT_LOG_ACTOR_RESOLVER`.
  - In `onModuleInit` it looks up the `EventEmitter2` class token, which is what `EventEmitterModule.forRoot()` registers, with `moduleRef.get(EventEmitter2, { strict: false })`. `@nestjs/event-emitter` is imported lazily, so it stays an optional peer. When the package or the module is missing, no event is emitted.
  - Checked during phase 5: the old `"EventEmitter2"` string token never resolved against `EventEmitterModule.forRoot()` on NestJS 11 (`audit.logged` was never emitted).
- It exposes `log`, `getAuditLogs`, `getAuditLogsByActor`, `getLatestAuditLog`, `resolveActor`, `getOptions` and `notifyLogged(record)`.
- All public types use `AuditLogRecord`, including `AuditLoggedEvent` and `AuditableMixinEntity`. The TypeORM entity `implements AuditLogRecord`.
- Automatic capture does not use `save`. Adapters write with the transaction handle of the operation that triggered them (D4, D5).
- **Alternative: a generic repository abstraction.** It is speculative. Four methods cover every use.

### D4. Shared capture pipeline and DI
`AuditRecorder` is an `@Injectable` in core. It injects `AuditLogService` and exposes ORM-neutral functions:

- `resolveTarget(entity)` reads the `@Auditable` metadata from `entity.constructor`. It returns null when the entity is not auditable.
- `isEnabled(meta, action)`: entity-level `events` plus module-level `disabledActions`.
- `buildCreated`, `buildUpdated` and `buildDeleted` work on adapter-supplied snapshots and use one shared `ALWAYS_EXCLUDED` list.
- `toDraft(...)` builds the record draft. It awaits `resolveActor()` and applies the metadata.
- `afterWrite(record)` calls `notifyLogged`.

Both subscribers inject `AuditRecorder` through the constructor, so the static singleton is no longer used anywhere in capture. The static `AuditLogService.getInstance()` is kept only as the mixin's lookup: mixin methods run on entity instances outside DI. Removing the mixin would drop a feature, which is out of scope.

**TypeORM subscriber, aligned with MikroORM:**
- It is injected with `DataSource` and `AuditRecorder` through explicit `@Inject`s, so it no longer relies on `design:paramtypes`. It registers through `dataSource.subscribers.push(this)`.
- Hooks: `afterInsert`, `beforeUpdate`/`afterUpdate` (keeping the `databaseEntity`/`findOne` snapshot), `afterRemove`.
- Snapshots contain only mapped column properties (`event.metadata.columns`), instead of `Object.keys(entity)`.
- `entityId` comes from the primary-key metadata. A single key is stringified; composite keys are joined with `:` (assumption A3). On remove it uses `event.entityId`.
- It writes through `event.manager.getRepository(TypeOrmAuditLogEntity)` inside a try/catch whose catch block documents why the record is skipped.

**Notification after commit (review fix).** Both subscribers queue each written record and call `recorder.afterWrite` only after the transaction that wrote it commits. They drop the queue when it rolls back.
- TypeORM keys the queue by `QueryRunner`, with one frame per open level (`afterTransactionStart` pushes, `afterTransactionCommit` pops and merges a released savepoint into its parent, `afterTransactionRollback` pops and drops).
- MikroORM keys the queue by the `Transaction` object, which is the same object in the entity hooks (`em.getTransactionContext()`) and in `afterTransactionCommit`/`afterTransactionRollback` (`args.transaction`). This was checked on 7.2.12: the implicit flush transaction also fires these events. A savepoint has its own `Transaction`, and `beforeTransactionStart` receives the enclosing one, so a released savepoint's records move to its parent.
- A write with no open transaction is already committed, so it is notified at once.

**Update payloads (review fix).** `AuditRecorder.buildUpdated` takes the fields the update wrote (TypeORM `updatedColumns`/`updatedRelations`, MikroORM `changeSet.payload` keys) and compares only those. For an uninitialized reference or a partially loaded entity, the MikroORM subscriber reads the persisted row in `beforeUpdate`, through a fork that keeps the flush's transaction context. The recorder also converts `bigint` values to decimal strings, because `JSON.stringify` throws on them.

### D5. MikroORM v7 change capture
**Primary approach: entity hooks that write inside the flush transaction.**

- `MikroOrmAuditSubscriber` is `@Injectable()`. It injects `MikroORM` and `AuditRecorder`, and calls `orm.em.getEventManager().registerSubscriber(this)`.
- It does not implement `getSubscribedEntities`. It filters with `resolveTarget` and skips `MikroOrmAuditLogSchema`.
- **Hooks:**
  - `afterCreate(args)`: the PK is assigned after the insert, including autoincrement keys.
  - `afterUpdate(args)`: `old` comes from `args.changeSet.originalEntity` and `current` from `toSnapshot(entity)`, both over the same property set.
  - `afterDelete(args)`: values come from the entity or from `changeSet.originalEntity`.
- **`entityId`:** the serialized primary key from the entity's metadata. Composite keys are joined with `:` (A3), the same as TypeORM. A key that is a relation to a composite-key entity is flattened into the same `:`-joined list.
- **`toSnapshot`:** scalar and embedded properties, plus owning to-one relations as their PK. Collections and inverse sides are skipped. TypeORM's mapped-column snapshot produces the same payloads for the parity entities.
- **Write:**
  - `await args.em.insert(MikroOrmAuditLogSchema, row)`, where `row` = draft + `id: crypto.randomUUID()` + `createdAt: new Date()`.
  - It is wrapped in try/catch, then `recorder.afterWrite(row)` runs.
  - `em.insert` is native, so there is no flush inside the flush and no hook re-entry. It runs in the em's transaction context.
- **Assumption A1 (re-checked against the v7 docs):** the v7 docs confirm that native em calls and `getKysely()` follow the em's current transaction context. They do not say that the `em` in `EventArgs` carries the flush's implicit transaction. Task 2.1 checks this with a v7 spike. The rolled-back-transaction scenario in the spec is the gate.
- **Task 2.1 result (2026-11-26, `@mikro-orm/core`/`libsql` 7.2.12, libSQL `:memory:`, Node 22.23.5): A1 holds. The primary approach stands, and phase 5 uses the hooks with `args.em.insert`.**
  - (a) A plain `em.persist(x).flush()` writes the probe row, with the widget's id.
  - (b) `em.transactional(...)` that throws after `flush()` leaves neither the widget nor the probe row.
  - (c) An autoincrement PK is already assigned to the entity in `afterCreate`, for each entity of a two-entity flush. The fallback's autoincrement limitation does not apply.
  - In (a) and (b), `args.em.isInTransaction()` is `true` inside `afterCreate`. So the insert runs in the flush's transaction context by MikroORM's design, not just because `:memory:` uses one connection.
  - Evidence: `test/mikro-orm/transaction-spike.spec.ts` (deleted by task 2.2 after 5.3).
- **Fallback if A1 fails: `onFlush`.** Not needed (see the task 2.1 result). It is kept here for reference only.
  - For each auditable change set, `em.create(MikroOrmAuditLogSchema, row, { persist: false })` then `uow.computeChangeSet(row)`. This is the documented outbox pattern, atomic by construction.
  - Limitation: on create, the PK must be known at `onFlush` (UUID `onCreate` or client-assigned). Autoincrement keys would be documented as unsupported.
  - The tasks do not change; only the body of the subscriber does.
- **Alternative: `afterFlush` with a forked em.** It runs after commit, which breaks transactional consistency. Rejected.

### D6. MikroORM schema, storage and module (v7 APIs)
- **Schema.** `MikroOrmAuditLogSchema` is built with `defineEntity({ name: "AuditLog", tableName: "audit_logs", properties: … })`, using `p.uuid().primary().onCreate(() => randomUUID())`, `p.string()` lengths that match TypeORM, nullable `p.json()`, and `p.datetime().onCreate(() => new Date())`.
  - It sets an explicit field name per property, so it does not depend on the user's naming strategy.
  - It declares indexes on the four column sets.
  - It has no class, so `@mikro-orm/decorators` is not needed.
  - If a builder method for field names is missing, it falls back to `new EntitySchema({...})`. The v7 docs list it as still supported.
- **Module.**
  - `MikroOrmAuditLogModule.forRoot/forRootAsync` combines the shared providers, `{ provide: AUDIT_LOG_STORAGE, useClass: MikroOrmAuditLogStorage }`, `AuditRecorder` and the subscriber.
  - It imports `MikroOrmModule.forFeature([MikroOrmAuditLogSchema])`, which auto-registers the schema when the app uses `autoLoadEntities`.
  - The application must call `MikroOrmModule.forRoot(config)` with an explicit config, which v7 requires.
- **Startup check.** In `onModuleInit`, the storage checks that the `AuditLog` metadata exists. If it does not, it throws an error naming `MikroOrmAuditLogSchema`.
- **Storage.**
  - Each call runs on `orm.em.fork()`, so it works outside `RequestContext`.
  - Queries use `find` with `$gte`/`$lte` on `createdAt`, `orderBy: { createdAt: "desc" }`, `limit` and `offset`.
  - `save` uses `fork.insert(...)` with the same row shape as capture, then returns that row. That gives one write path, and v7 removed `persistAndFlush`.
- **User entities.** `@Auditable()` decorates a class, so MikroORM users must define auditable entities as classes: `@mikro-orm/decorators` classes, or a `defineEntity` schema with a `setClass` class. Plain class-less schemas cannot be marked. The README says so.

### D7. TypeORM schema and storage
- `TypeOrmAuditLogEntity` keeps the current columns and indexes. The `simple-json` columns stay, so SQLite storage is unchanged.
- `TypeOrmAuditLogStorage` holds the repository and query-builder code moved out of the old service.

### D8. Versions and peers: MikroORM v7
- Optional peers:
  - `@mikro-orm/core ^7.0.0`
  - `@mikro-orm/nestjs` in the v7-compatible range found in task 1.2
  - `typeorm ^0.3.0`
  - `@nestjs/typeorm ^11.0.0`
- Required peers: `@nestjs/common` and `@nestjs/core` at `^11.0.0`, plus `reflect-metadata`. `@nestjs/event-emitter` stays an optional peer.
  - Dropping NestJS 10 removes a combination nobody needs. Task 1.2 confirms that `@mikro-orm/nestjs` for v7 accepts Nest 11 (A2) and narrows the range if not.
- Dev dependencies: `@mikro-orm/core`, `@mikro-orm/nestjs` and `@mikro-orm/libsql` on the 7.x line.
- `@mikro-orm/libsql` is not a peer. The adapter never imports a driver.
- **Task 1.2 results (checked 2026-11-26 with `pnpm view`):**
  - `@mikro-orm/core@7`: latest `7.2.12` (published 2026-11-25), `type: module`, engines `node >= 22.17.0`.
  - `@mikro-orm/libsql@7`: latest `7.2.12`, engines `node >= 22.17.0`, depends on `@mikro-orm/sql@7.2.12`, `kysely@0.29.9`, `libsql@0.5.29`. The v7 driver exists.
  - `@mikro-orm/nestjs`: dist-tags `latest: 7.1.0`, `next: 7.1.1-dev.8`. Chosen: **`7.1.0`** (range `^7.1.0`), the newest stable 7.x release (2026-08-31). Its peers are `@nestjs/common` and `@nestjs/core` `^11.0.5 || ^12.0.0`, `@mikro-orm/core` `^7.0.0 || ^7.0.0-dev.0` and `reflect-metadata` `^0.1.0 || ^0.2.0`. Engines `node >= 22.17.0`, ESM (`type: module`).
  - **A2 holds:** it accepts NestJS 11 (installed `@nestjs/common`/`core` 11.1.18, above the `11.0.5` floor) and MikroORM 7.x, and its engines allow Node 26. The required NestJS peer stays `^11.0.0`; consumers on `11.0.0`–`11.0.4` would get a peer warning from `@mikro-orm/nestjs` only when they use the MikroORM adapter.
  - **A4 (exports part) holds:** `typeorm@0.3.28` (installed; latest 0.3.x is `0.3.31`) has `exports["."].node.import: "./index.mjs"`, an ESM entry. Named-import behaviour under ESM is still verified by task 6.3. `@nestjs/typeorm` 11 (installed `11.0.1`) stays CommonJS.
  - Dev dependency ranges written by `pnpm add -D` (task 1.4): `@mikro-orm/core ^7`, `@mikro-orm/libsql ^7`, `@mikro-orm/nestjs ^7.1.0`; the lockfile resolves `7.2.12`, `7.2.12` and `7.1.0`. The optional peer range for `@mikro-orm/nestjs` in task 6.1 is `^7.1.0`.
- **Node lines, checked 2026-11-26 against `nodejs/Release` `schedule.json` and `nodejs.org/dist/index.json`.**
  - **Supported:** Node 26 "Lithium". It is the Active LTS (LTS since 2026-10-28; latest `v26.13.1`, 2026-11-10), and it is also the newest stable major.
  - **Not supported:**
    - Node 27 exists only as `27.0.0-alpha` builds. Its first release is scheduled for 2027-04-22, so there is no stable "Current" line to add.
    - Node 24 "Krypton" is in Maintenance LTS (since 2026-10-20, until 2028-04-30). The user chose Node 26 only (OQ5 closed), so it is not supported.
    - Node 20 and 22 are dropped.
  - **Settings:** `engines.node: ">=26.0.0"`. CI matrix `["26"]`. `release.yml` uses `"26"`. MikroORM v7's 22.17 floor is satisfied.
  - **When Node 27 ships (2027-04):** add it to the matrix. This is a one-line change outside this proposal.

### D9. libSQL and Turso usage and testing
- Documented config:

  ```ts
  MikroOrmModule.forRoot(defineConfig({
    dbName: process.env.LIBSQL_URL,      // "libsql://…" | file path | ":memory:"
    password: process.env.LIBSQL_AUTH_TOKEN,
    entities: [MikroOrmAuditLogSchema /* , … */],
  }))
  ```

  `defineConfig` comes from `@mikro-orm/libsql`. Embedded replicas add `driverOptions: { syncUrl, syncPeriod }`.
- Tests use `dbName: ":memory:"` with `await orm.schema.create()` (the v7 name).
- A file-database test uses a temporary directory and reopens the ORM.
- There is no Turso integration test: no env-gated test and no CI credentials (OQ4 closed). Remote Turso is covered by the README config above and by spec text. One network-free check remains: a typecheck fixture (`test/fixtures/turso-config.ts`) that compiles the README's Turso configuration against the published types.
- **Alternative: an env-gated Turso test.** Rejected by the user. It would need secrets, and in CI it would always be skipped or flaky.

### D10. Behaviour-parity suite (acceptance gate)
- `test/parity/core-scenarios.ts` exports `runCoreScenarios(harness)`. It contains one test per scenario of `specs/audit-log-core`, built from the current subscriber, service and mixin tests.
- An `AdapterHarness` provides:
  - `bootstrap(options)`, which returns a Nest testing module with the adapter's module
  - `defineAuditableFixtures()`, the parity entities: User, an item with `except`, an article with `only`, an entity limited to create/delete events, and a non-auditable post
  - `insert`, `update` and `remove` helpers
  - `listAuditRows()`
  - `close()`
- `test/parity/typeorm.parity.spec.ts` and `test/parity/mikro-orm.parity.spec.ts` each call `runCoreScenarios`, with expected records that do not depend on the adapter.
- **Alternative: duplicate the suites per adapter.** They would drift. Rejected.

### D11. Bun compatibility: partial runtime support, gated by a required CI job
Bun is a compatibility target, not a primary runtime, and it does not shape the design.

**Evidence for each component** (checked 2026-11-26):

| Component | On Bun | Evidence |
|---|---|---|
| NestJS (built JS) | Works | Bun v1.0.3 added `emitDecoratorMetadata` support and says NestJS works with Bun. |
| `reflect-metadata` / `design:type` | Not a concern for `dist` | `dist` is compiled by `tsc`, which already emits the `design:*` metadata calls, so Bun only runs JS. The Bun transpiler matters only for TS run directly, such as user entities; Bun has supported `emitDecoratorMetadata` since 1.0.3. Our `src/` uses explicit `@Inject` (D4), so it does not rely on metadata for DI. |
| MikroORM v7 core | Expected to work | The v7 docs give `bun add …` install lines and a Bun path (`bun:sqlite` through `kysely-bun-sqlite` with the generic `SqliteDriver`). |
| `@mikro-orm/libsql` | Expected to work | It is built on the `libsql` package (JSR `@mikro-orm/libsql@7.1.7`), whose README says it "Supports Bun, Deno, and Node". |
| `bun:sqlite` | Available, not used by us | It is reachable through MikroORM's `SqliteDriver` + `kysely-bun-sqlite`. That is the application's driver choice, so the adapter needs no code for it. |
| TypeORM + `better-sqlite3` | Not supported | `better-sqlite3`'s native addon is unreliable on Bun (oven-sh/bun#4290, cited by nuxt/content#3741 and others). TypeORM 0.3 has no libSQL or `bun:sqlite` driver. TypeORM with pure-JS network drivers such as `pg` is plausible but untested. |
| ESM-only package (D0) | Works | Bun runs ESM natively and resolves `exports` maps. |
| `AsyncLocalStorage` (for apps' actor resolvers, for example nestjs-cls) | Partial | Bun's Node-compat page marks `async_hooks` 🟡. The context does not propagate into `Worker`/`MessagePort` events. That affects apps, not this library. |
| Dev toolchain (Vitest + `better-sqlite3` + pnpm) | Not supported | The TypeORM tests need `better-sqlite3`. Vitest under Bun is not a goal. The toolchain stays on Node. |

**Verdict: partial.**
- **Supported:** consuming the built package on Bun with the core plus the MikroORM adapter on libSQL. A CI smoke test verifies it.
- **Not supported:** the TypeORM adapter on SQLite drivers. Other TypeORM drivers on Bun are untested and not claimed.
- **Not supported:** running the dev toolchain on Bun.

**Smoke test.**
- `scripts/bun-smoke.mjs` is plain JS, so Bun's TypeScript transpiler is not involved. It applies the decorator by hand (`Auditable()(User)`), and `User` comes from a `defineEntity(...).setClass` schema.
- It imports `@nestbolt/audit-log` and `@nestbolt/audit-log/mikro-orm` from the built `dist` (package self-reference).
- It boots a Nest app with `MikroOrmModule.forRoot(defineConfig({ dbName: ":memory:", ... }))` and `MikroOrmAuditLogModule.forRoot({})`, then runs `orm.schema.create()`.
- It persists, updates and removes a `User`, and asserts three records with actions `created`, `updated` and `deleted` through `AuditLogService.getAuditLogs`.
- It imports `@nestbolt/audit-log/typeorm` for module loading only, with no database.
- It exits non-zero on any failure.
- **CI job `bun-smoke`:** `actions/setup-node` (`"26"`) and pnpm for `pnpm install --frozen-lockfile && pnpm run build`, then `oven-sh/setup-bun@v2` (`bun-version: latest`) and `bun --version && bun scripts/bun-smoke.mjs`.
- The job is **required**: a failing Bun smoke run fails the PR. Documented fallback, used only for a confirmed upstream Bun or `libsql` regression: set `continue-on-error: true` on that job, record the blocker and the upstream issue in the README, and downgrade the README's Bun status from "supported" to "best-effort" until it is fixed.

**Alternatives:**
- **Run the full Vitest suite on Bun.** It is blocked by `better-sqlite3`, and it would make Bun a primary runtime. Rejected.
- **Add a `bun:sqlite` path to the TypeORM adapter.** TypeORM has no such driver, and adding one is out of scope. Rejected.
- **Declare Bun unsupported.** The evidence supports the MikroORM path, and verifying it costs one CI job. Rejected.

## Risks / Trade-offs

- **[A1 fails on v7]** → Task 2.1 spikes it first. If it fails, switch to the D5 `onFlush` fallback and document the autoincrement limitation.
- **[`originalEntity` encodes Date, JSON or custom types differently from the live entity, which creates spurious diffs]** → Parity tests cover Date and JSON properties. Normalise both sides through the property type before diffing.
- **[A3: composite keys joined with `:` is a new convention]** → Unit-test it in both adapters and document it.
- **[A4: `typeorm`/`@nestjs/typeorm` named imports fail under ESM]** → The 6.3 smoke check imports them. If it fails, use a default import plus destructuring in the TypeORM adapter.
- **[Vitest's transformer lacks `emitDecoratorMetadata`, breaking DI by type]** → Every constructor injection in `src/` uses an explicit `@Inject(token)` (D4), so tests never depend on paramtypes.
- **[CommonJS consumer apps on older TypeScript resolution]** → This is out of scope by decision. The README states the Node 26 / `nodenext` requirements.
- **[A libSQL native binary is missing on a CI platform]** → ubuntu-latest x64 has prebuilt binaries.
- **[`createdAt` ties within one millisecond make the DESC order ambiguous]** → The parity suite spaces its inserts, as the current tests do.
- **[The mixin's static lookup breaks when two modules run in one process]** → Non-goal, documented.
- **[A Bun or `libsql` regression breaks `bun-smoke`]** → D11 fallback: make the job non-blocking, record the blocker, and downgrade the README's Bun status to best-effort until the fix lands.
- **[Node 26-only engines exclude Node 24 Maintenance LTS users]** → Accepted by the user's decision (D8).

## Rollout

- Release as `0.2.0`, a breaking minor in 0.x. There is no migration guide, because there are no consumers. The CHANGELOG lists the new API.
- Rollback means pinning `0.1.0`. No data migration is needed.

## Open Questions

None. All are resolved:
- **OQ1, packaging:** one package with subpath exports (D1).
- **OQ2, MikroORM version:** v7 (D0, D8).
- **OQ3, compatibility and version:** no compatibility, the root exports only the core, released as `0.2.0`.
- **OQ4, Turso test:** none. Testing is libSQL `:memory:` plus a local file only, and Turso is documented (D9).
- **OQ5, Node lines:** Node 26 only (D8).

The remaining unknowns are assumptions that specific tasks verify:
- A1: hooks write inside the flush transaction (task 2.1)
- A2: `@mikro-orm/nestjs` v7 accepts NestJS 11 and Node 26 (task 1.2)
- A3: composite keys are joined with `:` (task 3.4)
- A4: TypeORM named imports work under ESM (tasks 1.2 and 6.3)
