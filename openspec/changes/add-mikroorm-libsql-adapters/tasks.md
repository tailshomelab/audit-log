# Tasks

> All open questions are closed (design.md, Open Questions). Decisions:
> - One package with subpath exports, and a root entry point that exports only the core.
> - No backward compatibility.
> - MikroORM v7, with the package ESM-only.
> - Node 26 only.
> - No Turso integration test.
> - Bun: partial support, gated by the required `bun-smoke` CI job, with the D11 fallback.
>
> Remaining assumptions A1–A4 are verified in tasks 1.2, 2.1, 3.4 and 6.3.
>
> Gate commands come from `package.json`: `pnpm run build` (tsc, which is also the only typecheck of `src/`), `pnpm run lint`, `pnpm test` (vitest run) and `pnpm run test:cov`. Phase 6 adds `pnpm run test:exports` and `bun scripts/bun-smoke.mjs`.

## 1. Setup, toolchain and dependencies

- [x] 1.1 On Node 26, run `pnpm install --frozen-lockfile && pnpm run build && pnpm test` on the unchanged code. Record the passing test count and the list of `it` names. They are the behaviour reference the phase 4 parity suite must cover, not an assertion freeze. Verify: the run passes, and the names are saved in the PR description.
  - **Deviation:** run on local Node 22.23.5, not Node 26, which was not installed locally. That is above MikroORM v7's 22.17 floor. CI and `engines` stay on Node 26, and task 7.1 repeats the full gates on Node 26.
- [x] 1.2 Check assumption A2 and pin versions:
  - Run `pnpm view @mikro-orm/core@7 version`, `pnpm view @mikro-orm/libsql@7 version` and `pnpm view @mikro-orm/nestjs dist-tags versions`. Pick the `@mikro-orm/nestjs` release that matches 7.x.
  - Run `pnpm view @mikro-orm/nestjs@<that> peerDependencies engines`.
  - Run `pnpm view typeorm@0.3 exports` to check A4, that `typeorm` has an ESM entry.

  Record the results in design.md D8. Verify: the chosen `@mikro-orm/nestjs` accepts `@nestjs/common` `^11` and `@mikro-orm/core` 7.x, and its engines allow Node 26. If not, stop and escalate.
- [x] 1.3 Convert the package to ESM (D0):
  - `package.json`: `"type": "module"`, `engines.node: ">=26.0.0"`, remove `main`/`types`, remove `uuid` and `@types/uuid`.
  - `tsconfig.json`: `module`/`moduleResolution: "nodenext"`, `target: "ES2022"`, drop `baseUrl`.
  - Add `.js` extensions to every relative import in `src/` and `test/`.

  Verify: `pnpm run build && pnpm test` passes at the 1.1 count, and `node -e "import('./dist/index.js')"` loads.
- [x] 1.4 Add dev dependencies `@mikro-orm/core@^7`, `@mikro-orm/libsql@^7` and the 1.2 `@mikro-orm/nestjs` with `pnpm add -D`. Verify: `pnpm install --frozen-lockfile` succeeds on the updated lockfile, and `pnpm test` still passes.
- [x] 1.5 Update `.github/workflows/tests.yml` (matrix `node-version: ["26"]`) and `.github/workflows/release.yml` (`node-version: "26"`). Verify: `grep -n "node-version" .github/workflows/*.yml` shows only `26`.

## 2. MikroORM v7 transaction spike (assumption A1)

- [x] 2.1 Create `test/mikro-orm/transaction-spike.spec.ts`. It sets up a standalone `EventSubscriber` whose `afterCreate` calls `args.em.insert()` on a probe table. It runs on `@mikro-orm/libsql` `:memory:` with `await orm.schema.create()`, using `defineEntity` probe entities and no decorators. Cover three cases:
  - (a) A plain `em.persist(x).flush()` writes the probe row.
  - (b) `em.transactional(async em => { em.persist(x); await em.flush(); throw … })` leaves neither row.
  - (c) An autoincrement PK is set in `afterCreate`.

  Verify: `pnpm vitest run test/mikro-orm/transaction-spike.spec.ts` passes. If (b) fails, switch design.md D5 to the `onFlush` fallback before phase 5. Record the outcome in D5 either way.
- [x] 2.2 Delete the spike once 5.3 covers the same cases. Verify: `test/mikro-orm/transaction-spike.spec.ts` no longer exists after 5.3.

## 3. Core (no ORM imports)

- [x] 3.1 Move `src/utils`, `src/decorators`, `src/mixins`, `src/events`, `src/exceptions`, `src/interfaces` and `src/audit-log.constants.ts` under `src/core/` with `git mv`. Delete `src/interfaces/audit-context.interface.ts` and its export. Give `AuditLogNotInitializedException` a message that names no module. Verify: `pnpm run build` passes.
- [x] 3.2 Add the core contracts and tokens:
  - `src/core/interfaces/audit-log-record.interface.ts` (`AuditLogRecord`, `AuditLogDraft`)
  - `src/core/interfaces/audit-log-storage.interface.ts` (`AuditLogStorage`)
  - `AUDIT_LOG_STORAGE` and `AUDIT_LOG_ACTOR_RESOLVER` (Symbols) in `src/core/audit-log.constants.ts`

  Switch `AuditLoggedEvent` and `AuditableMixinEntity` to `AuditLogRecord`. Verify: `pnpm run build` passes.
- [x] 3.3 Move the service to `src/core/audit-log.service.ts`:
  - Use explicit `@Inject` for options, storage, the optional resolver and the optional `"EventEmitter2"`.
  - Delegate to storage.
  - Add `notifyLogged`.
  - Keep `getInstance()` only for the mixin.

  Add `test/core/audit-log.service.spec.ts` with an in-memory fake storage, covering delegation, emitter present/absent, actor and metadata precedence, and the mixin lookup lifecycle. Verify: `pnpm vitest run test/core` passes.
- [x] 3.4 Implement `src/core/audit-recorder.ts`, an injectable that implements D4 with one shared `ALWAYS_EXCLUDED` list from `src/core/utils/diff.ts`. Add `test/core/audit-recorder.spec.ts` covering only/except/global exclusions, entity `events`, `disabledActions`, the no-change update and composite-PK joining (A3). Verify: `pnpm vitest run test/core` passes.
- [x] 3.5 Add `src/core/audit-log-providers.ts`, which builds the `forRoot`/`forRootAsync` providers (options, resolver via `useClass`/`moduleRef.create`, service, recorder) from an adapter's storage and subscriber. Point `src/index.ts` at the core surface. Move `test/diff.spec.ts` and `test/auditable.decorator.spec.ts` to `test/core/`. Verify: `grep -rE "from \"(typeorm|@nestjs/typeorm|@mikro-orm/[a-z-]+)\"" src/core src/index.ts` returns nothing, and `pnpm vitest run test/core` passes.

## 4. TypeORM adapter and the parity suite

- [x] 4.1 Create `src/typeorm/typeorm-audit-log.entity.ts` (moved, renamed `TypeOrmAuditLogEntity`, `implements AuditLogRecord`) and `src/typeorm/typeorm-audit-log.storage.ts` (the query code from the old service). Delete `src/entities/`. Verify: `pnpm run build` passes.
- [x] 4.2 Create `src/typeorm/typeorm-audit.subscriber.ts`, an internal subscriber that implements D4:
  - explicit `@Inject(DataSource)` and `@Inject(AuditRecorder)`
  - snapshots of mapped columns only
  - the id taken from PK metadata
  - writes through `event.manager` inside a try/catch whose catch block documents the skip

  Delete `src/audit-log.subscriber.ts`. Verify: `pnpm run build` passes.
- [x] 4.3 Create `src/typeorm/typeorm-audit-log.module.ts` (`TypeOrmAuditLogModule.forRoot`/`forRootAsync` via 3.5, plus `TypeOrmModule.forFeature([TypeOrmAuditLogEntity])`) and `src/typeorm/index.ts`, which exports only the module, entity and storage. Delete `src/audit-log.module.ts` and `src/audit-log.service.ts`. Verify: `pnpm run build` passes.
- [x] 4.4 Create `test/parity/harness.ts` (the `AdapterHarness` type and parity fixtures) and `test/parity/core-scenarios.ts` (`runCoreScenarios`, one test per `specs/audit-log-core` scenario, covering every 1.1 behaviour). Add `test/parity/typeorm.parity.spec.ts` with a TypeORM `better-sqlite3` `:memory:` harness. Verify: `pnpm vitest run test/parity/typeorm.parity.spec.ts` passes, and every core scenario name appears in the output.
- [x] 4.5 Create `test/typeorm/` with adapter-only specs:
  - module registration, sync and async
  - table mapping via `PRAGMA table_info`
  - mapped-column-only snapshot
  - bulk `update()`/`delete()` not captured
  - rollback in a `dataSource.transaction` leaving no record
  - failure isolation when the audit table is missing

  Delete the old top-level `test/*.spec.ts` files whose behaviours are now covered by 4.4 or 4.5. Verify: `pnpm test` passes, and every 1.1 `it` name maps to a parity or adapter test (checklist in the PR description).

## 5. MikroORM v7 adapter with libSQL

- [x] 5.1 Implement `src/mikro-orm/mikro-orm-audit-log.schema.ts` (`MikroOrmAuditLogSchema` via `defineEntity`, falling back to `EntitySchema`, as in D6). Add `test/mikro-orm/audit-log.schema.spec.ts`, which runs on libSQL `:memory:` after `orm.schema.create()` and compares `PRAGMA table_info(audit_logs)` and the indexed column sets with the TypeORM entity's column list. Verify: `pnpm vitest run test/mikro-orm/audit-log.schema.spec.ts` passes.
- [x] 5.2 Implement `src/mikro-orm/mikro-orm-audit-log.storage.ts`:
  - a fork per call
  - `fork.insert` for `save`
  - `find` with `$gte`/`$lte`, `orderBy` and `limit`/`offset`
  - an `onModuleInit` check that the metadata is registered

  Verify: tests run under 5.4 and 5.5.
- [x] 5.3 Implement `src/mikro-orm/mikro-orm-audit.subscriber.ts` following the approach chosen in 2.1: hooks with `args.em.insert`, or the `onFlush` fallback. Include `toSnapshot` and the serialized PK. Add `test/mikro-orm/audit-subscriber.spec.ts` for adapter-only behaviour:
  - several entities in one flush
  - no audit-of-audit
  - `nativeUpdate`/`nativeDelete`/`insert` not captured
  - rollback in `em.transactional` leaving no record
  - Date and JSON property updates with no spurious diff
  - an autoincrement-PK `created` record carrying its id

  Test entities use `defineEntity` + `setClass` with `@Auditable()` on the class. Verify: `pnpm vitest run test/mikro-orm/audit-subscriber.spec.ts` passes.
- [x] 5.4 Implement `src/mikro-orm/mikro-orm-audit-log.module.ts` (`MikroOrmAuditLogModule.forRoot`/`forRootAsync` via 3.5, plus `MikroOrmModule.forFeature([MikroOrmAuditLogSchema])`) and `src/mikro-orm/index.ts`, which exports only the module, schema and storage. Add:
  - `test/mikro-orm/audit-log.module.spec.ts`: sync and async registration, the missing-schema startup error, and a query outside `RequestContext`
  - `test/parity/mikro-orm.parity.spec.ts`: a libSQL `:memory:` harness for `runCoreScenarios`

  Verify: `pnpm vitest run test/mikro-orm test/parity` passes, and both parity specs report the same scenario names.
- [x] 5.5 Add `test/mikro-orm/libsql.spec.ts` for a local file database in `fs.mkdtempSync(path.join(os.tmpdir(), "audit-"))`: write, `orm.close()`, reopen, and read back with the JSON fields intact. Remove the directory in `afterAll`. Also add `test/fixtures/turso-config.ts`, containing the README's Turso config (`dbName: "libsql://example.turso.io"`, `password: "token"`, `MikroOrmAuditLogSchema` in `entities`, `MikroOrmAuditLogModule.forRoot({})`), which is type-checked only and never run. Verify: `pnpm vitest run test/mikro-orm/libsql.spec.ts` passes, `pnpm exec tsc --noEmit -p tsconfig.fixtures.json` exits 0 (a new file that extends `tsconfig.json` and includes only `test/fixtures/**`), and `grep -rn "LIBSQL_AUTH_TOKEN\|turso" .github/` returns nothing.
- [x] 5.6 Write the MikroORM section of `README.md`:
  - installation (`@mikro-orm/core`, `@mikro-orm/nestjs` and a driver)
  - `MikroOrmModule.forRoot(config)` with an explicit config, as v7 requires
  - registering `MikroOrmAuditLogSchema`
  - auditable entities as classes (decorators or `defineEntity` + `setClass`)
  - libSQL `:memory:`, file and Turso config (`dbName` + `password`, optionally `driverOptions.syncUrl`)
  - capture limits

  Verify: every code block uses only symbols exported from `src/mikro-orm/index.ts` or `src/index.ts`, checked against the 5.4 test setup.

## 6. Packaging, Bun smoke test and docs

- [x] 6.1 Update `package.json`:
  - an `exports` map for `.`, `./typeorm`, `./mikro-orm` and `./package.json`, each with `types` + `default`
  - required peers: `@nestjs/common` and `@nestjs/core` at `^11`, plus `reflect-metadata`
  - optional peers: `@nestjs/event-emitter`, `typeorm ^0.3`, `@nestjs/typeorm ^11`, `@mikro-orm/core ^7` and the 1.2 `@mikro-orm/nestjs` range
  - `description` and `keywords` updated

  Verify: `pnpm run build` emits `dist/{index,typeorm/index,mikro-orm/index}.{js,d.ts}`.
- [x] 6.2 Update the coverage excludes in `vitest.config.ts` to `src/**/index.ts` and `src/core/interfaces/**`. Verify: `pnpm run test:cov` runs, and the report lists no index or interface files.
- [x] 6.3 Add `scripts/smoke-exports.mjs`, `scripts/block-packages.mjs` (a `module.register` resolve hook that rejects the listed specifiers) and a `test:exports` script. The script:
  - (a) imports `.` with `typeorm`, `@nestjs/typeorm` and `@mikro-orm/*` all blocked
  - (b) imports `./typeorm` with `@mikro-orm/*` blocked, and touches every TypeORM named import (A4)
  - (c) imports `./mikro-orm` with `typeorm` and `@nestjs/typeorm` blocked
  - (d) runs `node -e "require('@nestbolt/audit-log')"` to prove that CommonJS consumers can load the package through `require(esm)`

  Verify: `pnpm run build && pnpm run test:exports` exits 0.
- [x] 6.4 Add `scripts/bun-smoke.mjs` as specified in design.md D11: plain JS, the built `dist`, MikroORM on libSQL `:memory:`, create, update and remove, three records asserted, and `/typeorm` imported for loading only. Add a `bun-smoke` job to `.github/workflows/tests.yml` with these steps:
  - `actions/setup-node` with `"26"`
  - pnpm setup
  - `pnpm install --frozen-lockfile && pnpm run build`
  - `oven-sh/setup-bun@v2` with `bun-version: latest`
  - `bun --version && bun scripts/bun-smoke.mjs`

  Verify: locally `pnpm run build && bun scripts/bun-smoke.mjs` exits 0, and the job passes on the PR. If an upstream Bun or `libsql` blocker fails it, apply the D11 fallback and record the blocker.
  Verified in CI on PR #2 (https://github.com/tailshomelab/audit-log/pull/2), commit bd61f52: `test` (Node 26) and `bun-smoke` passed.
- [x] 6.5 Rewrite the top of `README.md` and its TypeORM section:
  - import paths (core from root, adapters from subpaths)
  - `TypeOrmAuditLogModule` and `TypeOrmAuditLogEntity`
  - the requirements: Node 26+, ESM, and `moduleResolution` `nodenext`/`node16`/`bundler` for CommonJS consumers through `require(esm)`
  - a Bun support section: supported for core + MikroORM/libSQL; not supported for the TypeORM adapter or the dev toolchain

  Add a `v0.2.0` entry to `CHANGELOG.md` listing the API redesign, MikroORM v7, ESM-only, Node 26, Bun status and the removed symbols. Verify: CHANGELOG covers every item under proposal.md "What Changes".

## 7. Integration checks

- [x] 7.1 On Node 26, run the full gates once: `pnpm run lint && pnpm run build && pnpm test && pnpm run test:exports && bun scripts/bun-smoke.mjs`. Verify: all exit 0, and both parity specs pass with identical scenario lists.
  Verified in CI on PR #2 (https://github.com/tailshomelab/audit-log/pull/2), commit bd61f52: `test` (Node 26) and `bun-smoke` passed.
- [x] 7.2 Run `pnpm pack --dry-run`. Verify: the tarball contains `dist/index.js`, `dist/typeorm/` and `dist/mikro-orm/`, and no `test/` or `scripts/` files.
- [x] 7.3 Run `openspec validate add-mikroorm-libsql-adapters --strict`. Verify: it reports valid, and each spec scenario maps to a test from phases 3 to 6.

## Workflow follow-up

- Get the change reviewed. After merge and release, archive it with the OpenSpec archive workflow.
- Node 27 is scheduled for 2027-04-22. Supporting it is a separate decision, because the user chose Node 26 only.
