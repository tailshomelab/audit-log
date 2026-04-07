import { describe, it, expect, beforeEach, afterEach } from "vitest";
import "reflect-metadata";
import { Test, TestingModule } from "@nestjs/testing";
import { TypeOrmModule } from "@nestjs/typeorm";
import { AuditLogModule } from "../src/audit-log.module";
import { AuditLogService } from "../src/audit-log.service";
import { AuditLogEntity } from "../src/entities/audit-log.entity";
import { Auditable } from "../src/decorators/auditable.decorator";
import { AuditableMixin } from "../src/mixins/auditable.mixin";

class BaseEntity {
  id!: string;
}

@Auditable()
class User extends AuditableMixin(BaseEntity) {
  email = "user@test.com";
}

@Auditable({ auditableType: "CustomUser" })
class CustomUser extends AuditableMixin(BaseEntity) {}

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
    (AuditLogService as any).instance = null;

    const user = new User();
    user.id = "user-1";

    await expect(user.getAuditLogs()).rejects.toThrow("AuditLogModule has not been initialized");
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
      service = module.get<AuditLogService>(AuditLogService);
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
      await service.log({
        action: "created",
        entityType: "User",
        entityId: "user-1",
      });

      const user = new User();
      user.id = "user-1";

      const latest = await user.getLatestAuditLog();
      expect(latest).not.toBeNull();
      expect(latest!.action).toBe("created");
    });

    it("getLatestAuditLog() should return null when no logs exist", async () => {
      const user = new User();
      user.id = "no-logs";

      const latest = await user.getLatestAuditLog();
      expect(latest).toBeNull();
    });

    it("getAuditLogs() should support query options", async () => {
      await service.log({
        action: "created",
        entityType: "User",
        entityId: "user-1",
      });
      await service.log({
        action: "updated",
        entityType: "User",
        entityId: "user-1",
      });

      const user = new User();
      user.id = "user-1";

      const logs = await user.getAuditLogs({ action: "created" });
      expect(logs).toHaveLength(1);
      expect(logs[0].action).toBe("created");
    });
  });
});
