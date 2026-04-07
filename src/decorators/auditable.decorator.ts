import "reflect-metadata";
import { AUDITABLE_METADATA_KEY } from "../audit-log.constants";
import type { AuditAction } from "../interfaces/audit-log-options.interface";

export interface AuditableOptions {
  auditableType?: string;
  only?: string[];
  except?: string[];
  events?: AuditAction[];
}

export function Auditable(options?: AuditableOptions): ClassDecorator {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
  return (target: Function) => {
    Reflect.defineMetadata(
      AUDITABLE_METADATA_KEY,
      {
        auditableType: options?.auditableType ?? target.name,
        only: options?.only,
        except: options?.except,
        events: options?.events,
      },
      target,
    );
  };
}
