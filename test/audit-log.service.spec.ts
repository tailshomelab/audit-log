import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Test, TestingModule } from "@nestjs/testing";
import { TypeOrmModule } from "@nestjs/typeorm";
import { AuditLogService } from "../src/audit-log.service";
import { AuditLogEntity } from "../src/entities/audit-log.entity";
import { AUDIT_LOG_OPTIONS } from "../src/audit-log.constants";

describe("AuditLogService", () => {
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

  it("should be defined", () => {
    expect(service).toBeDefined();
  });

  it("should have static instance after init", () => {
    expect(AuditLogService.getInstance()).toBe(service);
  });

  it("should clear static instance on destroy", async () => {
    await module.close();
    expect(AuditLogService.getInstance()).toBeNull();
  });

  describe("log()", () => {
    it("should create a manual audit log entry", async () => {
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
    });

    it("should store actor info", async () => {
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
  });

  describe("getAuditLogs()", () => {
    it("should return logs for entity type/id", async () => {
      await service.log({ action: "created", entityType: "User", entityId: "user-1" });
      await service.log({ action: "updated", entityType: "User", entityId: "user-1" });
      await service.log({ action: "created", entityType: "Post", entityId: "post-1" });

      const logs = await service.getAuditLogs("User", "user-1");
      expect(logs).toHaveLength(2);
      expect(logs.every((l) => l.entityType === "User" && l.entityId === "user-1")).toBe(true);
    });

    it("should return empty array for unknown entity", async () => {
      const logs = await service.getAuditLogs("User", "non-existent");
      expect(logs).toEqual([]);
    });

    it("should return in DESC order by createdAt", async () => {
      await service.log({ action: "created", entityType: "User", entityId: "user-1" });
      await service.log({ action: "updated", entityType: "User", entityId: "user-1" });

      const logs = await service.getAuditLogs("User", "user-1");
      expect(logs).toHaveLength(2);
      const actions = logs.map((l) => l.action);
      expect(actions).toContain("created");
      expect(actions).toContain("updated");
      // Verify ordering is consistent (DESC by createdAt)
      for (let i = 0; i < logs.length - 1; i++) {
        expect(logs[i].createdAt.getTime()).toBeGreaterThanOrEqual(logs[i + 1].createdAt.getTime());
      }
    });

    it("should filter by action", async () => {
      await service.log({ action: "created", entityType: "User", entityId: "user-1" });
      await service.log({ action: "updated", entityType: "User", entityId: "user-1" });
      await service.log({ action: "deleted", entityType: "User", entityId: "user-1" });

      const logs = await service.getAuditLogs("User", "user-1", { action: "updated" });
      expect(logs).toHaveLength(1);
      expect(logs[0].action).toBe("updated");
    });

    it("should filter by date range", async () => {
      await service.log({
        action: "created",
        entityType: "User",
        entityId: "user-1",
      });

      const now = new Date();
      const future = new Date(now.getTime() + 60000);
      const past = new Date(now.getTime() - 60000);

      // All entries should be within the range
      const logsInRange = await service.getAuditLogs("User", "user-1", {
        from: past,
        to: future,
      });
      expect(logsInRange).toHaveLength(1);

      // No entries in future range
      const logsOutRange = await service.getAuditLogs("User", "user-1", {
        from: future,
      });
      expect(logsOutRange).toHaveLength(0);
    });

    it("should support limit and offset", async () => {
      await service.log({ action: "created", entityType: "User", entityId: "user-1" });
      await service.log({ action: "updated", entityType: "User", entityId: "user-1" });
      await service.log({ action: "deleted", entityType: "User", entityId: "user-1" });

      const page1 = await service.getAuditLogs("User", "user-1", { limit: 2 });
      expect(page1).toHaveLength(2);

      const page2 = await service.getAuditLogs("User", "user-1", { limit: 2, offset: 2 });
      expect(page2).toHaveLength(1);
    });
  });

  describe("getAuditLogsByActor()", () => {
    it("should return logs by actor", async () => {
      await service.log({
        action: "created",
        entityType: "User",
        entityId: "user-1",
        actor: { type: "Admin", id: "admin-1" },
      });
      await service.log({
        action: "updated",
        entityType: "Post",
        entityId: "post-1",
        actor: { type: "Admin", id: "admin-1" },
      });
      await service.log({
        action: "created",
        entityType: "User",
        entityId: "user-2",
        actor: { type: "Admin", id: "admin-2" },
      });

      const logs = await service.getAuditLogsByActor("Admin", "admin-1");
      expect(logs).toHaveLength(2);
      expect(logs.every((l) => l.actorId === "admin-1")).toBe(true);
    });

    it("should support action filter", async () => {
      await service.log({
        action: "created",
        entityType: "User",
        entityId: "user-1",
        actor: { type: "Admin", id: "admin-1" },
      });
      await service.log({
        action: "deleted",
        entityType: "User",
        entityId: "user-1",
        actor: { type: "Admin", id: "admin-1" },
      });

      const logs = await service.getAuditLogsByActor("Admin", "admin-1", { action: "deleted" });
      expect(logs).toHaveLength(1);
      expect(logs[0].action).toBe("deleted");
    });

    it("should support date range filters", async () => {
      await service.log({
        action: "created",
        entityType: "User",
        entityId: "user-1",
        actor: { type: "Admin", id: "admin-1" },
      });

      const now = new Date();
      const future = new Date(now.getTime() + 60000);

      const logs = await service.getAuditLogsByActor("Admin", "admin-1", {
        from: new Date(now.getTime() - 60000),
        to: future,
      });
      expect(logs).toHaveLength(1);

      const empty = await service.getAuditLogsByActor("Admin", "admin-1", { from: future });
      expect(empty).toHaveLength(0);
    });

    it("should support limit and offset", async () => {
      await service.log({
        action: "created",
        entityType: "User",
        entityId: "user-1",
        actor: { type: "Admin", id: "admin-1" },
      });
      await service.log({
        action: "updated",
        entityType: "User",
        entityId: "user-1",
        actor: { type: "Admin", id: "admin-1" },
      });
      await service.log({
        action: "deleted",
        entityType: "User",
        entityId: "user-1",
        actor: { type: "Admin", id: "admin-1" },
      });

      const page1 = await service.getAuditLogsByActor("Admin", "admin-1", { limit: 2 });
      expect(page1).toHaveLength(2);

      const page2 = await service.getAuditLogsByActor("Admin", "admin-1", {
        limit: 2,
        offset: 2,
      });
      expect(page2).toHaveLength(1);
    });
  });

  describe("getLatestAuditLog()", () => {
    it("should return an entry when logs exist", async () => {
      await service.log({ action: "created", entityType: "User", entityId: "user-1" });
      await service.log({ action: "updated", entityType: "User", entityId: "user-1" });

      const latest = await service.getLatestAuditLog("User", "user-1");
      expect(latest).not.toBeNull();
      expect(["created", "updated"]).toContain(latest!.action);
    });

    it("should return null when no logs exist", async () => {
      const latest = await service.getLatestAuditLog("User", "non-existent");
      expect(latest).toBeNull();
    });
  });

  describe("resolveActor()", () => {
    it("should return null when no resolver configured", async () => {
      const actor = await service.resolveActor();
      expect(actor).toBeNull();
    });
  });

  describe("getOptions()", () => {
    it("should return the module options", () => {
      const options = service.getOptions();
      expect(options).toEqual({});
    });
  });
});
