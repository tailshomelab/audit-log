import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { DataSource, Repository } from "typeorm";
import { AuditLogEntity } from "../src/entities/audit-log.entity";

describe("AuditLogEntity", () => {
  let dataSource: DataSource;
  let repo: Repository<AuditLogEntity>;

  beforeEach(async () => {
    dataSource = new DataSource({
      type: "better-sqlite3",
      database: ":memory:",
      entities: [AuditLogEntity],
      synchronize: true,
    });
    await dataSource.initialize();
    repo = dataSource.getRepository(AuditLogEntity);
  });

  afterEach(async () => {
    await dataSource?.destroy();
  });

  it("should create and persist an audit log entry", async () => {
    const entry = repo.create({
      action: "created",
      entityType: "User",
      entityId: "user-1",
      actorType: "User",
      actorId: "admin-1",
      oldValues: null,
      newValues: { name: "Alice" },
      metadata: null,
      ipAddress: null,
      userAgent: null,
    });

    const saved = await repo.save(entry);
    expect(saved.id).toBeDefined();
    expect(saved.action).toBe("created");
    expect(saved.entityType).toBe("User");
    expect(saved.entityId).toBe("user-1");
  });

  it("should auto-generate UUID id", async () => {
    const entry = repo.create({
      action: "created",
      entityType: "Post",
      entityId: "post-1",
    });
    const saved = await repo.save(entry);
    expect(saved.id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("should auto-set createdAt", async () => {
    const before = new Date();
    const entry = repo.create({
      action: "updated",
      entityType: "User",
      entityId: "user-1",
    });
    const saved = await repo.save(entry);
    expect(saved.createdAt).toBeInstanceOf(Date);
    expect(saved.createdAt.getTime()).toBeGreaterThanOrEqual(before.getTime() - 1000);
  });

  it("should store and retrieve oldValues as JSON", async () => {
    const entry = repo.create({
      action: "updated",
      entityType: "User",
      entityId: "user-1",
      oldValues: { name: "Alice", age: 25 },
      newValues: { name: "Bob", age: 30 },
    });
    const saved = await repo.save(entry);
    const found = await repo.findOneBy({ id: saved.id });
    expect(found!.oldValues).toEqual({ name: "Alice", age: 25 });
    expect(found!.newValues).toEqual({ name: "Bob", age: 30 });
  });

  it("should store and retrieve metadata as JSON", async () => {
    const entry = repo.create({
      action: "deleted",
      entityType: "User",
      entityId: "user-1",
      metadata: { reason: "GDPR request", requestId: "req-123" },
    });
    const saved = await repo.save(entry);
    const found = await repo.findOneBy({ id: saved.id });
    expect(found!.metadata).toEqual({ reason: "GDPR request", requestId: "req-123" });
  });

  it("should handle null for nullable fields", async () => {
    const entry = repo.create({
      action: "created",
      entityType: "User",
      entityId: "user-1",
    });
    const saved = await repo.save(entry);
    const found = await repo.findOneBy({ id: saved.id });
    expect(found!.actorType).toBeNull();
    expect(found!.actorId).toBeNull();
    expect(found!.oldValues).toBeNull();
    expect(found!.newValues).toBeNull();
    expect(found!.metadata).toBeNull();
    expect(found!.ipAddress).toBeNull();
    expect(found!.userAgent).toBeNull();
  });

  it("should store ipAddress and userAgent", async () => {
    const entry = repo.create({
      action: "updated",
      entityType: "User",
      entityId: "user-1",
      ipAddress: "192.168.1.1",
      userAgent: "Mozilla/5.0",
    });
    const saved = await repo.save(entry);
    const found = await repo.findOneBy({ id: saved.id });
    expect(found!.ipAddress).toBe("192.168.1.1");
    expect(found!.userAgent).toBe("Mozilla/5.0");
  });
});
