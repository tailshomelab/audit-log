# Changelog

All notable changes to `@nestbolt/audit-log` will be documented in this file.

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
