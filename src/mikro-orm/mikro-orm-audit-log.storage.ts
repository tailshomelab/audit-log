import { randomUUID } from "node:crypto";
import { Inject, Injectable, OnModuleInit } from "@nestjs/common";
import { MikroORM, type FilterQuery } from "@mikro-orm/core";
import type {
  AuditLogDraft,
  AuditLogRecord,
} from "../core/interfaces/audit-log-record.interface.js";
import type {
  AuditLogQueryOptions,
  AuditLogStorage,
} from "../core/interfaces/audit-log-storage.interface.js";
import { MikroOrmAuditLogSchema } from "./mikro-orm-audit-log.schema.js";

type AuditLogRow = InstanceType<typeof MikroOrmAuditLogSchema.class>;

/**
 * The full row for a draft. Native inserts skip `onCreate`, so the id and timestamp are
 * set here; the same row is returned to the caller and emitted with `audit.logged`.
 */
export function createAuditRow(draft: AuditLogDraft): AuditLogRecord {
  return { id: randomUUID(), ...draft, createdAt: new Date() };
}

/**
 * `AuditLogStorage` backed by `MikroOrmAuditLogSchema`. Every call runs on its own fork of
 * the global `EntityManager`, so it works outside a `RequestContext` (startup hooks,
 * background jobs) and never touches the caller's unit of work.
 */
@Injectable()
export class MikroOrmAuditLogStorage implements AuditLogStorage, OnModuleInit {
  constructor(@Inject(MikroORM) private readonly orm: MikroORM) {}

  onModuleInit(): void {
    // `find()` falls back to the schema's own metadata, so check the discovered entities.
    if (!this.orm.getMetadata().has(MikroOrmAuditLogSchema.meta.class)) {
      throw new Error(
        "MikroOrmAuditLogSchema is not registered with MikroORM. Add it to the `entities` of " +
          "MikroOrmModule.forRoot(), or enable `autoLoadEntities`.",
      );
    }
  }

  async save(draft: AuditLogDraft): Promise<AuditLogRecord> {
    const row = createAuditRow(draft);
    await this.orm.em.fork().insert(MikroOrmAuditLogSchema, row);
    return row;
  }

  findByEntity(
    entityType: string,
    entityId: string,
    query?: AuditLogQueryOptions,
  ): Promise<AuditLogRecord[]> {
    return this.find({ entityType, entityId }, query);
  }

  findByActor(
    actorType: string,
    actorId: string,
    query?: AuditLogQueryOptions,
  ): Promise<AuditLogRecord[]> {
    return this.find({ actorType, actorId }, query);
  }

  async findLatest(entityType: string, entityId: string): Promise<AuditLogRecord | null> {
    const [latest] = await this.find({ entityType, entityId }, { limit: 1 });
    return latest ?? null;
  }

  private async find(
    match: Partial<Record<"entityType" | "entityId" | "actorType" | "actorId", string>>,
    query?: AuditLogQueryOptions,
  ): Promise<AuditLogRecord[]> {
    const where: FilterQuery<AuditLogRow> = { ...match };
    if (query?.action) where.action = query.action;
    if (query?.from || query?.to) {
      where.createdAt = {
        ...(query.from ? { $gte: query.from } : {}),
        ...(query.to ? { $lte: query.to } : {}),
      };
    }

    const offset = query?.offset || undefined;
    const rows = await this.orm.em.fork().find(MikroOrmAuditLogSchema, where, {
      orderBy: { createdAt: "desc" },
      // SQLite rejects OFFSET without LIMIT, so an offset alone gets an unbounded limit.
      limit: query?.limit || (offset ? Number.MAX_SAFE_INTEGER : undefined),
      offset,
    });
    return rows.map(toRecord);
  }
}

function toRecord(row: AuditLogRow): AuditLogRecord {
  return {
    id: row.id,
    action: row.action,
    entityType: row.entityType,
    entityId: row.entityId,
    actorType: row.actorType ?? null,
    actorId: row.actorId ?? null,
    oldValues: row.oldValues ?? null,
    newValues: row.newValues ?? null,
    metadata: row.metadata ?? null,
    ipAddress: row.ipAddress ?? null,
    userAgent: row.userAgent ?? null,
    createdAt: row.createdAt,
  };
}
