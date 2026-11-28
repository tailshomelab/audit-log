import { describe, it, expect, beforeEach, afterEach } from "vitest";
import "reflect-metadata";
import { Test, TestingModule } from "@nestjs/testing";
import { AuditLogService } from "../../src/core/audit-log.service.js";
import { AUDIT_LOG_OPTIONS, AUDIT_LOG_STORAGE } from "../../src/core/audit-log.constants.js";
import { Auditable } from "../../src/core/decorators/auditable.decorator.js";
import { AuditableMixin } from "../../src/core/mixins/auditable.mixin.js";
import { AuditLogNotInitializedException } from "../../src/core/exceptions/audit-log-not-initialized.exception.js";
import { InMemoryAuditLogStorage } from "./in-memory-storage.js";

class BaseEntity {
  id!: string;
}

@Auditable()
class User extends AuditableMixin(BaseEntity) {
  email = "user@test.com";
}

@Auditable({ auditableType: "CustomUser" })
class CustomUser extends AuditableMixin(BaseEntity) {}

class CompositeBase {
  tenantId!: string;
  userId!: number;
}

/** A composite key: getAuditableId() is overridden to match the captured entityId. */
@Auditable()
class Membership extends AuditableMixin(CompositeBase) {
  getAuditableId(): string {
    return `${this.tenantId}:${this.userId}`;
  }
}

describe("AuditableMixin", () => {
  it("should return class name as auditableType when using default", () => {
    const user = new User();
    user.id = "user-1";
    expect(user.getAuditableType()).toBe("User");
  });

  it("should return custom auditableType", () => {
    const user = new CustomUser();
    user.id = "user-1";
    expect(user.getAuditableType()).toBe("CustomUser");
  });

  it("should return id as string", () => {
    const user = new User();
    user.id = "user-123";
    expect(user.getAuditableId()).toBe("user-123");
  });

  it("should convert numeric id to string", () => {
    const user = new User();
    (user as any).id = 42;
    expect(user.getAuditableId()).toBe("42");
  });

  it("should throw if AuditLogModule not initialized", async () => {
    expect(AuditLogService.getInstance()).toBeNull();

    const user = new User();
    user.id = "user-1";

    await expect(user.getAuditLogs()).rejects.toBeInstanceOf(AuditLogNotInitializedException);
    await expect(user.getLatestAuditLog()).rejects.toThrow("audit log is not initialized");
  });

  describe("mixin without decorator", () => {
    class PlainUser extends AuditableMixin(BaseEntity) {}

    it("should fall back to constructor name", () => {
      const user = new PlainUser();
      user.id = "user-1";
      expect(user.getAuditableType()).toBe("PlainUser");
    });
  });

  describe("with module initialized", () => {
    let module: TestingModule;
    let service: AuditLogService;

    beforeEach(async () => {
      module = await Test.createTestingModule({
        providers: [
          { provide: AUDIT_LOG_OPTIONS, useValue: {} },
          { provide: AUDIT_LOG_STORAGE, useValue: new InMemoryAuditLogStorage() },
          AuditLogService,
        ],
      }).compile();

      await module.init();
      service = module.get(AuditLogService);
    });

    afterEach(async () => {
      await module?.close();
    });

    it("getAuditLogs() should return audit logs for the entity", async () => {
      await service.log({
        action: "created",
        entityType: "User",
        entityId: "user-1",
        newValues: { name: "Alice" },
      });

      const user = new User();
      user.id = "user-1";

      const logs = await user.getAuditLogs();
      expect(logs).toHaveLength(1);
      expect(logs[0].entityType).toBe("User");
    });

    it("getLatestAuditLog() should return most recent log", async () => {
      await service.log({ action: "created", entityType: "User", entityId: "user-1" });
      await service.log({ action: "updated", entityType: "User", entityId: "user-1" });

      const user = new User();
      user.id = "user-1";

      const latest = await user.getLatestAuditLog();
      expect(latest?.action).toBe("updated");
    });

    it("getLatestAuditLog() should return null when no logs exist", async () => {
      const user = new User();
      user.id = "no-logs";

      expect(await user.getLatestAuditLog()).toBeNull();
    });

    it("getAuditLogs() should support query options", async () => {
      await service.log({ action: "created", entityType: "User", entityId: "user-1" });
      await service.log({ action: "updated", entityType: "User", entityId: "user-1" });

      const user = new User();
      user.id = "user-1";

      const logs = await user.getAuditLogs({ action: "created" });
      expect(logs).toHaveLength(1);
      expect(logs[0].action).toBe("created");
    });

    it("uses an overridden getAuditableId() for composite keys", async () => {
      await service.log({ action: "created", entityType: "Membership", entityId: "acme:7" });

      const membership = new Membership();
      membership.tenantId = "acme";
      membership.userId = 7;

      expect((await membership.getAuditLogs()).map((l) => l.entityId)).toEqual(["acme:7"]);
      expect((await membership.getLatestAuditLog())?.entityId).toBe("acme:7");
    });

    it("stops resolving the service after the module is closed", async () => {
      await module.close();
      const user = new User();
      user.id = "user-1";

      await expect(user.getAuditLogs()).rejects.toBeInstanceOf(AuditLogNotInitializedException);
    });
  });
});
