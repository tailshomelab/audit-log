import { Inject, Injectable, Logger } from "@nestjs/common";
import {
  MikroORM,
  Reference,
  ReferenceKind,
  Utils,
  wrap,
  type EntityData,
  type EntityManager,
  type EntityMetadata,
  type EntityProperty,
  type EventArgs,
  type EventSubscriber,
  type Platform,
  type Transaction,
  type TransactionEventArgs,
} from "@mikro-orm/core";
import { AuditRecorder, type AuditChange } from "../core/audit-recorder.js";
import type { AuditableMetadata } from "../core/decorators/auditable.decorator.js";
import type { AuditAction } from "../core/interfaces/audit-log-options.interface.js";
import type { AuditLogRecord } from "../core/interfaces/audit-log-record.interface.js";
import { MikroOrmAuditLogSchema } from "./mikro-orm-audit-log.schema.js";
import { createAuditRow } from "./mikro-orm-audit-log.storage.js";

type AnyEntity = Record<string, any>;

/**
 * Captures `persist`/`remove` + `flush` of `@Auditable()` entities through entity hooks and
 * writes the record with a native `args.em.insert`, which runs in the flush's transaction
 * and triggers no further hooks. `audit.logged` is emitted only once that transaction
 * commits, and never for records whose transaction (or savepoint) rolls back.
 * Registered by `MikroOrmAuditLogModule`; not public API.
 */
@Injectable()
export class MikroOrmAuditSubscriber implements EventSubscriber {
  private readonly logger = new Logger("MikroOrmAuditLog");
  /** Records awaiting `audit.logged`, per open transaction or savepoint. */
  private readonly pending = new WeakMap<Transaction, AuditLogRecord[]>();
  /** The enclosing transaction of each open savepoint. */
  private readonly parents = new WeakMap<Transaction, Transaction>();
  /** The enclosing transaction of a savepoint being started, by its entity manager. */
  private readonly starting = new WeakMap<EntityManager, Transaction>();
  /** Persisted values loaded in `beforeUpdate` for entities that were not fully loaded. */
  private readonly persisted = new WeakMap<object, Record<string, any>>();

  constructor(
    @Inject(MikroORM) orm: MikroORM,
    @Inject(AuditRecorder) private readonly recorder: AuditRecorder,
  ) {
    orm.em.getEventManager().registerSubscriber(this);
  }

  async afterCreate(args: EventArgs<AnyEntity>): Promise<void> {
    const meta = this.target(args, "created");
    if (!meta) return;

    await this.write(args.em, meta, "created", () => ({
      entityId: this.entityId(args.meta, args.entity),
      change: this.recorder.buildCreated(meta, this.snapshot(args.meta, args.entity)),
    }));
  }

  /**
   * An uninitialized reference (`em.getReference`) or a partially loaded entity has no
   * original value for some changed properties, so the persisted row is read first, in the
   * flush's transaction and before the update runs.
   */
  async beforeUpdate(args: EventArgs<AnyEntity>): Promise<void> {
    const changeSet = args.changeSet;
    if (!changeSet || !this.target(args, "updated")) return;

    const original = (changeSet.originalEntity ?? {}) as Record<string, any>;
    const platform = args.em.getPlatform();
    const complete =
      wrap(args.entity).isInitialized() &&
      this.changedFields(args.meta, changeSet.payload).every((name) => {
        const prop = args.meta.properties[name];
        return !prop || this.decodeProperty(prop, original, platform) !== undefined;
      });
    if (complete) return;

    try {
      const where = Utils.getPrimaryKeyCond(args.entity, args.meta.primaryKeys);
      if (!where) return;
      const reader = args.em.fork({ keepTransactionContext: true, freshEventManager: true });
      const row = await reader.findOne(args.meta.class, where, { filters: false });
      if (row) this.persisted.set(args.entity, this.snapshot(args.meta, row));
    } catch (error) {
      // Without the persisted state there is nothing to diff against, so this update is not
      // audited. The user's flush must not fail because of the audit log.
      this.logger.warn(`Skipped auditing an update: old values could not be loaded (${error})`);
    }
  }

  async afterUpdate(args: EventArgs<AnyEntity>): Promise<void> {
    const loaded = this.persisted.get(args.entity);
    this.persisted.delete(args.entity);
    const meta = this.target(args, "updated");
    const changeSet = args.changeSet;
    if (!meta || !changeSet) return;

    const original = changeSet.originalEntity;
    if (!loaded && !original) return;

    await this.write(args.em, meta, "updated", () => {
      const old = loaded ?? this.originalSnapshot(args.meta, original ?? {}, args.em.getPlatform());
      // Only the properties this update wrote are compared.
      const changed = this.changedFields(args.meta, changeSet.payload);
      const current = this.snapshot(args.meta, args.entity);
      return {
        entityId: this.entityId(args.meta, args.entity),
        change: this.recorder.buildUpdated(meta, old, current, changed),
      };
    });
  }

  async afterDelete(args: EventArgs<AnyEntity>): Promise<void> {
    const meta = this.target(args, "deleted");
    if (!meta) return;

    // MikroORM keeps the primary key and loaded values on the removed entity.
    await this.write(args.em, meta, "deleted", () => ({
      entityId: this.entityId(args.meta, args.entity),
      change: this.recorder.buildDeleted(meta, this.snapshot(args.meta, args.entity)),
    }));
  }

  beforeTransactionStart(args: TransactionEventArgs): void {
    // For a savepoint, `transaction` is the enclosing transaction.
    if (args.transaction) this.starting.set(args.em, args.transaction);
  }

  afterTransactionStart(args: TransactionEventArgs): void {
    const parent = this.starting.get(args.em);
    this.starting.delete(args.em);
    if (args.transaction?.savepointName && parent) this.parents.set(args.transaction, parent);
  }

  afterTransactionCommit(args: TransactionEventArgs): void {
    const transaction = args.transaction;
    const committed = transaction ? this.pending.get(transaction) : undefined;
    if (!transaction || !committed) return;
    this.pending.delete(transaction);

    const parent = this.parents.get(transaction);
    if (parent) {
      // A released savepoint: its records now belong to the enclosing transaction.
      this.queue(parent, ...committed);
      return;
    }
    for (const record of committed) this.recorder.afterWrite(record);
  }

  afterTransactionRollback(args: TransactionEventArgs): void {
    if (args.transaction) this.pending.delete(args.transaction);
  }

  private queue(transaction: Transaction, ...records: AuditLogRecord[]): void {
    const queued = this.pending.get(transaction);
    if (queued) queued.push(...records);
    else this.pending.set(transaction, records);
  }

  /** The top-level properties a change-set payload writes (inline embeddables by parent). */
  private changedFields(meta: EntityMetadata<AnyEntity>, payload: object): string[] {
    const fields = Object.keys(payload).map(
      (key) => meta.properties[key as keyof AnyEntity]?.embedded?.[0] ?? key,
    );
    return [...new Set(fields)];
  }

  private target(args: EventArgs<AnyEntity>, action: AuditAction): AuditableMetadata | null {
    if (args.meta.className === MikroOrmAuditLogSchema.meta.className) return null;
    const meta = this.recorder.resolveTarget(args.entity);
    return meta && this.recorder.isEnabled(meta, action) ? meta : null;
  }

  /** The properties a snapshot covers: scalars, embeddables and owning to-one relations. */
  private snapshotProps(meta: EntityMetadata<AnyEntity>): EntityProperty<AnyEntity>[] {
    return meta.props.filter((prop) => {
      if (prop.persist === false || prop.embedded) return false;
      switch (prop.kind) {
        case ReferenceKind.SCALAR:
        case ReferenceKind.EMBEDDED:
        case ReferenceKind.MANY_TO_ONE:
          return true;
        case ReferenceKind.ONE_TO_ONE:
          return Boolean(prop.owner);
        default:
          return false;
      }
    });
  }

  /**
   * Runtime values of the snapshot properties. To-one relations contribute their key, also
   * inside embeddables, so the payload never embeds the entity graph.
   */
  private snapshot(meta: EntityMetadata<AnyEntity>, entity: AnyEntity): Record<string, any> {
    const values: Record<string, any> = {};
    for (const prop of this.snapshotProps(meta)) {
      const value = entity[prop.name];
      if (value === undefined) continue;
      values[prop.name] = this.snapshotValue(prop, value);
    }
    return values;
  }

  private snapshotValue(prop: EntityProperty<AnyEntity>, value: unknown): unknown {
    if (value === null || value === undefined) return value;
    if (this.isRelation(prop)) return relationKey(value);
    if (prop.kind !== ReferenceKind.EMBEDDED || !prop.embeddedProps) return value;
    if (Array.isArray(value)) return value.map((item) => this.embeddedValue(prop, item));
    return this.embeddedValue(prop, value);
  }

  private embeddedValue(prop: EntityProperty<AnyEntity>, value: unknown): unknown {
    if (value === null || typeof value !== "object") return value;
    const source = value as Record<string, any>;
    const embedded: Record<string, any> = {};
    for (const [key, child] of Object.entries(prop.embeddedProps)) {
      if (source[key] === undefined) continue;
      embedded[key] = this.snapshotValue(child, source[key]);
    }
    return embedded;
  }

  /**
   * `changeSet.originalEntity` holds database-encoded values (JSON as text, dates as the
   * platform's date encoding, to-one relations as a key array). They are decoded through
   * each property's type, so both sides of the diff use the same runtime representation.
   */
  private originalSnapshot(
    meta: EntityMetadata<AnyEntity>,
    original: EntityData<AnyEntity>,
    platform: Platform,
  ): Record<string, any> {
    const source = original as Record<string, any>;
    const values: Record<string, any> = {};
    for (const prop of this.snapshotProps(meta)) {
      const value = this.decodeProperty(prop, source, platform);
      if (value !== undefined) values[prop.name] = value;
    }
    return values;
  }

  /**
   * Inline embeddables are stored flattened (`address_city`, ...), so their object is rebuilt
   * from the child properties. Object embeddables and other properties are read by name.
   */
  private decodeProperty(
    prop: EntityProperty<AnyEntity>,
    source: Record<string, any>,
    platform: Platform,
  ): unknown {
    if (prop.kind === ReferenceKind.EMBEDDED && !prop.object && prop.embeddedProps) {
      const embedded: Record<string, any> = {};
      let found = false;
      for (const [key, child] of Object.entries(prop.embeddedProps)) {
        const value = this.decodeProperty(child, source, platform);
        if (value === undefined) continue;
        embedded[key] = value;
        found = true;
      }
      return found ? embedded : undefined;
    }
    const raw = source[prop.name];
    return raw === undefined ? undefined : this.decode(prop, raw, platform);
  }

  private decode(prop: EntityProperty<AnyEntity>, raw: unknown, platform: Platform): unknown {
    if (raw === null) return null;
    if (this.isRelation(prop)) {
      return Array.isArray(raw) && raw.length === 1 ? raw[0] : raw;
    }
    let value = raw;
    if (prop.customType) {
      value = prop.customType.convertToJSValue(value, platform, { force: true });
    }
    if (prop.runtimeType === "Date" && !(value instanceof Date)) {
      value = platform.parseDate(value as string | number);
    }
    return value;
  }

  private isRelation(prop: EntityProperty<AnyEntity>): boolean {
    return prop.kind === ReferenceKind.MANY_TO_ONE || prop.kind === ReferenceKind.ONE_TO_ONE;
  }

  /** The serialized primary key, in metadata order; composite keys are joined with `:`. */
  private entityId(meta: EntityMetadata<AnyEntity>, entity: AnyEntity): string | null {
    const values = meta.primaryKeys.map((name) => {
      const value = entity[name as string];
      return Utils.isEntity(value, true) ? relationKey(value) : value;
    });
    return this.recorder.formatEntityId(values);
  }

  /**
   * Builds the record with `prepare` and inserts it. Everything after the action filter runs
   * inside the failure-isolation `try`, so an audit-side error only skips the record.
   * `prepare` returns a null `entityId` or `change` when there is nothing to record.
   */
  private async write(
    em: EntityManager,
    meta: AuditableMetadata,
    action: AuditAction,
    prepare: () => { entityId: string | null; change: AuditChange | null },
  ): Promise<void> {
    try {
      const { entityId, change } = prepare();
      if (entityId === null || change === null) return;
      const row = createAuditRow(await this.recorder.toDraft(meta, action, entityId, change));
      await em.insert(MikroOrmAuditLogSchema, row);
      // Flushes run in a transaction (implicit or the caller's): notify after it commits.
      // Without one the insert is already committed, so notify now.
      const transaction = em.getTransactionContext();
      if (transaction) this.queue(transaction, row);
      else this.recorder.afterWrite(row);
    } catch (error) {
      // Failure isolation: an audit failure (for example a missing audit table) must never
      // fail the user's flush, so the record is skipped and the error only logged.
      this.logger.warn(`Skipped an audit record for ${meta.auditableType} (${error})`);
    }
  }
}

/** The primary key of a related entity or reference: the bare value, or an array if composite. */
function relationKey(value: unknown): unknown {
  if (value === null || !Utils.isEntity(value, true)) return value;
  const related = Reference.unwrapReference(value as object);
  // getPrimaryKeys() lists composite keys in metadata order (getPrimaryKey() gives a map).
  const keys = wrap(related, true).getPrimaryKeys();
  return keys && keys.length === 1 ? keys[0] : keys;
}
