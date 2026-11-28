import type { AuditLogRecord } from "../interfaces/audit-log-record.interface.js";

export const AUDIT_LOG_EVENTS = {
  LOGGED: "audit.logged",
} as const;

export interface AuditLoggedEvent {
  auditLog: AuditLogRecord;
}
