import "reflect-metadata";
import { afterEach, describe, expect, it } from "vitest";
import { Injectable, Module } from "@nestjs/common";
import { Test, type TestingModule } from "@nestjs/testing";
import { MikroOrmModule } from "@mikro-orm/nestjs";
import { MikroORM, defineConfig, defineEntity, p } from "@mikro-orm/libsql";
import { AuditLogService } from "../../src/core/audit-log.service.js";
import { AUDIT_LOG_OPTIONS } from "../../src/core/audit-log.constants.js";
import type { ActorResolver, AuditActor } from "../../src/core/interfaces/index.js";
import { MikroOrmAuditLogModule } from "../../src/mikro-orm/mikro-orm-audit-log.module.js";
import { MikroOrmAuditLogSchema } from "../../src/mikro-orm/mikro-orm-audit-log.schema.js";

const NoteSchema = defineEntity({
  name: "ModuleNote",
  tableName: "module_notes",
  properties: { id: p.integer().primary().autoincrement(), text: p.string() },
});

class StaticActor implements ActorResolver {
  resolve(): AuditActor {
    return { type: "System", id: "test" };
  }
}

@Injectable()
class ActorConfig {
  readonly actorResolver = StaticActor;
}

@Module({ providers: [ActorConfig], exports: [ActorConfig] })
class ActorConfigModule {}

const ormModule = (entities: unknown[]) =>
  MikroOrmModule.forRoot(defineConfig({ dbName: ":memory:", entities: entities as any[] }));

describe("MikroOrmAuditLogModule", () => {
  let module: TestingModule | undefined;

  afterEach(async () => {
    await module?.close();
    module = undefined;
  });

  async function boot(audit: ReturnType<typeof MikroOrmAuditLogModule.forRoot>) {
    module = await Test.createTestingModule({
      imports: [ormModule([MikroOrmAuditLogSchema]), audit],
    }).compile();
    await module.init();
    await module.get(MikroORM).schema.create();
    return module;
  }

  it("forRoot() provides the service and the options", async () => {
    const m = await boot(MikroOrmAuditLogModule.forRoot({}));
    expect(m.get(AuditLogService)).toBeInstanceOf(AuditLogService);
    expect(m.get(AUDIT_LOG_OPTIONS)).toEqual({});
  });

  it("forRootAsync() applies the factory's options, including actorResolver", async () => {
    const m = await boot(
      MikroOrmAuditLogModule.forRootAsync({
        imports: [ActorConfigModule],
        inject: [ActorConfig],
        useFactory: (config: ActorConfig) => ({
          actorResolver: config.actorResolver,
          metadata: { app: "async" },
        }),
      }),
    );
    const service = m.get(AuditLogService);
    expect(await service.resolveActor()).toEqual({ type: "System", id: "test" });
    const entry = await service.log({ action: "created", entityType: "X", entityId: "x-1" });
    expect([entry.actorType, entry.actorId, entry.metadata]).toEqual([
      "System",
      "test",
      { app: "async" },
    ]);
  });

  it("fails at startup, naming the schema, when MikroOrmAuditLogSchema is not registered", async () => {
    const compiled = await Test.createTestingModule({
      imports: [ormModule([NoteSchema]), MikroOrmAuditLogModule.forRoot({})],
    }).compile();

    await expect(compiled.init()).rejects.toThrow(/MikroOrmAuditLogSchema/);
    // close() rethrows the failed init, so the database is released directly.
    await compiled.get(MikroORM).close(true);
  });

  it("queries outside a RequestContext without a global-context error", async () => {
    const m = await boot(MikroOrmAuditLogModule.forRoot({}));
    const orm = m.get(MikroORM);
    expect(orm.config.get("allowGlobalContext")).toBe(false);

    const service = m.get(AuditLogService);
    const entry = await service.log({ action: "created", entityType: "User", entityId: "u-1" });

    expect((await service.getAuditLogs("User", "u-1")).map((r) => r.id)).toEqual([entry.id]);
    expect((await service.getAuditLogsByActor("Admin", "nobody")).length).toBe(0);
    expect((await service.getLatestAuditLog("User", "u-1"))?.id).toBe(entry.id);
  });
});
