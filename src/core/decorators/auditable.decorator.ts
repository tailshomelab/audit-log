import "reflect-metadata";
import { AUDITABLE_METADATA_KEY } from "../audit-log.constants.js";
import type { AuditAction } from "../interfaces/audit-log-options.interface.js";

export interface AuditableOptions {
  auditableType?: string;
  only?: string[];
  except?: string[];
  events?: AuditAction[];
}

/** The metadata `@Auditable()` stores on a class under `AUDITABLE_METADATA_KEY`. */
export interface AuditableMetadata extends AuditableOptions {
  auditableType: string;
}

export function Auditable(options?: AuditableOptions): ClassDecorator {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
  return (target: Function) => {
    const metadata: AuditableMetadata = {
      auditableType: options?.auditableType ?? target.name,
      only: options?.only,
      except: options?.except,
      events: options?.events,
    };
    Reflect.defineMetadata(AUDITABLE_METADATA_KEY, metadata, target);
  };
}
