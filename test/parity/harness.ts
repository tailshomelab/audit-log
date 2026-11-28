import "reflect-metadata";
import type { DynamicModule } from "@nestjs/common";
import { EventEmitter2 } from "@nestjs/event-emitter";
import type { TestingModule } from "@nestjs/testing";
import { Auditable } from "../../src/core/decorators/auditable.decorator.js";
import type { AuditLogModuleOptions, AuditLogRecord } from "../../src/core/interfaces/index.js";

/*
 * Parity fixtures: plain, ORM-free classes. Each adapter harness maps them to its ORM
 * (TypeORM `EntitySchema` with `target`, MikroORM `EntitySchema`/`defineEntity` with the
 * class), so `@Auditable()` metadata sits on the class the ORM instantiates.
 * Fields use `declare` so instances carry no own `undefined` properties.
 */

@Auditable()
export class ParityUser {
  declare id: string;
  declare name: string;
  declare email: string;
  declare password: string | null;
  declare createdAt: Date;
  declare updatedAt: Date;
}

@Auditable({ except: ["secret"] })
export class ParityItem {
  declare id: string;
  declare name: string;
  declare secret: string | null;
}

@Auditable({ only: ["title"] })
export class ParityArticle {
  declare id: string;
  declare title: string;
  declare content: string | null;
}

@Auditable({ events: ["created", "deleted"] })
export class ParityCreateDeleteOnly {
  declare id: string;
  declare value: string;
}

@Auditable({ auditableType: "AppUser" })
export class ParityMember {
  declare id: string;
  declare name: string;
}

export class ParityPost {
  declare id: string;
  declare title: string;
}

export type Constructor<T = object> = new (...args: any[]) => T;

export type FixtureColumn = "string" | "nullable-string";

/**
 * An ORM-neutral table definition. Every fixture also has `id`, an ORM-generated UUID
 * primary key. With `timestamps`, it has `createdAt`/`updatedAt` mapped to
 * `created_at`/`updated_at`, set by the ORM on insert and update.
 */
export interface ParityFixture {
  target: Constructor;
  tableName: string;
  columns: Record<string, FixtureColumn>;
  timestamps?: boolean;
}

export const PARITY_FIXTURES: readonly ParityFixture[] = [
  {
    target: ParityUser,
    tableName: "parity_users",
    columns: { name: "string", email: "string", password: "nullable-string" },
    timestamps: true,
  },
  {
    target: ParityItem,
    tableName: "parity_items",
    columns: { name: "string", secret: "nullable-string" },
  },
  {
    target: ParityArticle,
    tableName: "parity_articles",
    columns: { title: "string", content: "nullable-string" },
  },
  {
    target: ParityCreateDeleteOnly,
    tableName: "parity_create_delete_only",
    columns: { value: "string" },
  },
  { target: ParityMember, tableName: "parity_members", columns: { name: "string" } },
  { target: ParityPost, tableName: "parity_posts", columns: { title: "string" } },
];

export interface EventEmitterLike {
  emit(event: string, ...args: any[]): boolean;
}

export interface HarnessConfig {
  options?: AuditLogModuleOptions;
  /** Register the adapter module with `forRootAsync` instead of `forRoot`. */
  async?: boolean;
  /** Registered globally under the `EventEmitter2` class token. */
  emitter?: EventEmitterLike;
}

export type TransactionalInsert = <T extends object>(
  target: Constructor<T>,
  data: Partial<T>,
) => Promise<T>;

/**
 * What `runCoreScenarios` needs from an adapter. One instance drives one Nest testing
 * module at a time on a fresh in-memory database: `bootstrap`, then helpers, then `close`.
 */
export interface AdapterHarness {
  readonly name: string;
  /** The ORM entity definitions for `PARITY_FIXTURES`. */
  defineAuditableFixtures(): unknown[];
  /** A fresh database with the fixtures and audit table, plus the adapter's audit module. */
  bootstrap(config?: HarnessConfig): Promise<TestingModule>;
  /** Creates and persists an entity through the ORM's entity-event-emitting path. */
  insert<T extends object>(target: Constructor<T>, data: Partial<T>): Promise<T>;
  /** Applies `changes` to a persisted entity and persists it. */
  update<T extends object>(entity: T, changes: Partial<T>): Promise<T>;
  remove(entity: object): Promise<void>;
  /**
   * Updates the row of `target` whose primary key is `id` without loading it first
   * (TypeORM `save(create({ id, ...changes }))`, MikroORM `em.getReference()`).
   */
  updateUnloaded<T extends object>(
    target: Constructor<T>,
    id: string,
    changes: Partial<T>,
  ): Promise<void>;
  /**
   * Runs `work` in one ORM transaction, whose `insert` persists inside it. The transaction
   * commits when `work` resolves and rolls back, rejecting with its error, when it throws.
   */
  transaction(work: (insert: TransactionalInsert) => Promise<void>): Promise<void>;
  /** All audit rows in insertion order. */
  listAuditRows(): Promise<AuditLogRecord[]>;
  /** Rewrites a record's `createdAt`, so query scenarios get distinct dates. */
  setCreatedAt(id: string, createdAt: Date): Promise<void>;
  /** Drops the audit table to make every audit write fail. */
  dropAuditTable(): Promise<void>;
  close(): Promise<void>;
}

/** A global module that provides `emitter` under the `EventEmitter2` class token. */
export function eventEmitterModule(emitter: EventEmitterLike): DynamicModule {
  class ParityEventEmitterModule {}
  return {
    module: ParityEventEmitterModule,
    global: true,
    providers: [{ provide: EventEmitter2, useValue: emitter }],
    exports: [EventEmitter2],
  };
}
