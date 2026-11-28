import type { AuditAction } from "./audit-log-options.interface.js";
import type { AuditLogDraft, AuditLogRecord } from "./audit-log-record.interface.js";

export interface AuditLogQueryOptions {
  action?: AuditAction;
  from?: Date;
  to?: Date;
  limit?: number;
  offset?: number;
}

/**
 * Persists and queries audit records. Each ORM adapter provides one under `AUDIT_LOG_STORAGE`.
 * Query results are ordered by `createdAt` descending; `from`/`to` are inclusive.
 */
export interface AuditLogStorage {
  save(draft: AuditLogDraft): Promise<AuditLogRecord>;
  findByEntity(
    entityType: string,
    entityId: string,
    query?: AuditLogQueryOptions,
  ): Promise<AuditLogRecord[]>;
  findByActor(
    actorType: string,
    actorId: string,
    query?: AuditLogQueryOptions,
  ): Promise<AuditLogRecord[]>;
  findLatest(entityType: string, entityId: string): Promise<AuditLogRecord | null>;
}
