import "reflect-metadata";
import { AUDITABLE_METADATA_KEY } from "../audit-log.constants.js";
import { AuditLogService } from "../audit-log.service.js";
import { AuditLogNotInitializedException } from "../exceptions/audit-log-not-initialized.exception.js";
import type { AuditLogRecord } from "../interfaces/audit-log-record.interface.js";
import type { AuditLogQueryOptions } from "../interfaces/audit-log-storage.interface.js";

type Constructor<T = object> = new (...args: any[]) => T;

export interface AuditableMixinEntity {
  getAuditableType(): string;
  getAuditableId(): string;
  getAuditLogs(options?: AuditLogQueryOptions): Promise<AuditLogRecord[]>;
  getLatestAuditLog(): Promise<AuditLogRecord | null>;
}

function getService(): AuditLogService {
  const service = AuditLogService.getInstance();
  if (!service) {
    throw new AuditLogNotInitializedException();
  }
  return service;
}

export function AuditableMixin<TBase extends Constructor>(Base: TBase) {
  class AuditableEntityClass extends Base implements AuditableMixinEntity {
    getAuditableType(): string {
      const meta = Reflect.getMetadata(AUDITABLE_METADATA_KEY, this.constructor);
      return meta?.auditableType ?? this.constructor.name;
    }

    getAuditableId(): string {
      return String((this as any).id);
    }

    async getAuditLogs(options?: AuditLogQueryOptions): Promise<AuditLogRecord[]> {
      const service = getService();
      return service.getAuditLogs(this.getAuditableType(), this.getAuditableId(), options);
    }

    async getLatestAuditLog(): Promise<AuditLogRecord | null> {
      const service = getService();
      return service.getLatestAuditLog(this.getAuditableType(), this.getAuditableId());
    }
  }

  return AuditableEntityClass;
}
