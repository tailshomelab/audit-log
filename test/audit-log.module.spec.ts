import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Test, TestingModule } from "@nestjs/testing";
import { TypeOrmModule } from "@nestjs/typeorm";
import { AuditLogModule } from "../src/audit-log.module";
import { AuditLogService } from "../src/audit-log.service";
import { AuditLogEntity } from "../src/entities/audit-log.entity";
import { AUDIT_LOG_OPTIONS } from "../src/audit-log.constants";
import type { ActorResolver, AuditActor } from "../src/interfaces/actor-resolver.interface";

describe("AuditLogModule", () => {
  describe("forRoot()", () => {
    let module: TestingModule;

    beforeEach(async () => {
      module = await Test.createTestingModule({
        imports: [
          TypeOrmModule.forRoot({
            type: "better-sqlite3",
            database: ":memory:",
            entities: [AuditLogEntity],
            synchronize: true,
          }),
          AuditLogModule.forRoot({}),
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
            entities: [AuditLogEntity],
            synchronize: true,
          }),
          AuditLogModule.forRoot({ actorResolver: TestActorResolver }),
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
            entities: [AuditLogEntity],
            synchronize: true,
          }),
          AuditLogModule.forRoot({
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
            entities: [AuditLogEntity],
            synchronize: true,
          }),
          AuditLogModule.forRootAsync({
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
            entities: [AuditLogEntity],
            synchronize: true,
          }),
          {
            module: class ConfigModule {},
            providers: [{ provide: CONFIG_TOKEN, useValue: { excludedFields: ["secret"] } }],
            exports: [CONFIG_TOKEN],
            global: true,
          },
          AuditLogModule.forRootAsync({
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
            entities: [AuditLogEntity],
            synchronize: true,
          }),
          AuditLogModule.forRootAsync({
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
            entities: [AuditLogEntity],
            synchronize: true,
          }),
          AuditLogModule.forRoot(),
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
