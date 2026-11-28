import type { AuditAction } from "./audit-log-options.interface.js";

export interface AuditLogRecord {
  id: string;
  action: AuditAction;
  entityType: string;
  entityId: string;
  actorType: string | null;
  actorId: string | null;
  oldValues: Record<string, any> | null;
  newValues: Record<string, any> | null;
  metadata: Record<string, any> | null;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: Date;
}

export type AuditLogDraft = Omit<AuditLogRecord, "id" | "createdAt">;
