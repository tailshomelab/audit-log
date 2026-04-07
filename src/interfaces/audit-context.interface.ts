import type { AuditActor } from "./actor-resolver.interface";

export interface AuditContext {
  actor?: AuditActor;
  metadata?: Record<string, any>;
  ipAddress?: string;
  userAgent?: string;
}
