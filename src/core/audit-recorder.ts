import "reflect-metadata";
import { Inject, Injectable } from "@nestjs/common";
import { AUDITABLE_METADATA_KEY } from "./audit-log.constants.js";
import { AuditLogService } from "./audit-log.service.js";
import type { AuditableMetadata } from "./decorators/auditable.decorator.js";
import type { AuditAction } from "./interfaces/audit-log-options.interface.js";
import type { AuditLogDraft, AuditLogRecord } from "./interfaces/audit-log-record.interface.js";
import { ALWAYS_EXCLUDED, computeDiff } from "./utils/diff.js";

/** The value part of a draft, as built by `buildCreated`, `buildUpdated` or `buildDeleted`. */
export type AuditChange = Pick<AuditLogDraft, "oldValues" | "newValues">;

/**
 * The ORM-neutral capture pipeline shared by every adapter subscriber. Adapters supply
 * entity snapshots and primary-key values; the recorder applies the filters, builds the
 * diff and the draft, and emits `audit.logged` after the adapter has written the record.
 */
@Injectable()
export class AuditRecorder {
  constructor(@Inject(AuditLogService) private readonly service: AuditLogService) {}

  /** The `@Auditable()` metadata of the entity's class, or null when it is not auditable. */
  resolveTarget(entity: unknown): AuditableMetadata | null {
    if (entity === null || typeof entity !== "object") return null;
    return Reflect.getMetadata(AUDITABLE_METADATA_KEY, entity.constructor) ?? null;
  }

  /** False when the entity's `events` list omits the action or `disabledActions` lists it. */
  isEnabled(meta: AuditableMetadata, action: AuditAction): boolean {
    if (meta.events && !meta.events.includes(action)) return false;
    return !this.service.getOptions().disabledActions?.includes(action);
  }

  buildCreated(meta: AuditableMetadata, values: Record<string, any>): AuditChange {
    return { oldValues: null, newValues: this.filterValues(meta, toJsonSafe(values)) };
  }

  /**
   * The changed fields only, or null when nothing recordable changed. When the adapter knows
   * which fields the update wrote (`changedFields`), only those are compared, so fields that
   * one snapshot lacks (a partially loaded or unloaded entity) never produce a diff.
   */
  buildUpdated(
    meta: AuditableMetadata,
    oldValues: Record<string, any>,
    currentValues: Record<string, any>,
    changedFields?: readonly string[],
  ): AuditChange | null {
    const pick = (values: Record<string, any>) =>
      changedFields ? pickFields(values, changedFields) : values;
    return computeDiff(toJsonSafe(pick(oldValues)), toJsonSafe(pick(currentValues)), {
      only: meta.only,
      except: meta.except,
      globalExcept: this.service.getOptions().globalExcludedFields,
    });
  }

  buildDeleted(meta: AuditableMetadata, values: Record<string, any>): AuditChange {
    return { oldValues: this.filterValues(meta, toJsonSafe(values)), newValues: null };
  }

  /**
   * Serializes primary-key values in metadata order: a single key is stringified and
   * composite keys are joined with `:`. A key value that is itself composite (a relation to
   * an entity with a composite key) is flattened into the same list. Returns null when any
   * key value is missing.
   */
  formatEntityId(primaryKey: readonly unknown[]): string | null {
    const values = primaryKey.flat(Infinity);
    if (values.length === 0 || values.some((value) => value === null || value === undefined)) {
      return null;
    }
    return values.map(String).join(":");
  }

  async toDraft(
    meta: AuditableMetadata,
    action: AuditAction,
    entityId: string,
    change: AuditChange,
  ): Promise<AuditLogDraft> {
    const actor = await this.service.resolveActor();
    return {
      action,
      entityType: meta.auditableType,
      entityId,
      oldValues: change.oldValues,
      newValues: change.newValues,
      actorType: actor?.type ?? null,
      actorId: actor?.id ?? null,
      metadata: this.service.getOptions().metadata ?? null,
      ipAddress: null,
      userAgent: null,
    };
  }

  afterWrite(record: AuditLogRecord): void {
    this.service.notifyLogged(record);
  }

  private filterValues(meta: AuditableMetadata, values: Record<string, any>): Record<string, any> {
    const excluded = new Set([
      ...ALWAYS_EXCLUDED,
      ...(meta.except ?? []),
      ...(this.service.getOptions().globalExcludedFields ?? []),
    ]);
    const fields = meta.only && meta.only.length > 0 ? meta.only : Object.keys(values);

    const result: Record<string, any> = {};
    for (const field of fields) {
      if (excluded.has(field) || !(field in values)) continue;
      result[field] = values[field];
    }
    return result;
  }
}

function pickFields(values: Record<string, any>, fields: readonly string[]): Record<string, any> {
  const picked: Record<string, any> = {};
  for (const field of fields) {
    if (field in values) picked[field] = values[field];
  }
  return picked;
}

/**
 * Replaces every `bigint`, at any depth, with its decimal string: `JSON.stringify` (used by
 * the diff and by JSON columns) throws on `bigint`. Objects without one are returned as is.
 * A reference back to an object on the current path (a cycle) is left untouched.
 */
function toJsonSafe<T>(value: T): T {
  return replaceBigInts(value, new WeakSet()) as T;
}

function replaceBigInts(value: unknown, ancestors: WeakSet<object>): unknown {
  if (typeof value === "bigint") return value.toString();
  if (value === null || typeof value !== "object" || value instanceof Date) return value;
  if (ancestors.has(value)) return value;

  ancestors.add(value);
  try {
    let changed = false;
    const entries = Object.entries(value).map(([key, item]) => {
      const next = replaceBigInts(item, ancestors);
      if (next !== item) changed = true;
      return [key, next] as const;
    });
    if (!changed) return value;
    return Array.isArray(value) ? entries.map(([, item]) => item) : Object.fromEntries(entries);
  } finally {
    ancestors.delete(value);
  }
}
