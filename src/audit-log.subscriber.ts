import "reflect-metadata";
import {
  EventSubscriber,
  EntitySubscriberInterface,
  InsertEvent,
  UpdateEvent,
  RemoveEvent,
  DataSource,
} from "typeorm";
import { AUDITABLE_METADATA_KEY } from "./audit-log.constants";
import { AuditLogEntity } from "./entities/audit-log.entity";
import { AuditLogService } from "./audit-log.service";
import { AUDIT_LOG_EVENTS } from "./events/audit-log.events";
import { computeDiff } from "./utils/diff";
import type { AuditAction } from "./interfaces/audit-log-options.interface";

interface AuditableMetadata {
  auditableType: string;
  only?: string[];
  except?: string[];
  events?: AuditAction[];
}

@EventSubscriber()
export class AuditSubscriber implements EntitySubscriberInterface {
  private oldEntityMap = new WeakMap<object, Record<string, any>>();

  constructor(dataSource: DataSource) {
    dataSource.subscribers.push(this);
  }

  afterInsert(event: InsertEvent<any>): void | Promise<void> {
    if (!event.entity) return;

    const meta = this.getMetadata(event.entity);
    if (!meta) return;

    if (!this.isActionEnabled(meta, "created")) return;

    const service = AuditLogService.getInstance();
    const options = service?.getOptions();

    const entityValues = this.extractValues(event.entity, meta, options?.globalExcludedFields);

    return this.writeAuditLog(event, {
      action: "created",
      entityType: meta.auditableType,
      entityId: String(event.entity.id),
      oldValues: null,
      newValues: entityValues,
      service,
      options,
    });
  }

  beforeUpdate(event: UpdateEvent<any>): void | Promise<void> {
    if (!event.entity) return;

    const meta = this.getMetadata(event.entity);
    if (!meta) return;

    if (!this.isActionEnabled(meta, "updated")) return;

    if (event.databaseEntity) {
      this.oldEntityMap.set(event.entity, { ...event.databaseEntity });
      return;
    }

    const entityId = (event.entity as any).id;
    if (entityId === null || entityId === undefined) return;

    return event.manager
      .findOne(event.entity.constructor as any, { where: { id: entityId } })
      .then((old: any) => {
        if (old) {
          this.oldEntityMap.set(event.entity as object, { ...old });
        }
      })
      .catch(() => {
        // Silently skip — old value capture failed, update will not be audited
      });
  }

  afterUpdate(event: UpdateEvent<any>): void | Promise<void> {
    if (!event.entity) return;

    const meta = this.getMetadata(event.entity);
    if (!meta) return;

    if (!this.isActionEnabled(meta, "updated")) return;

    const old = this.oldEntityMap.get(event.entity);
    this.oldEntityMap.delete(event.entity);

    if (!old) return;

    const service = AuditLogService.getInstance();
    const options = service?.getOptions();

    const diff = computeDiff(old, event.entity as Record<string, any>, {
      only: meta.only,
      except: meta.except,
      globalExcept: options?.globalExcludedFields,
    });

    if (!diff) return;

    return this.writeAuditLog(event, {
      action: "updated",
      entityType: meta.auditableType,
      entityId: String((event.entity as any).id),
      oldValues: diff.oldValues,
      newValues: diff.newValues,
      service,
      options,
    });
  }

  afterRemove(event: RemoveEvent<any>): void | Promise<void> {
    if (!event.entity) return;

    const meta = this.getMetadata(event.entity);
    if (!meta) return;

    if (!this.isActionEnabled(meta, "deleted")) return;

    const service = AuditLogService.getInstance();
    const options = service?.getOptions();

    const entityValues = this.extractValues(event.entity, meta, options?.globalExcludedFields);

    // After remove, entity.id is cleared by TypeORM — use event.entityId instead
    const rawId = event.entityId ?? event.entity.id;
    if (rawId === null || rawId === undefined) return;
    const entityId = String(rawId);

    return this.writeAuditLog(event, {
      action: "deleted",
      entityType: meta.auditableType,
      entityId,
      oldValues: entityValues,
      newValues: null,
      service,
      options,
    });
  }

  // --- Private ---

  private getMetadata(entity: any): AuditableMetadata | null {
    if (!entity || !entity.constructor) return null;
    return Reflect.getMetadata(AUDITABLE_METADATA_KEY, entity.constructor) ?? null;
  }

  private isActionEnabled(meta: AuditableMetadata, action: AuditAction): boolean {
    // Check entity-level event filter
    if (meta.events && !meta.events.includes(action)) return false;

    // Check module-level disabled actions
    const service = AuditLogService.getInstance();
    const options = service?.getOptions();
    if (options?.disabledActions?.includes(action)) return false;

    return true;
  }

  private extractValues(
    entity: any,
    meta: AuditableMetadata,
    globalExcludedFields?: string[],
  ): Record<string, any> {
    const alwaysExcluded = new Set(["id", "createdAt", "updatedAt", "created_at", "updated_at"]);
    const except = new Set([
      ...alwaysExcluded,
      ...(meta.except ?? []),
      ...(globalExcludedFields ?? []),
    ]);

    const result: Record<string, any> = {};
    const keys = meta.only ?? Object.keys(entity);

    for (const key of keys) {
      if (except.has(key)) continue;
      if (typeof entity[key] === "function") continue;
      result[key] = entity[key];
    }

    return result;
  }

  private async writeAuditLog(
    event: InsertEvent<any> | UpdateEvent<any> | RemoveEvent<any>,
    params: {
      action: AuditAction;
      entityType: string;
      entityId: string;
      oldValues: Record<string, any> | null;
      newValues: Record<string, any> | null;
      service: AuditLogService | null;
      options: any;
    },
  ): Promise<void> {
    try {
      const actor = await params.service?.resolveActor();

      const repo = event.manager.getRepository(AuditLogEntity);
      const auditLog = repo.create({
        action: params.action,
        entityType: params.entityType,
        entityId: params.entityId,
        oldValues: params.oldValues,
        newValues: params.newValues,
        actorType: actor?.type ?? null,
        actorId: actor?.id ?? null,
        metadata: params.options?.metadata ?? null,
        ipAddress: null,
        userAgent: null,
      });

      const saved = await repo.save(auditLog);

      if (params.service) {
        (params.service as any).emit(AUDIT_LOG_EVENTS.LOGGED, { auditLog: saved });
      }
    } catch {
      // Audit log write failed — do not propagate to avoid crashing the main operation
    }
  }
}
