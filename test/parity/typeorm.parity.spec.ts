import "reflect-metadata";
import { Test, type TestingModule } from "@nestjs/testing";
import { TypeOrmModule } from "@nestjs/typeorm";
import {
  DataSource,
  EntitySchema,
  In,
  type DeepPartial,
  type EntitySchemaColumnOptions,
} from "typeorm";
import { TypeOrmAuditLogEntity } from "../../src/typeorm/typeorm-audit-log.entity.js";
import { TypeOrmAuditLogModule } from "../../src/typeorm/typeorm-audit-log.module.js";
import {
  PARITY_FIXTURES,
  eventEmitterModule,
  type AdapterHarness,
  type Constructor,
  type ParityFixture,
} from "./harness.js";
import { runCoreScenarios } from "./core-scenarios.js";

function toEntitySchema(fixture: ParityFixture): EntitySchema {
  const columns: Record<string, EntitySchemaColumnOptions> = {
    id: { type: "uuid", primary: true, generated: "uuid" },
  };
  for (const [property, kind] of Object.entries(fixture.columns)) {
    columns[property] = { type: "varchar", nullable: kind === "nullable-string" };
  }
  if (fixture.timestamps) {
    columns.createdAt = { type: "datetime", createDate: true, name: "created_at" };
    columns.updatedAt = { type: "datetime", updateDate: true, name: "updated_at" };
  }
  return new EntitySchema({
    name: fixture.target.name,
    target: fixture.target,
    tableName: fixture.tableName,
    columns,
  });
}

const entitySchemas = (): EntitySchema[] => PARITY_FIXTURES.map(toEntitySchema);

function createTypeOrmHarness(): AdapterHarness {
  let module: TestingModule | undefined;

  const dataSource = (): DataSource => {
    if (!module) throw new Error("harness not bootstrapped");
    return module.get(DataSource);
  };

  const harness: AdapterHarness = {
    name: "TypeORM",

    defineAuditableFixtures: entitySchemas,

    async bootstrap({ options = {}, async, emitter } = {}) {
      module = await Test.createTestingModule({
        imports: [
          TypeOrmModule.forRoot({
            type: "better-sqlite3",
            database: ":memory:",
            entities: [TypeOrmAuditLogEntity, ...entitySchemas()],
            synchronize: true,
          }),
          async
            ? TypeOrmAuditLogModule.forRootAsync({ useFactory: () => options })
            : TypeOrmAuditLogModule.forRoot(options),
          ...(emitter ? [eventEmitterModule(emitter)] : []),
        ],
      }).compile();
      await module.init();
      return module;
    },

    async insert<T extends object>(target: Constructor<T>, data: Partial<T>): Promise<T> {
      const repository = dataSource().getRepository<T>(target);
      return repository.save(repository.create(data as DeepPartial<T>));
    },

    async update(entity, changes) {
      Object.assign(entity, changes);
      return dataSource().manager.save(entity);
    },

    async remove(entity) {
      await dataSource().manager.remove(entity);
    },

    async updateUnloaded(target, id, changes) {
      const repository = dataSource().getRepository(target);
      await repository.save(repository.create({ id, ...changes } as DeepPartial<typeof changes>));
    },

    async transaction(work) {
      await dataSource().transaction(async (manager) => {
        await work((target, data) => manager.save(manager.create(target, data as any)));
      });
    },

    async listAuditRows() {
      const ordered: Array<{ id: string }> = await dataSource().query(
        "SELECT id FROM audit_logs ORDER BY rowid",
      );
      const ids = ordered.map((row) => row.id);
      const rows = await dataSource()
        .getRepository(TypeOrmAuditLogEntity)
        .findBy({ id: In(ids) });
      return rows.sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id));
    },

    async setCreatedAt(id, createdAt) {
      await dataSource().getRepository(TypeOrmAuditLogEntity).update(id, { createdAt });
    },

    async dropAuditTable() {
      await dataSource().query("DROP TABLE audit_logs");
    },

    async close() {
      await module?.close();
      module = undefined;
    },
  };
  return harness;
}

runCoreScenarios(createTypeOrmHarness());
