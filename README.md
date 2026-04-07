# @nestbolt/audit-log

Automatic entity change tracking and audit logging for NestJS with TypeORM.

Track insert, update, and delete operations on your entities with old/new value diffs, actor tracking, and configurable field filtering.

## Installation

```bash
npm install @nestbolt/audit-log
# or
pnpm add @nestbolt/audit-log
```

### Peer Dependencies

```bash
npm install @nestjs/common @nestjs/core @nestjs/typeorm typeorm reflect-metadata
```

### Optional

```bash
npm install @nestjs/event-emitter   # For audit.logged events
```

## Quick Start

### 1. Register the module

```typescript
import { AuditLogModule } from "@nestbolt/audit-log";

@Module({
  imports: [
    TypeOrmModule.forRoot({ /* ... */ }),
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

### 4. Query audit history

```typescript
// Via service
const logs = await auditLogService.getAuditLogs("User", userId);
const latest = await auditLogService.getLatestAuditLog("User", userId);

// Via mixin
const logs = await user.getAuditLogs();
const latest = await user.getLatestAuditLog();
```

## Module Configuration

### forRoot()

```typescript
AuditLogModule.forRoot({
  // Default actor when no resolver is configured
  defaultActor: { type: "System", id: "system" },

  // Custom actor resolver class
  actorResolver: RequestActorResolver,

  // Globally disable specific actions
  disabledActions: ["deleted"],

  // Fields excluded from all audit logs
  globalExcludedFields: ["password", "token", "secret"],

  // Extra metadata added to all audit logs
  metadata: { app: "my-app", version: "1.0" },
})
```

### forRootAsync()

```typescript
AuditLogModule.forRootAsync({
  imports: [ConfigModule],
  inject: [ConfigService],
  useFactory: (config: ConfigService) => ({
    globalExcludedFields: config.get("audit.excludedFields"),
    defaultActor: { type: "System", id: "system" },
  }),
})
```

## @Auditable() Decorator

```typescript
@Auditable({
  // Override entity type name (defaults to class name)
  auditableType: "AppUser",

  // Only track these fields (whitelist)
  only: ["name", "email", "role"],

  // Exclude these fields (blacklist)
  except: ["password", "token"],

  // Only track specific actions
  events: ["created", "deleted"],  // won't track updates
})
```

## Actor Resolution

Implement the `ActorResolver` interface to track who made changes:

```typescript
import { ActorResolver, AuditActor } from "@nestbolt/audit-log";
import { ClsService } from "nestjs-cls";

export class RequestActorResolver implements ActorResolver {
  constructor(private readonly cls: ClsService) {}

  resolve(): AuditActor | null {
    const userId = this.cls.get("userId");
    if (!userId) return null;
    return { type: "User", id: userId };
  }
}
```

## Manual Logging

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
  action: "updated",    // filter by action
  from: new Date("2024-01-01"),  // date range
  to: new Date("2024-12-31"),
  limit: 10,            // pagination
  offset: 0,
});

// By actor
const logs = await auditLogService.getAuditLogsByActor("Admin", adminId);

// Latest entry
const latest = await auditLogService.getLatestAuditLog("User", userId);
```

## Events

When `@nestjs/event-emitter` is installed, the package emits:

| Event | Payload | When |
|-------|---------|------|
| `audit.logged` | `{ auditLog: AuditLogEntity }` | After any audit log is created |

```typescript
import { AUDIT_LOG_EVENTS } from "@nestbolt/audit-log";
import { OnEvent } from "@nestjs/event-emitter";

@OnEvent(AUDIT_LOG_EVENTS.LOGGED)
handleAuditLog(event: AuditLoggedEvent) {
  console.log(`${event.auditLog.action} on ${event.auditLog.entityType}`);
}
```

## Audit Log Entity

The `audit_logs` table stores:

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID | Primary key |
| `action` | varchar | `created`, `updated`, or `deleted` |
| `entity_type` | varchar | Entity class name |
| `entity_id` | varchar | Entity ID |
| `actor_type` | varchar | Actor type (nullable) |
| `actor_id` | varchar | Actor ID (nullable) |
| `old_values` | JSON | Previous field values |
| `new_values` | JSON | New field values |
| `metadata` | JSON | Extra context |
| `ip_address` | varchar | Request IP (nullable) |
| `user_agent` | varchar | User agent (nullable) |
| `created_at` | timestamp | When the change occurred |

## License

MIT
