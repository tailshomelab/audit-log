import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Test, TestingModule } from "@nestjs/testing";
import { TypeOrmModule } from "@nestjs/typeorm";
import { TypeOrmAuditLogModule } from "../../src/typeorm/typeorm-audit-log.module.js";
import { TypeOrmAuditLogEntity } from "../../src/typeorm/typeorm-audit-log.entity.js";
import { AuditLogService } from "../../src/core/audit-log.service.js";
import { AUDIT_LOG_OPTIONS } from "../../src/core/audit-log.constants.js";
import type {
  ActorResolver,
  AuditActor,
} from "../../src/core/interfaces/actor-resolver.interface.js";

describe("TypeOrmAuditLogModule", () => {
  describe("forRoot()", () => {
    let module: TestingModule;

    beforeEach(async () => {
      module = await Test.createTestingModule({
        imports: [
          TypeOrmModule.forRoot({
            type: "better-sqlite3",
            database: ":memory:",
            entities: [TypeOrmAuditLogEntity],
            synchronize: true,
          }),
          TypeOrmAuditLogModule.forRoot({}),
        ],
      }).compile();

      await module.init();
    });

    afterEach(async () => {
      await module?.close();
    });

    it("should provide AuditLogService", () => {
      const service = module.get<AuditLogService>(AuditLogService);
      expect(service).toBeDefined();
    });

    it("should export AUDIT_LOG_OPTIONS", () => {
      const options = module.get(AUDIT_LOG_OPTIONS);
      expect(options).toEqual({});
    });
  });

  describe("forRoot() with actorResolver", () => {
    let module: TestingModule;

    class TestActorResolver implements ActorResolver {
      resolve(): AuditActor | null {
        return { type: "System", id: "test" };
      }
    }

    beforeEach(async () => {
      module = await Test.createTestingModule({
        imports: [
          TypeOrmModule.forRoot({
            type: "better-sqlite3",
            database: ":memory:",
            entities: [TypeOrmAuditLogEntity],
            synchronize: true,
          }),
          TypeOrmAuditLogModule.forRoot({ actorResolver: TestActorResolver }),
        ],
      }).compile();

      await module.init();
    });

    afterEach(async () => {
      await module?.close();
    });

    it("should register the actor resolver", async () => {
      const service = module.get<AuditLogService>(AuditLogService);
      const actor = await service.resolveActor();
      expect(actor).toEqual({ type: "System", id: "test" });
    });
  });

  describe("forRoot() with options", () => {
    let module: TestingModule;

    beforeEach(async () => {
      module = await Test.createTestingModule({
        imports: [
          TypeOrmModule.forRoot({
            type: "better-sqlite3",
            database: ":memory:",
            entities: [TypeOrmAuditLogEntity],
            synchronize: true,
          }),
          TypeOrmAuditLogModule.forRoot({
            globalExcludedFields: ["password"],
            disabledActions: ["deleted"],
            defaultActor: { type: "System", id: "system" },
          }),
        ],
      }).compile();

      await module.init();
    });

    afterEach(async () => {
      await module?.close();
    });

    it("should store options correctly", () => {
      const service = module.get<AuditLogService>(AuditLogService);
      const options = service.getOptions();
      expect(options.globalExcludedFields).toEqual(["password"]);
      expect(options.disabledActions).toEqual(["deleted"]);
      expect(options.defaultActor).toEqual({ type: "System", id: "system" });
    });
  });

  describe("forRootAsync()", () => {
    let module: TestingModule;

    beforeEach(async () => {
      module = await Test.createTestingModule({
        imports: [
          TypeOrmModule.forRoot({
            type: "better-sqlite3",
            database: ":memory:",
            entities: [TypeOrmAuditLogEntity],
            synchronize: true,
          }),
          TypeOrmAuditLogModule.forRootAsync({
            useFactory: () => ({
              globalExcludedFields: ["token"],
            }),
          }),
        ],
      }).compile();

      await module.init();
    });

    afterEach(async () => {
      await module?.close();
    });

    it("should provide AuditLogService", () => {
      const service = module.get<AuditLogService>(AuditLogService);
      expect(service).toBeDefined();
    });

    it("should resolve options from factory", () => {
      const service = module.get<AuditLogService>(AuditLogService);
      const options = service.getOptions();
      expect(options.globalExcludedFields).toEqual(["token"]);
    });
  });

  describe("forRootAsync() with inject", () => {
    let module: TestingModule;
    const CONFIG_TOKEN = "CONFIG_TOKEN";

    beforeEach(async () => {
      module = await Test.createTestingModule({
        imports: [
          TypeOrmModule.forRoot({
            type: "better-sqlite3",
            database: ":memory:",
            entities: [TypeOrmAuditLogEntity],
            synchronize: true,
          }),
          {
            module: class ConfigModule {},
            providers: [{ provide: CONFIG_TOKEN, useValue: { excludedFields: ["secret"] } }],
            exports: [CONFIG_TOKEN],
            global: true,
          },
          TypeOrmAuditLogModule.forRootAsync({
            inject: [CONFIG_TOKEN],
            useFactory: (config: any) => ({
              globalExcludedFields: config.excludedFields,
            }),
          }),
        ],
      }).compile();

      await module.init();
    });

    afterEach(async () => {
      await module?.close();
    });

    it("should support inject option", () => {
      const service = module.get<AuditLogService>(AuditLogService);
      const options = service.getOptions();
      expect(options.globalExcludedFields).toEqual(["secret"]);
    });
  });

  describe("forRootAsync() with actorResolver in options", () => {
    let module: TestingModule;

    class AsyncActorResolver implements ActorResolver {
      resolve(): AuditActor | null {
        return { type: "Admin", id: "admin-async" };
      }
    }

    beforeEach(async () => {
      module = await Test.createTestingModule({
        imports: [
          TypeOrmModule.forRoot({
            type: "better-sqlite3",
            database: ":memory:",
            entities: [TypeOrmAuditLogEntity],
            synchronize: true,
          }),
          TypeOrmAuditLogModule.forRootAsync({
            useFactory: () => ({
              actorResolver: AsyncActorResolver,
            }),
          }),
        ],
      }).compile();

      await module.init();
    });

    afterEach(async () => {
      await module?.close();
    });

    it("should resolve actor from async options", async () => {
      const service = module.get<AuditLogService>(AuditLogService);
      const actor = await service.resolveActor();
      expect(actor).toEqual({ type: "Admin", id: "admin-async" });
    });
  });

  describe("forRoot() with no options", () => {
    let module: TestingModule;

    beforeEach(async () => {
      module = await Test.createTestingModule({
        imports: [
          TypeOrmModule.forRoot({
            type: "better-sqlite3",
            database: ":memory:",
            entities: [TypeOrmAuditLogEntity],
            synchronize: true,
          }),
          TypeOrmAuditLogModule.forRoot(),
        ],
      }).compile();

      await module.init();
    });

    afterEach(async () => {
      await module?.close();
    });

    it("should work with default empty options", () => {
      const service = module.get<AuditLogService>(AuditLogService);
      expect(service).toBeDefined();
      expect(service.getOptions()).toEqual({});
    });
  });
});
