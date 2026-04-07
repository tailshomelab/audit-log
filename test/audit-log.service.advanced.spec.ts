import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { Test, TestingModule } from "@nestjs/testing";
import { TypeOrmModule } from "@nestjs/typeorm";
import { AuditLogService } from "../src/audit-log.service";
import { AuditLogEntity } from "../src/entities/audit-log.entity";
import { AUDIT_LOG_OPTIONS } from "../src/audit-log.constants";
import { AUDIT_LOG_EVENTS } from "../src/events/audit-log.events";
import type { ActorResolver } from "../src/interfaces/actor-resolver.interface";

describe("AuditLogService (advanced)", () => {
  describe("with EventEmitter", () => {
    let module: TestingModule;
    let service: AuditLogService;
    let emitMock: ReturnType<typeof vi.fn>;

    beforeEach(async () => {
      emitMock = vi.fn().mockReturnValue(true);

      module = await Test.createTestingModule({
        imports: [
          TypeOrmModule.forRoot({
            type: "better-sqlite3",
            database: ":memory:",
            entities: [AuditLogEntity],
            synchronize: true,
          }),
          TypeOrmModule.forFeature([AuditLogEntity]),
        ],
        providers: [
          { provide: AUDIT_LOG_OPTIONS, useValue: {} },
          { provide: "EventEmitter2", useValue: { emit: emitMock } },
          AuditLogService,
        ],
      }).compile();

      await module.init();
      service = module.get<AuditLogService>(AuditLogService);
    });

    afterEach(async () => {
      await module?.close();
    });

    it("should emit audit.logged event on log()", async () => {
      await service.log({
        action: "created",
        entityType: "User",
        entityId: "user-1",
      });

      expect(emitMock).toHaveBeenCalledWith(
        AUDIT_LOG_EVENTS.LOGGED,
        expect.objectContaining({
          auditLog: expect.objectContaining({
            action: "created",
            entityType: "User",
            entityId: "user-1",
          }),
        }),
      );
    });
  });

  describe("with ActorResolver", () => {
    let module: TestingModule;
    let service: AuditLogService;

    const mockResolver: ActorResolver = {
      resolve: () => ({ type: "User", id: "resolved-user-1" }),
    };

    beforeEach(async () => {
      module = await Test.createTestingModule({
        imports: [
          TypeOrmModule.forRoot({
            type: "better-sqlite3",
            database: ":memory:",
            entities: [AuditLogEntity],
            synchronize: true,
          }),
          TypeOrmModule.forFeature([AuditLogEntity]),
        ],
        providers: [
          { provide: AUDIT_LOG_OPTIONS, useValue: {} },
          { provide: "ActorResolver", useValue: mockResolver },
          AuditLogService,
        ],
      }).compile();

      await module.init();
      service = module.get<AuditLogService>(AuditLogService);
    });

    afterEach(async () => {
      await module?.close();
    });

    it("should include actor from resolver when no explicit actor", async () => {
      const entry = await service.log({
        action: "created",
        entityType: "User",
        entityId: "user-1",
      });

      expect(entry.actorType).toBe("User");
      expect(entry.actorId).toBe("resolved-user-1");
    });

    it("should prefer explicit actor over resolver", async () => {
      const entry = await service.log({
        action: "created",
        entityType: "User",
        entityId: "user-1",
        actor: { type: "Admin", id: "admin-1" },
      });

      expect(entry.actorType).toBe("Admin");
      expect(entry.actorId).toBe("admin-1");
    });

    it("resolveActor() should return from resolver", async () => {
      const actor = await service.resolveActor();
      expect(actor).toEqual({ type: "User", id: "resolved-user-1" });
    });
  });

  describe("with null ActorResolver", () => {
    let module: TestingModule;
    let service: AuditLogService;

    const nullResolver: ActorResolver = {
      resolve: () => null,
    };

    beforeEach(async () => {
      module = await Test.createTestingModule({
        imports: [
          TypeOrmModule.forRoot({
            type: "better-sqlite3",
            database: ":memory:",
            entities: [AuditLogEntity],
            synchronize: true,
          }),
          TypeOrmModule.forFeature([AuditLogEntity]),
        ],
        providers: [
          { provide: AUDIT_LOG_OPTIONS, useValue: {} },
          { provide: "ActorResolver", useValue: nullResolver },
          AuditLogService,
        ],
      }).compile();

      await module.init();
      service = module.get<AuditLogService>(AuditLogService);
    });

    afterEach(async () => {
      await module?.close();
    });

    it("should handle resolver returning null gracefully", async () => {
      const entry = await service.log({
        action: "created",
        entityType: "User",
        entityId: "user-1",
      });

      expect(entry.actorType).toBeNull();
      expect(entry.actorId).toBeNull();
    });
  });

  describe("with async ActorResolver", () => {
    let module: TestingModule;
    let service: AuditLogService;

    const asyncResolver: ActorResolver = {
      resolve: () => Promise.resolve({ type: "AsyncUser", id: "async-1" }),
    };

    beforeEach(async () => {
      module = await Test.createTestingModule({
        imports: [
          TypeOrmModule.forRoot({
            type: "better-sqlite3",
            database: ":memory:",
            entities: [AuditLogEntity],
            synchronize: true,
          }),
          TypeOrmModule.forFeature([AuditLogEntity]),
        ],
        providers: [
          { provide: AUDIT_LOG_OPTIONS, useValue: {} },
          { provide: "ActorResolver", useValue: asyncResolver },
          AuditLogService,
        ],
      }).compile();

      await module.init();
      service = module.get<AuditLogService>(AuditLogService);
    });

    afterEach(async () => {
      await module?.close();
    });

    it("should handle async resolver that returns a Promise", async () => {
      const entry = await service.log({
        action: "created",
        entityType: "User",
        entityId: "user-1",
      });

      expect(entry.actorType).toBe("AsyncUser");
      expect(entry.actorId).toBe("async-1");
    });

    it("resolveActor() should await the promise", async () => {
      const actor = await service.resolveActor();
      expect(actor).toEqual({ type: "AsyncUser", id: "async-1" });
    });
  });

  describe("with defaultActor", () => {
    let module: TestingModule;
    let service: AuditLogService;

    beforeEach(async () => {
      module = await Test.createTestingModule({
        imports: [
          TypeOrmModule.forRoot({
            type: "better-sqlite3",
            database: ":memory:",
            entities: [AuditLogEntity],
            synchronize: true,
          }),
          TypeOrmModule.forFeature([AuditLogEntity]),
        ],
        providers: [
          {
            provide: AUDIT_LOG_OPTIONS,
            useValue: { defaultActor: { type: "System", id: "system" } },
          },
          AuditLogService,
        ],
      }).compile();

      await module.init();
      service = module.get<AuditLogService>(AuditLogService);
    });

    afterEach(async () => {
      await module?.close();
    });

    it("should use defaultActor when no resolver configured", async () => {
      const actor = await service.resolveActor();
      expect(actor).toEqual({ type: "System", id: "system" });
    });

    it("should use defaultActor in log() when no explicit actor", async () => {
      const entry = await service.log({
        action: "created",
        entityType: "User",
        entityId: "user-1",
      });

      expect(entry.actorType).toBe("System");
      expect(entry.actorId).toBe("system");
    });
  });

  describe("with module metadata", () => {
    let module: TestingModule;
    let service: AuditLogService;

    beforeEach(async () => {
      module = await Test.createTestingModule({
        imports: [
          TypeOrmModule.forRoot({
            type: "better-sqlite3",
            database: ":memory:",
            entities: [AuditLogEntity],
            synchronize: true,
          }),
          TypeOrmModule.forFeature([AuditLogEntity]),
        ],
        providers: [
          {
            provide: AUDIT_LOG_OPTIONS,
            useValue: { metadata: { app: "test-app", version: "1.0" } },
          },
          AuditLogService,
        ],
      }).compile();

      await module.init();
      service = module.get<AuditLogService>(AuditLogService);
    });

    afterEach(async () => {
      await module?.close();
    });

    it("should use module metadata when no explicit metadata", async () => {
      const entry = await service.log({
        action: "created",
        entityType: "User",
        entityId: "user-1",
      });

      expect(entry.metadata).toEqual({ app: "test-app", version: "1.0" });
    });

    it("should prefer explicit metadata over module metadata", async () => {
      const entry = await service.log({
        action: "created",
        entityType: "User",
        entityId: "user-1",
        metadata: { custom: true },
      });

      expect(entry.metadata).toEqual({ custom: true });
    });
  });

  describe("without EventEmitter", () => {
    let module: TestingModule;
    let service: AuditLogService;

    beforeEach(async () => {
      module = await Test.createTestingModule({
        imports: [
          TypeOrmModule.forRoot({
            type: "better-sqlite3",
            database: ":memory:",
            entities: [AuditLogEntity],
            synchronize: true,
          }),
          TypeOrmModule.forFeature([AuditLogEntity]),
        ],
        providers: [{ provide: AUDIT_LOG_OPTIONS, useValue: {} }, AuditLogService],
      }).compile();

      await module.init();
      service = module.get<AuditLogService>(AuditLogService);
    });

    afterEach(async () => {
      await module?.close();
    });

    it("should work without EventEmitter2 (no error)", async () => {
      const entry = await service.log({
        action: "created",
        entityType: "User",
        entityId: "user-1",
      });

      expect(entry.id).toBeDefined();
    });
  });
});
