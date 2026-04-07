import type { AuditLogEntity } from "../entities/audit-log.entity";

export const AUDIT_LOG_EVENTS = {
  LOGGED: "audit.logged",
} as const;

export interface AuditLoggedEvent {
  auditLog: AuditLogEntity;
}
