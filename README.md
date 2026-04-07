<p align="center">
    <h1 align="center">@nestbolt/audit-log</h1>
    <p align="center">Automatic entity change tracking and audit logging for NestJS with TypeORM.</p>
</p>

<p align="center">
    <a href="https://www.npmjs.com/package/@nestbolt/audit-log"><img src="https://img.shields.io/npm/v/@nestbolt/audit-log.svg?style=flat-square" alt="npm version"></a>
    <a href="https://www.npmjs.com/package/@nestbolt/audit-log"><img src="https://img.shields.io/npm/dt/@nestbolt/audit-log.svg?style=flat-square" alt="npm downloads"></a>
    <a href="https://github.com/nestbolt/audit-log/actions"><img src="https://img.shields.io/github/actions/workflow/status/nestbolt/audit-log/tests.yml?branch=main&style=flat-square&label=tests" alt="tests"></a>
    <a href="https://opensource.org/licenses/MIT"><img src="https://img.shields.io/badge/license-MIT-brightgreen.svg?style=flat-square" alt="license"></a>
</p>

<hr>

This package provides an **audit logging system** for [NestJS](https://nestjs.com) that automatically tracks insert, update, and delete operations on your entities with old/new value diffs, actor tracking, and configurable field filtering.

Once installed, using it is as simple as:

```typescript
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

- [Installation](#installation)
- [Quick Start](#quick-start)
- [Module Configuration](#module-configuration)
  - [Static Configuration (forRoot)](#static-configuration-forroot)
  - [Async Configuration (forRootAsync)](#async-configuration-forrootasync)
- [Using the @Auditable() Decorator](#using-the-auditable-decorator)
- [Actor Resolution](#actor-resolution)
- [Manual Logging](#manual-logging)
- [Query API](#query-api)
- [Entity Mixin](#entity-mixin)
- [Events](#events)
- [Using the Service Directly](#using-the-service-directly)
- [Configuration Options](#configuration-options)
- [Audit Log Entity](#audit-log-entity)
- [Standalone Usage](#standalone-usage)
- [Testing](#testing)
- [Changelog](#changelog)
- [Contributing](#contributing)
- [Security](#security)
- [Credits](#credits)
- [License](#license)

## Installation

Install the package via npm:

```bash
npm install @nestbolt/audit-log
```

Or via yarn:

```bash
yarn add @nestbolt/audit-log
```

Or via pnpm:

```bash
pnpm add @nestbolt/audit-log
```

### Peer Dependencies

This package requires the following peer dependencies, which you likely already have in a NestJS project:

```
@nestjs/common      ^10.0.0 || ^11.0.0
@nestjs/core        ^10.0.0 || ^11.0.0
@nestjs/typeorm     ^10.0.0 || ^11.0.0
typeorm             ^0.3.0
reflect-metadata    ^0.1.13 || ^0.2.0
```

### Optional

```bash
npm install @nestjs/event-emitter   # For audit.logged events
```

## Quick Start

### 1. Register the module in your `AppModule`

```typescript
import { AuditLogModule } from "@nestbolt/audit-log";

@Module({
  imports: [
    TypeOrmModule.forRoot({
      /* ... */
    }),
    AuditLogModule.forRoot({
      globalExcludedFields: ["password", "token"],
    }),
  ],
})
export class AppModule {}
```

### 2. Mark entities as auditable

```typescript
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
// Insert — creates audit log with action "created"
const user = userRepo.create({ name: "Alice", email: "alice@example.com" });
await userRepo.save(user);

// Update — creates audit log with action "updated" and field diff
user.name = "Bob";
await userRepo.save(user);
// audit log: oldValues: { name: "Alice" }, newValues: { name: "Bob" }

// Delete — creates audit log with action "deleted"
await userRepo.remove(user);
```

> **Important:** Only `.save()` and `.remove()` trigger TypeORM subscriber events. `Repository.update()` and `QueryBuilder.update()` do **not** trigger audit logging.

## Module Configuration

The module is registered globally — you only need to import it once.

### Static Configuration (forRoot)

```typescript
AuditLogModule.forRoot({
  defaultActor: { type: "System", id: "system" },
  actorResolver: RequestActorResolver,
  disabledActions: ["deleted"],
  globalExcludedFields: ["password", "token", "secret"],
  metadata: { app: "my-app", version: "1.0" },
});
```

### Async Configuration (forRootAsync)

```typescript
AuditLogModule.forRootAsync({
  imports: [ConfigModule],
  inject: [ConfigService],
  useFactory: (config: ConfigService) => ({
    globalExcludedFields: config.get("audit.excludedFields"),
    defaultActor: { type: "System", id: "system" },
  }),
});
```

## Using the @Auditable() Decorator

The `@Auditable()` class decorator marks an entity for automatic change tracking:

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
import { ActorResolver, AuditActor } from "@nestbolt/audit-log";
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
AuditLogModule.forRoot({
  actorResolver: RequestActorResolver,
});
```

The resolver is called automatically for both subscriber-based and manual logging (when no explicit actor is provided). If no resolver is configured, the `defaultActor` from options is used. If neither is set, actor fields are `null`.

## Manual Logging

Use `AuditLogService.log()` for cases not covered by the automatic subscriber:

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
| `getAuditLogs(options?)` | `Promise<AuditLogEntity[]>`       | Get audit logs for this entity |
| `getLatestAuditLog()`    | `Promise<AuditLogEntity \| null>` | Get the most recent audit log  |
| `getAuditableType()`     | `string`                          | Get the entity type name       |
| `getAuditableId()`       | `string`                          | Get the entity ID              |

## Events

When `@nestjs/event-emitter` is installed, the package emits:

| Event          | Payload                        | When                           |
| -------------- | ------------------------------ | ------------------------------ |
| `audit.logged` | `{ auditLog: AuditLogEntity }` | After any audit log is created |

```typescript
import { AUDIT_LOG_EVENTS, AuditLoggedEvent } from "@nestbolt/audit-log";
import { OnEvent } from "@nestjs/event-emitter";

@OnEvent(AUDIT_LOG_EVENTS.LOGGED)
handleAuditLog(event: AuditLoggedEvent) {
  console.log(`${event.auditLog.action} on ${event.auditLog.entityType}`);
}
```

## Using the Service Directly

Inject `AuditLogService` for manual logging and querying:

```typescript
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
| `log(params)`                                       | `Promise<AuditLogEntity>`         | Create a manual audit log entry |
| `getAuditLogs(entityType, entityId, options?)`      | `Promise<AuditLogEntity[]>`       | Query logs by entity            |
| `getAuditLogsByActor(actorType, actorId, options?)` | `Promise<AuditLogEntity[]>`       | Query logs by actor             |
| `getLatestAuditLog(entityType, entityId)`           | `Promise<AuditLogEntity \| null>` | Get most recent log for entity  |
| `resolveActor()`                                    | `Promise<AuditActor \| null>`     | Resolve the current actor       |

## Configuration Options

| Option                 | Type                           | Default | Description                                                         |
| ---------------------- | ------------------------------ | ------- | ------------------------------------------------------------------- |
| `defaultActor`         | `{ type: string; id: string }` | —       | Default actor when no resolver is configured                        |
| `actorResolver`        | `Type<ActorResolver>`          | —       | Class implementing `ActorResolver` interface                        |
| `disabledActions`      | `AuditAction[]`                | —       | Globally disable specific actions (`created`, `updated`, `deleted`) |
| `globalExcludedFields` | `string[]`                     | —       | Fields excluded from all audit logs                                 |
| `metadata`             | `Record<string, any>`          | —       | Extra metadata added to all audit logs                              |

## Audit Log Entity

The `audit_logs` table stores:

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

You can use the `computeDiff` utility and `slugify` function without the module:

```typescript
import { computeDiff } from "@nestbolt/audit-log";

const diff = computeDiff(
  { name: "Alice", email: "alice@example.com" },
  { name: "Bob", email: "alice@example.com" },
);
// diff = { oldValues: { name: "Alice" }, newValues: { name: "Bob" } }
```

## Testing

```bash
npm test
```

Run tests in watch mode:

```bash
npm run test:watch
```

Generate coverage report:

```bash
npm run test:cov
```

## Changelog

Please see [CHANGELOG](CHANGELOG.md) for more information on what has changed recently.

## Contributing

Please see [CONTRIBUTING](CONTRIBUTING.md) for details.

## Security

If you discover any security-related issues, please report them via [GitHub Issues](https://github.com/nestbolt/audit-log/issues) with the **security** label instead of using the public issue tracker.

## License

The MIT License (MIT). Please see [License File](LICENSE.md) for more information.
