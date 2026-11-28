import { randomUUID } from "node:crypto";
import { defineEntity, p } from "@mikro-orm/core";
import type { AuditAction } from "../core/interfaces/audit-log-options.interface.js";

/**
 * The `audit_logs` table for MikroORM. Column names, nullability and indexed column sets
 * match `TypeOrmAuditLogEntity`. Every column has an explicit field name, so the mapping
 * does not depend on the application's naming strategy. Add it to the MikroORM `entities`
 * (or rely on `autoLoadEntities`, since `MikroOrmAuditLogModule` registers it with
 * `MikroOrmModule.forFeature`).
 */
export const MikroOrmAuditLogSchema = defineEntity({
  name: "AuditLog",
  tableName: "audit_logs",
  properties: {
    id: p
      .uuid()
      .primary()
      .fieldName("id")
      .onCreate(() => randomUUID()),
    action: p.string().$type<AuditAction>().length(50).fieldName("action"),
    entityType: p.string().length(255).fieldName("entity_type"),
    entityId: p.string().length(255).fieldName("entity_id"),
    actorType: p.string().length(255).nullable().fieldName("actor_type"),
    actorId: p.string().length(255).nullable().fieldName("actor_id"),
    oldValues: p.json<Record<string, any>>().nullable().fieldName("old_values"),
    newValues: p.json<Record<string, any>>().nullable().fieldName("new_values"),
    metadata: p.json<Record<string, any>>().nullable().fieldName("metadata"),
    ipAddress: p.string().length(45).nullable().fieldName("ip_address"),
    userAgent: p.string().length(512).nullable().fieldName("user_agent"),
    createdAt: p
      .datetime()
      .fieldName("created_at")
      .onCreate(() => new Date()),
  },
  indexes: [
    { properties: ["entityType", "entityId"] },
    { properties: ["actorType", "actorId"] },
    { properties: ["action"] },
    { properties: ["createdAt"] },
  ],
});
