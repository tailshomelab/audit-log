import { Inject, Injectable, Logger } from "@nestjs/common";
import {
  DataSource,
  type EntityManager,
  type EntityMetadata,
  type EntitySubscriberInterface,
  type InsertEvent,
  type ObjectLiteral,
  type QueryRunner,
  type RemoveEvent,
  type TransactionCommitEvent,
  type TransactionRollbackEvent,
  type TransactionStartEvent,
  type UpdateEvent,
} from "typeorm";
import { AuditRecorder, type AuditChange } from "../core/audit-recorder.js";
import type { AuditableMetadata } from "../core/decorators/auditable.decorator.js";
import type { AuditAction } from "../core/interfaces/audit-log-options.interface.js";
import type { AuditLogRecord } from "../core/interfaces/audit-log-record.interface.js";
import { TypeOrmAuditLogEntity } from "./typeorm-audit-log.entity.js";

/**
 * Captures `save`/`remove` of `@Auditable()` entities and writes the audit record through
 * the triggering operation's `EntityManager`, so it shares that operation's transaction.
 * `audit.logged` is emitted only once that transaction commits, and never for records
 * whose transaction (or savepoint) rolls back.
 * Registered by `TypeOrmAuditLogModule`; not part of the public API.
 */
@Injectable()
export class TypeOrmAuditSubscriber implements EntitySubscriberInterface {
  private readonly logger = new Logger("TypeOrmAuditLog");
  private readonly snapshots = new WeakMap<object, Record<string, any>>();
  /**
   * Records awaiting `audit.logged`, per query runner (one per connection and transaction),
   * as one frame per open transaction level: the outer transaction, then each savepoint.
   */
  private readonly pending = new WeakMap<QueryRunner, AuditLogRecord[][]>();

  constructor(
    @Inject(DataSource) dataSource: DataSource,
    @Inject(AuditRecorder) private readonly recorder: AuditRecorder,
  ) {
    dataSource.subscribers.push(this);
  }

  async afterInsert(event: InsertEvent<ObjectLiteral>): Promise<void> {
    const meta = this.target(event.entity, "created");
    if (!meta) return;

    await this.write(event.manager, meta, "created", () => ({
      entityId: this.entityId(event.metadata, event.entity),
      change: this.recorder.buildCreated(meta, this.snapshot(event.metadata, event.entity)),
    }));
  }

  async beforeUpdate(event: UpdateEvent<ObjectLiteral>): Promise<void> {
    const entity = event.entity;
    if (!entity || !this.target(entity, "updated")) return;

    if (event.databaseEntity) {
      this.snapshots.set(entity, this.snapshot(event.metadata, event.databaseEntity));
      return;
    }

    const where = event.metadata.getEntityIdMap(entity);
    if (!where) return;

    try {
      const persisted = await event.manager.findOne(event.metadata.target, { where });
      if (persisted) {
        this.snapshots.set(entity, this.snapshot(event.metadata, persisted));
      }
    } catch (error) {
      // Without the persisted state there is nothing to diff against, so this update is not
      // audited. The user's update must not fail because of the audit log.
      this.logger.warn(`Skipped auditing an update: old values could not be loaded (${error})`);
    }
  }

  async afterUpdate(event: UpdateEvent<ObjectLiteral>): Promise<void> {
    const entity = event.entity;
    if (!entity) return;

    const old = this.snapshots.get(entity);
    this.snapshots.delete(entity);
    const meta = this.target(entity, "updated");
    if (!old || !meta) return;

    await this.write(event.manager, meta, "updated", () => {
      // Only the columns and relations this update wrote: a partially populated entity (for
      // example `save(create({ id, name }))`) must not diff the properties it does not carry.
      const changedFields = [
        ...event.updatedColumns.map(
          (column) => column.embeddedMetadata?.parentPropertyNames[0] ?? column.propertyName,
        ),
        ...event.updatedRelations.map((relation) => relation.propertyName),
      ];
      const current = this.snapshot(event.metadata, entity);
      return {
        entityId: this.entityId(event.metadata, entity),
        change: this.recorder.buildUpdated(meta, old, current, changedFields),
      };
    });
  }

  async afterRemove(event: RemoveEvent<ObjectLiteral>): Promise<void> {
    const meta = this.target(event.entity, "deleted");
    if (!meta || !event.entity) return;

    // TypeORM clears the entity's primary key after removal; event.entityId keeps it.
    const removed = event.entity;
    await this.write(event.manager, meta, "deleted", () => ({
      entityId: this.entityId(event.metadata, event.entityId, true),
      change: this.recorder.buildDeleted(meta, this.snapshot(event.metadata, removed)),
    }));
  }

  afterTransactionStart(event: TransactionStartEvent): void {
    const frames = this.pending.get(event.queryRunner) ?? [];
    frames.push([]);
    this.pending.set(event.queryRunner, frames);
  }

  afterTransactionCommit(event: TransactionCommitEvent): void {
    const frames = this.pending.get(event.queryRunner);
    const committed = frames?.pop();
    if (!frames || !committed) return;
    if (frames.length > 0) {
      // A released savepoint: its records now belong to the enclosing transaction.
      frames[frames.length - 1].push(...committed);
      return;
    }
    this.pending.delete(event.queryRunner);
    for (const record of committed) this.recorder.afterWrite(record);
  }

  afterTransactionRollback(event: TransactionRollbackEvent): void {
    const frames = this.pending.get(event.queryRunner);
    frames?.pop();
    if (frames?.length === 0) this.pending.delete(event.queryRunner);
  }

  private target(entity: unknown, action: AuditAction): AuditableMetadata | null {
    const meta = this.recorder.resolveTarget(entity);
    return meta && this.recorder.isEnabled(meta, action) ? meta : null;
  }

  /**
   * Mapped column values keyed by top-level property name. Embedded columns contribute
   * their whole embedded object; relation join columns contribute the related primary key.
   */
  private snapshot(metadata: EntityMetadata, entity: ObjectLiteral): Record<string, any> {
    const values: Record<string, any> = {};
    for (const column of metadata.columns) {
      const embeddedKey = column.embeddedMetadata?.parentPropertyNames[0];
      const key = embeddedKey ?? column.propertyName;
      if (key in values) continue;

      const value = embeddedKey !== undefined ? entity[embeddedKey] : column.getEntityValue(entity);
      if (value !== undefined) values[key] = value;
    }
    return values;
  }

  /**
   * The serialized primary key. `source` is the entity, or with `mixedId` the value of
   * `RemoveEvent.entityId`: the bare value for a single key, an id map for a composite key.
   */
  private entityId(metadata: EntityMetadata, source: unknown, mixedId = false): string | null {
    const columns = metadata.primaryColumns;
    const values =
      mixedId && columns.length === 1
        ? [source]
        : columns.map((column) => column.getEntityValue(source as ObjectLiteral));
    return this.recorder.formatEntityId(values);
  }

  /**
   * Builds the record with `prepare` and saves it. Everything after the action filter runs
   * inside the failure-isolation `try`, so an audit-side error only skips the record.
   * `prepare` returns a null `entityId` or `change` when there is nothing to record.
   */
  private async write(
    manager: EntityManager,
    meta: AuditableMetadata,
    action: AuditAction,
    prepare: () => { entityId: string | null; change: AuditChange | null },
  ): Promise<void> {
    try {
      const { entityId, change } = prepare();
      if (entityId === null || change === null) return;
      const draft = await this.recorder.toDraft(meta, action, entityId, change);
      const repository = manager.getRepository(TypeOrmAuditLogEntity);
      const saved = await repository.save(repository.create(draft));
      this.notifyAfterCommit(manager.queryRunner, saved);
    } catch (error) {
      // Failure isolation: an audit failure (for example a missing audit table) must never
      // fail the user's operation, so the record is skipped and the error only logged.
      this.logger.warn(`Skipped an audit record for ${meta.auditableType} (${error})`);
    }
  }

  /** Queues the record until the open transaction commits, or notifies now without one. */
  private notifyAfterCommit(queryRunner: QueryRunner | undefined, record: AuditLogRecord): void {
    const frames = queryRunner?.isTransactionActive ? this.pending.get(queryRunner) : undefined;
    if (frames && frames.length > 0) {
      frames[frames.length - 1].push(record);
      return;
    }
    this.recorder.afterWrite(record);
  }
}
