import "reflect-metadata";
import { AUDITABLE_METADATA_KEY } from "../audit-log.constants";
import { AuditLogService } from "../audit-log.service";
import { AuditLogNotInitializedException } from "../exceptions/audit-log-not-initialized.exception";
import type { AuditLogEntity } from "../entities/audit-log.entity";
import type { AuditLogQueryOptions } from "../audit-log.service";

type Constructor<T = object> = new (...args: any[]) => T;

export interface AuditableMixinEntity {
  getAuditableType(): string;
  getAuditableId(): string;
  getAuditLogs(options?: AuditLogQueryOptions): Promise<AuditLogEntity[]>;
  getLatestAuditLog(): Promise<AuditLogEntity | null>;
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

    async getAuditLogs(options?: AuditLogQueryOptions): Promise<AuditLogEntity[]> {
      const service = getService();
      return service.getAuditLogs(this.getAuditableType(), this.getAuditableId(), options);
    }

    async getLatestAuditLog(): Promise<AuditLogEntity | null> {
      const service = getService();
      return service.getLatestAuditLog(this.getAuditableType(), this.getAuditableId());
    }
  }

  return AuditableEntityClass;
}
