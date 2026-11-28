<p align="center">
    <h1 align="center">@nestbolt/audit-log</h1>
    <p align="center">Automatic entity change tracking and audit logging for NestJS, with TypeORM and MikroORM adapters.</p>
</p>

<p align="center">
    <a href="https://www.npmjs.com/package/@nestbolt/audit-log"><img src="https://img.shields.io/npm/v/@nestbolt/audit-log.svg?style=flat-square" alt="npm version"></a>
    <a href="https://www.npmjs.com/package/@nestbolt/audit-log"><img src="https://img.shields.io/npm/dt/@nestbolt/audit-log.svg?style=flat-square" alt="npm downloads"></a>
    <a href="https://github.com/nestbolt/audit-log/actions"><img src="https://img.shields.io/github/actions/workflow/status/nestbolt/audit-log/tests.yml?branch=main&style=flat-square&label=tests" alt="tests"></a>
    <a href="https://opensource.org/licenses/MIT"><img src="https://img.shields.io/badge/license-MIT-brightgreen.svg?style=flat-square" alt="license"></a>
</p>

<hr>

This package provides an **audit logging system** for [NestJS](https://nestjs.com). It automatically tracks insert, update and delete operations on your entities, with old/new value diffs, actor tracking and configurable field filtering.

The package is an ORM-free **core** plus one **adapter** per ORM:

| Import path                     | Contents                                                                                        | Needs                                  |
| ------------------------------- | ----------------------------------------------------------------------------------------------- | -------------------------------------- |
| `@nestbolt/audit-log`           | Core: `@Auditable()`, `AuditableMixin`, `AuditLogService`, events, tokens, types, `computeDiff` | No ORM                                 |
| `@nestbolt/audit-log/typeorm`   | `TypeOrmAuditLogModule`, `TypeOrmAuditLogEntity`, `TypeOrmAuditLogStorage`                      | `typeorm`, `@nestjs/typeorm`           |
| `@nestbolt/audit-log/mikro-orm` | `MikroOrmAuditLogModule`, `MikroOrmAuditLogSchema`, `MikroOrmAuditLogStorage`                   | `@mikro-orm/core`, `@mikro-orm/nestjs` |

Each symbol has exactly one import path: the adapter entry points do not re-export the core. The root entry point imports no ORM package, and each adapter imports only its own ORM.

```typescript
import { Auditable, AuditableMixin, AuditLogService } from "@nestbolt/audit-log";
import { TypeOrmAuditLogModule } from "@nestbolt/audit-log/typeorm";

@Entity("users")
@Auditable({ except: ["password"] })
export class User extends AuditableMixin(BaseEntity) {
  @PrimaryGeneratedColumn("uuid") id!: string;
  @Column() name!: string;
  @Column() password!: string;
}

// Changes are tracked automatically via .save() and .remove()
const logs = await auditLogService.getAuditLogs("User", userId);
```

## Table of Contents

- [Requirements](#requirements)
- [Installation](#installation)
- [TypeORM](#typeorm)
- [MikroORM](#mikroorm)
- [Module Configuration](#module-configuration)
- [Using the @Auditable() Decorator](#using-the-auditable-decorator)
- [Actor Resolution](#actor-resolution)
- [Manual Logging](#manual-logging)
- [Query API](#query-api)
- [Entity Mixin](#entity-mixin)
- [Events](#events)
- [Using the Service Directly](#using-the-service-directly)
- [Configuration Options](#configuration-options)
- [Audit Log Table](#audit-log-table)
- [Standalone Usage](#standalone-usage)
- [Bun](#bun)
- [Testing](#testing)
- [Changelog](#changelog)
- [Contributing](#contributing)
- [Security](#security)
- [License](#license)

## Requirements

- **Node.js 26 or newer** (`engines.node: ">=26.0.0"`). Node 26 is the only supported line.
- **NestJS 11** (`@nestjs/common` and `@nestjs/core` `^11`) and `reflect-metadata`.
- **ESM.** The package is ESM-only (`"type": "module"`) and is resolved through its `exports` map; there is no `main` field.
  - ESM applications import it directly.
  - **CommonJS applications** (most NestJS apps) load it through Node's `require(esm)`, which works on every supported Node line. For the types, set TypeScript `moduleResolution` to `nodenext`, `node16` or `bundler` (MikroORM v7 requires this too). The legacy `node`/`node10` resolution cannot see the subpath exports.

## Installation

Install the core and the adapter for your ORM:

```bash
# TypeORM
pnpm add @nestbolt/audit-log typeorm @nestjs/typeorm

# MikroORM v7 (pick any SQL driver; libSQL shown)
pnpm add @nestbolt/audit-log @mikro-orm/core @mikro-orm/nestjs @mikro-orm/libsql
```

`npm install` and `yarn add` work the same way.

### Peer Dependencies

```
@nestjs/common          ^11.0.0             required
@nestjs/core            ^11.0.0             required
reflect-metadata        ^0.1.13 || ^0.2.0   required
typeorm                 ^0.3.0              optional (TypeORM adapter)
@nestjs/typeorm         ^11.0.0             optional (TypeORM adapter)
@mikro-orm/core         ^7.0.0              optional (MikroORM adapter)
@mikro-orm/nestjs       ^7.1.0              optional (MikroORM adapter)
@nestjs/event-emitter   ^3.0.0              optional (audit.logged events)
```

Every ORM peer is optional: install only the ones for the adapter you use. The MikroORM database driver (`@mikro-orm/libsql`, `@mikro-orm/postgresql`, ...) is your choice and is not a peer.

## TypeORM

The TypeORM adapter lives at `@nestbolt/audit-log/typeorm`. It imports no MikroORM package.

### 1. Register the module in your `AppModule`

Add `TypeOrmAuditLogEntity` to your connection's `entities` (or enable `autoLoadEntities`: `TypeOrmAuditLogModule` registers it with `TypeOrmModule.forFeature`), then import `TypeOrmAuditLogModule`:

```typescript
import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { TypeOrmAuditLogEntity, TypeOrmAuditLogModule } from "@nestbolt/audit-log/typeorm";
import { User } from "./user.entity";

@Module({
  imports: [
    TypeOrmModule.forRoot({
      type: "postgres",
      /* ... */
      entities: [TypeOrmAuditLogEntity, User],
    }),
    TypeOrmAuditLogModule.forRoot({
      globalExcludedFields: ["password", "token"],
    }),
  ],
})
export class AppModule {}
```

`TypeOrmAuditLogModule.forRootAsync({ imports, inject, useFactory })` takes the same options as `forRoot` (see [Module Configuration](#module-configuration)).

### 2. Mark entities as auditable

```typescript
import { BaseEntity, Column, Entity, PrimaryGeneratedColumn } from "typeorm";
import { Auditable, AuditableMixin } from "@nestbolt/audit-log";

@Entity("users")
@Auditable({ except: ["passwordHash"] })
export class User extends AuditableMixin(BaseEntity) {
  @PrimaryGeneratedColumn("uuid") id!: string;
  @Column() name!: string;
  @Column() email!: string;
  @Column() passwordHash!: string;
}
```

### 3. Changes are tracked automatically

```typescript
// Insert: creates an audit log with action "created"
const user = userRepo.create({ name: "Alice", email: "alice@example.com" });
await userRepo.save(user);

// Update: creates an audit log with action "updated" and a field diff
user.name = "Bob";
await userRepo.save(user);
// audit log: oldValues: { name: "Alice" }, newValues: { name: "Bob" }

// Delete: creates an audit log with action "deleted"
await userRepo.remove(user);
```

> **Important:** Only `.save()` and `.remove()` trigger TypeORM subscriber events. `Repository.update()`, `Repository.delete()` and `QueryBuilder` writes do **not** create audit logs.

### What is captured

- Payloads contain the entity's mapped columns only. The entity id comes from the primary-key metadata; composite primary keys are joined with `:` in `entityId`.
- The record is written with the operation's entity manager, so it is part of the same transaction: a rolled-back transaction leaves no record.
- An audit write error is logged and skipped; it never fails the save. On databases that abort the whole transaction after a failed statement, such as PostgreSQL, a failed audit insert can still abort the surrounding transaction (the MikroORM adapter behaves the same way).

### TypeORM under ESM

Your entities are loaded as ES modules. With `emitDecoratorMetadata`, circular relations between entity files can hit temporal-dead-zone errors; wrap relation property types in TypeORM's `Relation<>` type (`author!: Relation<User>`). The audit entity has no relations, so this only concerns your own entities.

## MikroORM

The MikroORM v7 adapter lives at `@nestbolt/audit-log/mikro-orm`. It imports no TypeORM package and no database driver: you pick the driver.

### Installation

```bash
pnpm add @nestbolt/audit-log @mikro-orm/core @mikro-orm/nestjs @mikro-orm/libsql
```

Any MikroORM v7 SQL driver works in place of `@mikro-orm/libsql` (for example `@mikro-orm/postgresql`). MikroORM v7 is ESM-only; see [Requirements](#requirements) for the TypeScript `moduleResolution` settings.

### Registration

MikroORM v7 requires an explicit config in `MikroOrmModule.forRoot(config)`. Add `MikroOrmAuditLogSchema` to its `entities`, or enable `autoLoadEntities`: `MikroOrmAuditLogModule` registers the schema with `MikroOrmModule.forFeature`. If the schema is not registered, startup fails with an error that names `MikroOrmAuditLogSchema`.

```typescript
import { Module } from "@nestjs/common";
import { MikroOrmModule } from "@mikro-orm/nestjs";
import { defineConfig } from "@mikro-orm/libsql";
import { MikroOrmAuditLogModule, MikroOrmAuditLogSchema } from "@nestbolt/audit-log/mikro-orm";
import { UserSchema } from "./user.entity";

@Module({
  imports: [
    MikroOrmModule.forRoot(
      defineConfig({
        dbName: ":memory:",
        entities: [MikroOrmAuditLogSchema, UserSchema],
      }),
    ),
    MikroOrmAuditLogModule.forRoot({
      defaultActor: { type: "System", id: "system" },
    }),
  ],
})
export class AppModule {}
```

`MikroOrmAuditLogModule.forRootAsync({ imports, inject, useFactory })` takes the same options as `forRoot`. `AuditLogService` and every query method work outside a `RequestContext` (startup hooks, background jobs), because the storage uses a fork of the entity manager for each call.

### Auditable entities are classes

`@Auditable()` decorates a class, so auditable MikroORM entities must have one: a class with `@mikro-orm/decorators`, or a `defineEntity` schema with a class attached through `setClass`. A class-less schema cannot be marked.

```typescript
import { defineEntity, p } from "@mikro-orm/core";
import { Auditable } from "@nestbolt/audit-log";

@Auditable({ except: ["password"] })
export class User {
  declare id: number;
  declare name: string;
  declare password: string;
}

export const UserSchema = defineEntity({
  name: "User",
  properties: {
    id: p.integer().primary().autoincrement(),
    name: p.string(),
    password: p.string(),
  },
});
UserSchema.setClass(User);
```

### libSQL and Turso

The adapter has no connection options of its own. The database is whatever `dbName` (and `password`) you give the libSQL driver:

```typescript
import { MikroOrmModule } from "@mikro-orm/nestjs";
import { defineConfig } from "@mikro-orm/libsql";
import { MikroOrmAuditLogSchema } from "@nestbolt/audit-log/mikro-orm";

// In-memory: dbName ":memory:"; local file: dbName "./data/app.db"
MikroOrmModule.forRoot(
  defineConfig({
    dbName: process.env.LIBSQL_URL, // "libsql://<db>.turso.io" for Turso
    password: process.env.LIBSQL_AUTH_TOKEN, // the Turso auth token
    entities: [MikroOrmAuditLogSchema],
    // Embedded replica: a local file kept in sync with the remote database
    // driverOptions: { syncUrl: process.env.LIBSQL_SYNC_URL, syncPeriod: 60 },
  }),
);
```

The test suite runs on libSQL `:memory:` and on a local file. Remote Turso is not live-tested: the configuration above is only type-checked.

### What is captured

- `persist`/`remove` + `flush` of auditable entities, including inside `em.transactional()`. The record is inserted in the flush's transaction, so a rolled-back transaction leaves no record.
- Payloads contain scalar and embedded properties, plus owning to-one relations as the related primary key. Collections and inverse sides are not recorded. Composite primary keys, including a key that is a relation to a composite-key entity, are joined with `:` in `entityId`. `bigint` values are recorded as decimal strings.
- Updates record only the properties the flush wrote. For an entity from `em.getReference()` or a partial load, the previous values are read from the database inside the flush transaction.
- Native operations are not captured: `em.nativeUpdate`, `em.nativeDelete`, `em.insert` and query-builder writes.
- An audit write error is logged and skipped; it never fails the flush. On databases that abort the whole transaction after a failed statement, such as PostgreSQL, a failed audit insert can still abort the surrounding transaction (the TypeORM adapter behaves the same way).

## Module Configuration

Both adapter modules (`TypeOrmAuditLogModule` and `MikroOrmAuditLogModule`) take the same options and are registered globally: import one of them once. The examples below use the TypeORM module; the MikroORM module is identical.

### Static Configuration (forRoot)

```typescript
TypeOrmAuditLogModule.forRoot({
  defaultActor: { type: "System", id: "system" },
  actorResolver: RequestActorResolver,
  disabledActions: ["deleted"],
  globalExcludedFields: ["password", "token", "secret"],
  metadata: { app: "my-app", version: "1.0" },
});
```

### Async Configuration (forRootAsync)

```typescript
TypeOrmAuditLogModule.forRootAsync({
  imports: [ConfigModule],
  inject: [ConfigService],
  useFactory: (config: ConfigService) => ({
    globalExcludedFields: config.get("audit.excludedFields"),
    defaultActor: { type: "System", id: "system" },
  }),
});
```

## Using the @Auditable() Decorator

The `@Auditable()` class decorator (from `@nestbolt/audit-log`) marks an entity for automatic change tracking:

```typescript
@Auditable({
  auditableType: "AppUser",          // Override entity type name (defaults to class name)
  only: ["name", "email", "role"],   // Only track these fields (whitelist)
  except: ["password", "token"],     // Exclude these fields (blacklist)
  events: ["created", "deleted"],    // Only track specific actions (won't track updates)
})
```

| Option          | Type            | Default     | Description                                       |
| --------------- | --------------- | ----------- | ------------------------------------------------- |
| `auditableType` | `string`        | Class name  | Override the entity type name in audit logs       |
| `only`          | `string[]`      | —           | Whitelist of fields to track (overrides `except`) |
| `except`        | `string[]`      | —           | Blacklist of fields to exclude from tracking      |
| `events`        | `AuditAction[]` | All actions | Limit which actions are tracked                   |

## Actor Resolution

Implement the `ActorResolver` interface to track who made changes:

```typescript
import { Injectable } from "@nestjs/common";
import type { ActorResolver, AuditActor } from "@nestbolt/audit-log";
import { ClsService } from "nestjs-cls";

@Injectable()
export class RequestActorResolver implements ActorResolver {
  constructor(private readonly cls: ClsService) {}

  resolve(): AuditActor | null {
    const userId = this.cls.get("userId");
    if (!userId) return null;
    return { type: "User", id: userId };
  }
}
```

Register it in the module:

```typescript
TypeOrmAuditLogModule.forRoot({
  actorResolver: RequestActorResolver,
});
```

The module instantiates the resolver. It is called for both automatic and manual logging (when no explicit actor is provided). If no resolver is configured, the `defaultActor` from options is used. If neither is set, the actor fields are `null`.

## Manual Logging

Use `AuditLogService.log()` for cases not covered by automatic capture:

```typescript
await auditLogService.log({
  action: "updated",
  entityType: "User",
  entityId: userId,
  oldValues: { status: "active" },
  newValues: { status: "banned" },
  actor: { type: "Admin", id: adminId },
  metadata: { reason: "Violation of TOS" },
  ipAddress: "192.168.1.1",
  userAgent: "Mozilla/5.0",
});
```

## Query API

```typescript
// By entity
const logs = await auditLogService.getAuditLogs("User", userId, {
  action: "updated",
  from: new Date("2024-01-01"),
  to: new Date("2024-12-31"),
  limit: 10,
  offset: 0,
});

// By actor
const logs = await auditLogService.getAuditLogsByActor("Admin", adminId);

// Latest entry
const latest = await auditLogService.getLatestAuditLog("User", userId);
```

Results are ordered by `createdAt`, newest first; `from` and `to` are inclusive.

## Entity Mixin

The `AuditableMixin` adds convenience methods directly on your entity:

```typescript
@Entity("users")
@Auditable()
export class User extends AuditableMixin(BaseEntity) {
  // ...
}

// Usage
const logs = await user.getAuditLogs();
const logs = await user.getAuditLogs({ action: "updated", limit: 5 });
const latest = await user.getLatestAuditLog();
```

| Method                   | Returns                           | Description                    |
| ------------------------ | --------------------------------- | ------------------------------ |
| `getAuditLogs(options?)` | `Promise<AuditLogRecord[]>`       | Get audit logs for this entity |
| `getLatestAuditLog()`    | `Promise<AuditLogRecord \| null>` | Get the most recent audit log  |
| `getAuditableType()`     | `string`                          | Get the entity type name       |
| `getAuditableId()`       | `string`                          | Get the entity ID              |

The mixin methods throw `AuditLogNotInitializedException` until an audit module has been initialised.

`getAuditableId()` returns `String(this.id)`. Automatic capture builds `entityId` from the ORM's primary-key metadata instead, joining composite keys with `:`. For an entity whose key is not a single `id` property, override `getAuditableId()` to return the same value:

```typescript
@Auditable()
export class Membership extends AuditableMixin(BaseEntity) {
  tenantId!: string;
  userId!: number;

  getAuditableId(): string {
    return `${this.tenantId}:${this.userId}`;
  }
}
```

## Events

The package emits `audit.logged` after every persisted record, through `@nestjs/event-emitter` (an optional peer). For automatically captured records, the event is emitted only after the transaction that wrote the record commits; a rolled-back transaction emits nothing. To receive events, install it and import `EventEmitterModule.forRoot()` in your application:

```bash
pnpm add @nestjs/event-emitter
```

```typescript
import { EventEmitterModule } from "@nestjs/event-emitter";

@Module({
  imports: [
    EventEmitterModule.forRoot(),
    TypeOrmModule.forRoot({
      /* ... */
    }),
    TypeOrmAuditLogModule.forRoot({}),
  ],
})
export class AppModule {}
```

At startup, `AuditLogService` looks up the application's `EventEmitter2`. If the package is not installed, or `EventEmitterModule` is not imported, no event is emitted and nothing fails.

| Event          | Payload                        | When                           |
| -------------- | ------------------------------ | ------------------------------ |
| `audit.logged` | `{ auditLog: AuditLogRecord }` | After any audit log is created |

```typescript
import { AUDIT_LOG_EVENTS, type AuditLoggedEvent } from "@nestbolt/audit-log";
import { OnEvent } from "@nestjs/event-emitter";

@OnEvent(AUDIT_LOG_EVENTS.LOGGED)
handleAuditLog(event: AuditLoggedEvent) {
  console.log(`${event.auditLog.action} on ${event.auditLog.entityType}`);
}
```

## Using the Service Directly

Inject `AuditLogService` (from `@nestbolt/audit-log`) for manual logging and querying:

```typescript
import { Injectable } from "@nestjs/common";
import { AuditLogService } from "@nestbolt/audit-log";

@Injectable()
export class MyService {
  constructor(private readonly auditLogService: AuditLogService) {}

  async banUser(userId: string, adminId: string) {
    // ... ban logic ...

    await this.auditLogService.log({
      action: "updated",
      entityType: "User",
      entityId: userId,
      oldValues: { status: "active" },
      newValues: { status: "banned" },
      actor: { type: "Admin", id: adminId },
    });
  }
}
```

| Method                                              | Returns                           | Description                     |
| --------------------------------------------------- | --------------------------------- | ------------------------------- |
| `log(params)`                                       | `Promise<AuditLogRecord>`         | Create a manual audit log entry |
| `getAuditLogs(entityType, entityId, options?)`      | `Promise<AuditLogRecord[]>`       | Query logs by entity            |
| `getAuditLogsByActor(actorType, actorId, options?)` | `Promise<AuditLogRecord[]>`       | Query logs by actor             |
| `getLatestAuditLog(entityType, entityId)`           | `Promise<AuditLogRecord \| null>` | Get most recent log for entity  |
| `resolveActor()`                                    | `Promise<AuditActor \| null>`     | Resolve the current actor       |

The service reads and writes through the adapter's `AuditLogStorage` implementation (`TypeOrmAuditLogStorage` or `MikroOrmAuditLogStorage`).

## Configuration Options

| Option                 | Type                           | Default | Description                                                         |
| ---------------------- | ------------------------------ | ------- | ------------------------------------------------------------------- |
| `defaultActor`         | `{ type: string; id: string }` | —       | Default actor when no resolver is configured                        |
| `actorResolver`        | `Type<ActorResolver>`          | —       | Class implementing `ActorResolver` interface                        |
| `disabledActions`      | `AuditAction[]`                | —       | Globally disable specific actions (`created`, `updated`, `deleted`) |
| `globalExcludedFields` | `string[]`                     | —       | Fields excluded from all audit logs                                 |
| `metadata`             | `Record<string, any>`          | —       | Extra metadata added to all audit logs                              |

## Audit Log Table

Both adapters map the same `audit_logs` table (`TypeOrmAuditLogEntity` and `MikroOrmAuditLogSchema`), and records are returned as `AuditLogRecord`:

| Column        | Type         | Description                        |
| ------------- | ------------ | ---------------------------------- |
| `id`          | UUID         | Primary key                        |
| `action`      | varchar(50)  | `created`, `updated`, or `deleted` |
| `entity_type` | varchar(255) | Entity class name                  |
| `entity_id`   | varchar(255) | Entity ID                          |
| `actor_type`  | varchar(255) | Actor type (nullable)              |
| `actor_id`    | varchar(255) | Actor ID (nullable)                |
| `old_values`  | JSON         | Previous field values              |
| `new_values`  | JSON         | New field values                   |
| `metadata`    | JSON         | Extra context                      |
| `ip_address`  | varchar(45)  | Request IP (nullable)              |
| `user_agent`  | varchar(512) | User agent (nullable)              |
| `created_at`  | timestamp    | When the change occurred           |

Fields `id`, `createdAt`, `updatedAt`, `created_at`, and `updated_at` are always excluded from diffs automatically.

## Standalone Usage

You can use the `computeDiff` utility without any module:

```typescript
import { computeDiff } from "@nestbolt/audit-log";

const diff = computeDiff(
  { name: "Alice", email: "alice@example.com" },
  { name: "Bob", email: "alice@example.com" },
);
// diff = { oldValues: { name: "Alice" }, newValues: { name: "Bob" } }
```

## Bun

Bun support is **partial**:

| Use                                                     | Status        |
| ------------------------------------------------------- | ------------- |
| Core + MikroORM adapter on libSQL (`@mikro-orm/libsql`) | Supported     |
| TypeORM adapter                                         | Not supported |
| The package's dev toolchain (Vitest, pnpm scripts)      | Not supported |

- **Supported:** running the built package on Bun with the core and the MikroORM adapter on the libSQL driver. The `bun-smoke` CI job (`scripts/bun-smoke.mjs`) boots a Nest application on Bun with libSQL `:memory:` and checks the `created`, `updated` and `deleted` records on every pull request. MikroORM's `bun:sqlite` path (the generic `SqliteDriver` with `kysely-bun-sqlite`) is a driver choice of your application and needs nothing from this package, but it is not tested here.
- **Not supported:** the TypeORM adapter. `better-sqlite3`'s native addon is unreliable on Bun, and TypeORM 0.3 has no libSQL or `bun:sqlite` driver. The adapter module loads on Bun, but no TypeORM driver is tested or claimed.
- **Not supported:** developing this package on Bun. The test suite needs `better-sqlite3` and runs on Node only.

## Testing

```bash
pnpm test                # unit, adapter and parity suites
pnpm run test:watch      # watch mode
pnpm run test:cov        # coverage report
pnpm run build && pnpm run test:exports        # entry-point checks with ORM packages blocked
pnpm run build && bun scripts/bun-smoke.mjs     # Bun smoke test
```

The shared parity suite (`test/parity/`) runs every core scenario against both adapters.

## Changelog

Please see [CHANGELOG](CHANGELOG.md) for more information on what has changed recently.

## Contributing

Please see [CONTRIBUTING](CONTRIBUTING.md) for details.

## Security

If you discover any security-related issues, please report them via [GitHub Issues](https://github.com/nestbolt/audit-log/issues) with the **security** label instead of using the public issue tracker.

## License

The MIT License (MIT). Please see [License File](LICENSE.md) for more information.
