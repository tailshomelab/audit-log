import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { Test, type TestingModule } from "@nestjs/testing";
import { MikroOrmModule } from "@mikro-orm/nestjs";
import {
  MikroORM,
  defineConfig,
  defineEntity,
  p,
  type EntityManager,
  type EntitySchema,
} from "@mikro-orm/libsql";
import { MikroOrmAuditLogModule } from "../../src/mikro-orm/mikro-orm-audit-log.module.js";
import { MikroOrmAuditLogSchema } from "../../src/mikro-orm/mikro-orm-audit-log.schema.js";
import type { AuditLogRecord } from "../../src/core/interfaces/index.js";
import {
  PARITY_FIXTURES,
  eventEmitterModule,
  type AdapterHarness,
  type Constructor,
  type ParityFixture,
} from "./harness.js";
import { runCoreScenarios } from "./core-scenarios.js";

function toEntitySchema(fixture: ParityFixture): EntitySchema {
  const properties: Record<string, any> = {
    id: p
      .uuid()
      .primary()
      .onCreate(() => randomUUID()),
  };
  for (const [property, kind] of Object.entries(fixture.columns)) {
    properties[property] = kind === "nullable-string" ? p.string().nullable() : p.string();
  }
  if (fixture.timestamps) {
    properties.createdAt = p
      .datetime()
      .fieldName("created_at")
      .onCreate(() => new Date());
    properties.updatedAt = p
      .datetime()
      .fieldName("updated_at")
      .onCreate(() => new Date())
      .onUpdate(() => new Date());
  }
  return defineEntity({ class: fixture.target, tableName: fixture.tableName, properties });
}

// One schema per fixture class for the whole file: MikroORM attaches metadata to the class.
const entitySchemas = PARITY_FIXTURES.map(toEntitySchema);

function createMikroOrmHarness(): AdapterHarness {
  let module: TestingModule | undefined;
  let em: EntityManager | undefined;

  const orm = (): MikroORM => {
    if (!module) throw new Error("harness not bootstrapped");
    return module.get(MikroORM);
  };
  const entityManager = (): EntityManager => {
    if (!em) throw new Error("harness not bootstrapped");
    return em;
  };

  const harness: AdapterHarness = {
    name: "MikroORM",

    defineAuditableFixtures: () => entitySchemas,

    async bootstrap({ options = {}, async, emitter } = {}) {
      module = await Test.createTestingModule({
        imports: [
          MikroOrmModule.forRoot(
            defineConfig({
              dbName: ":memory:",
              entities: [MikroOrmAuditLogSchema, ...entitySchemas],
              registerRequestContext: false,
            }),
          ),
          async
            ? MikroOrmAuditLogModule.forRootAsync({ useFactory: () => options })
            : MikroOrmAuditLogModule.forRoot(options),
          ...(emitter ? [eventEmitterModule(emitter)] : []),
        ],
      }).compile();
      await module.init();
      await orm().schema.create();
      // The unit of work the helpers use; the fork keeps inserted entities managed.
      em = orm().em.fork();
      return module;
    },

    async insert<T extends object>(target: Constructor<T>, data: Partial<T>): Promise<T> {
      const entity = entityManager().create(target, data as any);
      await entityManager().flush();
      return entity;
    },

    async update(entity, changes) {
      Object.assign(entity, changes);
      await entityManager().flush();
      return entity;
    },

    async remove(entity) {
      await entityManager().remove(entity).flush();
    },

    async updateUnloaded(target, id, changes) {
      const fork = orm().em.fork();
      Object.assign(fork.getReference(target, id as never), changes);
      await fork.flush();
    },

    async transaction(work) {
      await orm()
        .em.fork()
        .transactional(async (tx) => {
          await work(async (target, data) => {
            const entity = tx.create(target, data as any);
            await tx.flush();
            return entity;
          });
        });
    },

    async listAuditRows() {
      const ordered: Array<{ id: string }> = await orm()
        .em.getConnection()
        .execute("SELECT id FROM audit_logs ORDER BY rowid");
      const ids = ordered.map((row) => row.id);
      const rows = await orm()
        .em.fork()
        .find(MikroOrmAuditLogSchema, { id: { $in: ids } });
      const records: AuditLogRecord[] = rows.map((row) => ({
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
      }));
      return records.sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id));
    },

    async setCreatedAt(id, createdAt) {
      await orm().em.fork().nativeUpdate(MikroOrmAuditLogSchema, { id }, { createdAt });
    },

    async dropAuditTable() {
      await orm().em.getConnection().execute("DROP TABLE audit_logs");
    },

    async close() {
      await module?.close();
      module = undefined;
      em = undefined;
    },
  };
  return harness;
}

runCoreScenarios(createMikroOrmHarness());
