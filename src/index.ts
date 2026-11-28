// The ORM-free core. Adapters live at "@nestbolt/audit-log/typeorm" and
// "@nestbolt/audit-log/mikro-orm"; this entry point imports no ORM package.

// Constants and injection tokens
export {
  AUDIT_LOG_OPTIONS,
  AUDITABLE_METADATA_KEY,
  AUDIT_LOG_STORAGE,
  AUDIT_LOG_ACTOR_RESOLVER,
} from "./core/audit-log.constants.js";

// Service
export { AuditLogService } from "./core/audit-log.service.js";
export type { ManualAuditLogParams } from "./core/audit-log.service.js";

// Decorators
export { Auditable } from "./core/decorators/index.js";
export type { AuditableOptions } from "./core/decorators/index.js";

// Mixins
export { AuditableMixin } from "./core/mixins/index.js";
export type { AuditableMixinEntity } from "./core/mixins/index.js";

// Events
export { AUDIT_LOG_EVENTS } from "./core/events/index.js";
export type { AuditLoggedEvent } from "./core/events/index.js";

// Exceptions
export { AuditLogNotInitializedException } from "./core/exceptions/index.js";

// Record, storage contract and option types
export type {
  ActorResolver,
  AuditActor,
  AuditAction,
  AuditLogModuleOptions,
  AuditLogAsyncOptions,
  AuditLogRecord,
  AuditLogDraft,
  AuditLogStorage,
  AuditLogQueryOptions,
} from "./core/interfaces/index.js";

// Utils
export { computeDiff } from "./core/utils/index.js";
export type { FieldDiff } from "./core/utils/index.js";
