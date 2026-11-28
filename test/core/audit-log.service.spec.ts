import { describe, it, expect, afterEach, vi } from "vitest";
import { EventEmitter2, EventEmitterModule } from "@nestjs/event-emitter";
import type { DynamicModule, Provider } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import { AuditLogService } from "../../src/core/audit-log.service.js";
import {
  AUDIT_LOG_ACTOR_RESOLVER,
  AUDIT_LOG_OPTIONS,
  AUDIT_LOG_STORAGE,
} from "../../src/core/audit-log.constants.js";
import { AUDIT_LOG_EVENTS } from "../../src/core/events/audit-log.events.js";
import type { ActorResolver, AuditLogModuleOptions } from "../../src/core/interfaces/index.js";
import { InMemoryAuditLogStorage } from "./in-memory-storage.js";

let module: TestingModule | undefined;

async function setup(
  options: AuditLogModuleOptions = {},
  extra: Provider[] = [],
  imports: DynamicModule[] = [],
) {
  const storage = new InMemoryAuditLogStorage();
  module = await Test.createTestingModule({
    imports,
    providers: [
      { provide: AUDIT_LOG_OPTIONS, useValue: options },
      { provide: AUDIT_LOG_STORAGE, useValue: storage },
      ...extra,
      AuditLogService,
    ],
  }).compile();
  await module.init();
  return { service: module.get(AuditLogService), storage, module };
}

afterEach(async () => {
  await module?.close();
  module = undefined;
});

describe("AuditLogService", () => {
  it("should be defined", async () => {
    const { service } = await setup();
    expect(service).toBeDefined();
  });

  it("should have static instance after init", async () => {
    const { service } = await setup();
    expect(AuditLogService.getInstance()).toBe(service);
  });

  it("should clear static instance on destroy", async () => {
    const { module: m } = await setup();
    await m.close();
    expect(AuditLogService.getInstance()).toBeNull();
  });

  describe("log()", () => {
    it("should create a manual audit log entry", async () => {
      const { service, storage } = await setup();
      const entry = await service.log({
        action: "created",
        entityType: "User",
        entityId: "user-1",
        newValues: { name: "Alice" },
      });

      expect(entry.id).toBeDefined();
      expect(entry.action).toBe("created");
      expect(entry.entityType).toBe("User");
      expect(entry.entityId).toBe("user-1");
      expect(entry.newValues).toEqual({ name: "Alice" });
      expect(entry.oldValues).toBeNull();
      expect(storage.records).toEqual([entry]);
    });

    it("should store actor info", async () => {
      const { service } = await setup();
      const entry = await service.log({
        action: "updated",
        entityType: "Post",
        entityId: "post-1",
        actor: { type: "Admin", id: "admin-1" },
        oldValues: { title: "Old" },
        newValues: { title: "New" },
      });

      expect(entry.actorType).toBe("Admin");
      expect(entry.actorId).toBe("admin-1");
    });

    it("should store metadata, ipAddress, userAgent", async () => {
      const { service } = await setup();
      const entry = await service.log({
        action: "deleted",
        entityType: "User",
        entityId: "user-1",
        metadata: { reason: "GDPR" },
        ipAddress: "10.0.0.1",
        userAgent: "TestAgent/1.0",
      });

      expect(entry.metadata).toEqual({ reason: "GDPR" });
      expect(entry.ipAddress).toBe("10.0.0.1");
      expect(entry.userAgent).toBe("TestAgent/1.0");
    });

    it("passes a complete draft to the storage", async () => {
      const { service, storage } = await setup();
      const save = vi.spyOn(storage, "save");
      await service.log({ action: "created", entityType: "User", entityId: "user-1" });

      expect(save).toHaveBeenCalledWith({
        action: "created",
        entityType: "User",
        entityId: "user-1",
        oldValues: null,
        newValues: null,
        actorType: null,
        actorId: null,
        metadata: null,
        ipAddress: null,
        userAgent: null,
      });
    });
  });

  describe("queries", () => {
    it("delegates queries to the storage", async () => {
      const { service, storage } = await setup();
      const byEntity = vi.spyOn(storage, "findByEntity");
      const byActor = vi.spyOn(storage, "findByActor");
      const latest = vi.spyOn(storage, "findLatest");
      const query = { action: "updated" as const, limit: 5, offset: 1 };

      await service.getAuditLogs("User", "user-1", query);
      await service.getAuditLogsByActor("Admin", "admin-1", query);
      await service.getLatestAuditLog("User", "user-1");

      expect(byEntity).toHaveBeenCalledWith("User", "user-1", query);
      expect(byActor).toHaveBeenCalledWith("Admin", "admin-1", query);
      expect(latest).toHaveBeenCalledWith("User", "user-1");
    });
  });

  describe("resolveActor()", () => {
    it("should return null when no resolver configured", async () => {
      const { service } = await setup();
      expect(await service.resolveActor()).toBeNull();
    });
  });

  describe("getOptions()", () => {
    it("should return the module options", async () => {
      const { service } = await setup();
      expect(service.getOptions()).toEqual({});
    });
  });
});

describe("AuditLogService (advanced)", () => {
  describe("with EventEmitter", () => {
    it("should emit audit.logged event on log()", async () => {
      const emit = vi.fn().mockReturnValue(true);
      const { service } = await setup({}, [{ provide: EventEmitter2, useValue: { emit } }]);

      const entry = await service.log({
        action: "created",
        entityType: "User",
        entityId: "user-1",
      });

      expect(emit).toHaveBeenCalledTimes(1);
      expect(emit).toHaveBeenCalledWith(AUDIT_LOG_EVENTS.LOGGED, { auditLog: entry });
    });

    it("notifyLogged() emits audit.logged with the given record", async () => {
      const emit = vi.fn().mockReturnValue(true);
      const { service, storage } = await setup({}, [
        { provide: EventEmitter2, useValue: { emit } },
      ]);
      const record = await storage.save({
        action: "created",
        entityType: "User",
        entityId: "user-1",
        oldValues: null,
        newValues: null,
        actorType: null,
        actorId: null,
        metadata: null,
        ipAddress: null,
        userAgent: null,
      });

      service.notifyLogged(record);

      expect(emit).toHaveBeenCalledWith(AUDIT_LOG_EVENTS.LOGGED, { auditLog: record });
    });
  });

  describe("with ActorResolver", () => {
    const resolver: ActorResolver = { resolve: () => ({ type: "User", id: "resolved-user-1" }) };
    const providers = [{ provide: AUDIT_LOG_ACTOR_RESOLVER, useValue: resolver }];

    it("should include actor from resolver when no explicit actor", async () => {
      const { service } = await setup({}, providers);
      const entry = await service.log({
        action: "created",
        entityType: "User",
        entityId: "user-1",
      });

      expect(entry.actorType).toBe("User");
      expect(entry.actorId).toBe("resolved-user-1");
    });

    it("should prefer explicit actor over resolver", async () => {
      const { service } = await setup({}, providers);
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
      const { service } = await setup(
        { defaultActor: { type: "System", id: "system" } },
        providers,
      );
      expect(await service.resolveActor()).toEqual({ type: "User", id: "resolved-user-1" });
    });
  });

  describe("with null ActorResolver", () => {
    it("should handle resolver returning null gracefully", async () => {
      const { service } = await setup({}, [
        { provide: AUDIT_LOG_ACTOR_RESOLVER, useValue: { resolve: () => null } },
      ]);
      const entry = await service.log({
        action: "created",
        entityType: "User",
        entityId: "user-1",
      });

      expect(entry.actorType).toBeNull();
      expect(entry.actorId).toBeNull();
    });

    it("falls back to defaultActor when the resolver provider is null", async () => {
      const { service } = await setup({ defaultActor: { type: "System", id: "system" } }, [
        { provide: AUDIT_LOG_ACTOR_RESOLVER, useValue: null },
      ]);
      expect(await service.resolveActor()).toEqual({ type: "System", id: "system" });
    });
  });

  describe("with async ActorResolver", () => {
    const providers = [
      {
        provide: AUDIT_LOG_ACTOR_RESOLVER,
        useValue: { resolve: () => Promise.resolve({ type: "AsyncUser", id: "async-1" }) },
      },
    ];

    it("should handle async resolver that returns a Promise", async () => {
      const { service } = await setup({}, providers);
      const entry = await service.log({
        action: "created",
        entityType: "User",
        entityId: "user-1",
      });

      expect(entry.actorType).toBe("AsyncUser");
      expect(entry.actorId).toBe("async-1");
    });

    it("resolveActor() should await the promise", async () => {
      const { service } = await setup({}, providers);
      expect(await service.resolveActor()).toEqual({ type: "AsyncUser", id: "async-1" });
    });
  });

  describe("with defaultActor", () => {
    const options = { defaultActor: { type: "System", id: "system" } };

    it("should use defaultActor when no resolver configured", async () => {
      const { service } = await setup(options);
      expect(await service.resolveActor()).toEqual({ type: "System", id: "system" });
    });

    it("should use defaultActor in log() when no explicit actor", async () => {
      const { service } = await setup(options);
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
    const options = { metadata: { app: "test-app", version: "1.0" } };

    it("should use module metadata when no explicit metadata", async () => {
      const { service } = await setup(options);
      const entry = await service.log({
        action: "created",
        entityType: "User",
        entityId: "user-1",
      });
      expect(entry.metadata).toEqual({ app: "test-app", version: "1.0" });
    });

    it("should prefer explicit metadata over module metadata", async () => {
      const { service } = await setup(options);
      const entry = await service.log({
        action: "created",
        entityType: "User",
        entityId: "user-1",
        metadata: { custom: true },
      });
      expect(entry.metadata).toEqual({ custom: true });
    });
  });

  describe("with EventEmitterModule", () => {
    it("emits audit.logged through the EventEmitter2 that EventEmitterModule.forRoot() provides", async () => {
      const { service, module: m } = await setup({}, [], [EventEmitterModule.forRoot()]);
      const listener = vi.fn();
      m.get(EventEmitter2).on(AUDIT_LOG_EVENTS.LOGGED, listener);

      const entry = await service.log({ action: "created", entityType: "User", entityId: "u-1" });

      expect(listener).toHaveBeenCalledTimes(1);
      expect(listener).toHaveBeenCalledWith({ auditLog: entry });
    });
  });

  describe("without EventEmitter", () => {
    it("should work without EventEmitter2 (no error)", async () => {
      const { service } = await setup();
      const entry = await service.log({
        action: "created",
        entityType: "User",
        entityId: "user-1",
      });
      expect(entry.id).toBeDefined();
    });
  });
});
