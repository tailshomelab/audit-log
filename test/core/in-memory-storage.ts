import { randomUUID } from "node:crypto";
import type {
  AuditLogDraft,
  AuditLogQueryOptions,
  AuditLogRecord,
  AuditLogStorage,
} from "../../src/core/interfaces/index.js";

/** An ORM-free `AuditLogStorage` for core unit tests. */
export class InMemoryAuditLogStorage implements AuditLogStorage {
  readonly records: AuditLogRecord[] = [];

  async save(draft: AuditLogDraft): Promise<AuditLogRecord> {
    const record: AuditLogRecord = { ...draft, id: randomUUID(), createdAt: new Date() };
    this.records.push(record);
    return record;
  }

  async findByEntity(
    entityType: string,
    entityId: string,
    query?: AuditLogQueryOptions,
  ): Promise<AuditLogRecord[]> {
    return this.query((r) => r.entityType === entityType && r.entityId === entityId, query);
  }

  async findByActor(
    actorType: string,
    actorId: string,
    query?: AuditLogQueryOptions,
  ): Promise<AuditLogRecord[]> {
    return this.query((r) => r.actorType === actorType && r.actorId === actorId, query);
  }

  async findLatest(entityType: string, entityId: string): Promise<AuditLogRecord | null> {
    const [latest] = this.query((r) => r.entityType === entityType && r.entityId === entityId, {
      limit: 1,
    });
    return latest ?? null;
  }

  private query(
    match: (record: AuditLogRecord) => boolean,
    q?: AuditLogQueryOptions,
  ): AuditLogRecord[] {
    const offset = q?.offset ?? 0;
    return this.records
      .map((record, index) => ({ record, index }))
      .filter(({ record }) => match(record))
      .filter(({ record }) => !q?.action || record.action === q.action)
      .filter(({ record }) => !q?.from || record.createdAt >= q.from)
      .filter(({ record }) => !q?.to || record.createdAt <= q.to)
      .sort(
        (a, b) => b.record.createdAt.getTime() - a.record.createdAt.getTime() || b.index - a.index,
      )
      .map(({ record }) => record)
      .slice(offset, q?.limit ? offset + q.limit : undefined);
  }
}
