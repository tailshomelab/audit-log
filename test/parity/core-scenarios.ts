import { afterEach, describe, expect, it, vi } from "vitest";
import "reflect-metadata";
import type { TestingModule } from "@nestjs/testing";
import { AuditLogService } from "../../src/core/audit-log.service.js";
import { Auditable } from "../../src/core/decorators/auditable.decorator.js";
import { AuditableMixin } from "../../src/core/mixins/auditable.mixin.js";
import { AuditLogNotInitializedException } from "../../src/core/exceptions/audit-log-not-initialized.exception.js";
import { AUDIT_LOG_EVENTS } from "../../src/core/events/audit-log.events.js";
import type { ActorResolver, AuditActor, AuditLogRecord } from "../../src/core/interfaces/index.js";
import {
  ParityArticle,
  ParityCreateDeleteOnly,
  ParityItem,
  ParityMember,
  ParityPost,
  ParityUser,
  type AdapterHarness,
} from "./harness.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const RECORD_FIELDS = [
  "id",
  "action",
  "entityType",
  "entityId",
  "actorType",
  "actorId",
  "oldValues",
  "newValues",
  "metadata",
  "ipAddress",
  "userAgent",
  "createdAt",
];

/** The adapter-independent part of a record. */
function comparable(record: AuditLogRecord): Omit<AuditLogRecord, "id" | "createdAt"> {
  return {
    action: record.action,
    entityType: record.entityType,
    entityId: record.entityId,
    actorType: record.actorType,
    actorId: record.actorId,
    oldValues: record.oldValues,
    newValues: record.newValues,
    metadata: record.metadata,
    ipAddress: record.ipAddress,
    userAgent: record.userAgent,
  };
}

class ResolverActor implements ActorResolver {
  resolve(): AuditActor {
    return { type: "User", id: "admin-1" };
  }
}

class AsyncResolverActor implements ActorResolver {
  resolve(): Promise<AuditActor> {
    return Promise.resolve({ type: "AsyncUser", id: "async-1" });
  }
}

class MixinBase {
  declare id: string;
}

@Auditable({ auditableType: "MixinUser" })
class MixinUser extends AuditableMixin(MixinBase) {}

/**
 * One test per scenario of `specs/audit-log-core`, run against any adapter. Expected
 * records never depend on the adapter. Reused by every `*.parity.spec.ts`.
 */
export function runCoreScenarios(harness: AdapterHarness): void {
  describe(`core scenarios (${harness.name})`, () => {
    let module: TestingModule;
    let service: AuditLogService;

    // Every nullable column is given explicitly, so payloads do not depend on whether the
    // ORM writes back null for unset nullable columns after insert.
    function insertUser(name: string, email: string) {
      return harness.insert(ParityUser, { name, email, password: null });
    }

    async function boot(config?: Parameters<AdapterHarness["bootstrap"]>[0]) {
      module = await harness.bootstrap(config);
      service = module.get(AuditLogService);
    }

    afterEach(async () => {
      await harness.close();
    });

    describe("Requirement: Audit record shape", () => {
      it("Record returned by any adapter", async () => {
        await boot();
        const full = await service.log({
          action: "updated",
          entityType: "User",
          entityId: "user-1",
          oldValues: { name: "Alice", age: 25 },
          newValues: { name: "Bob", age: 30 },
          actor: { type: "Admin", id: "admin-1" },
          metadata: { reason: "GDPR request", requestId: "req-123" },
          ipAddress: "192.168.1.1",
          userAgent: "Mozilla/5.0",
        });
        await service.log({ action: "created", entityType: "Post", entityId: "post-1" });

        const [readFull] = await service.getAuditLogs("User", "user-1");
        const [readMinimal] = await service.getAuditLogs("Post", "post-1");

        for (const record of [full, readFull, readMinimal]) {
          expect(Object.keys(record)).toEqual(expect.arrayContaining(RECORD_FIELDS));
          expect(record.id).toMatch(UUID);
          expect(record.createdAt).toBeInstanceOf(Date);
          expect(Math.abs(Date.now() - record.createdAt.getTime())).toBeLessThan(60_000);
        }
        expect(readFull.id).toBe(full.id);
        expect(comparable(readFull)).toEqual({
          action: "updated",
          entityType: "User",
          entityId: "user-1",
          actorType: "Admin",
          actorId: "admin-1",
          oldValues: { name: "Alice", age: 25 },
          newValues: { name: "Bob", age: 30 },
          metadata: { reason: "GDPR request", requestId: "req-123" },
          ipAddress: "192.168.1.1",
          userAgent: "Mozilla/5.0",
        });
        expect(comparable(readMinimal)).toEqual({
          action: "created",
          entityType: "Post",
          entityId: "post-1",
          actorType: null,
          actorId: null,
          oldValues: null,
          newValues: null,
          metadata: null,
          ipAddress: null,
          userAgent: null,
        });

        const user = await insertUser("Alice", "a@test.com");
        const [automatic] = await service.getAuditLogs("ParityUser", user.id);
        expect(Object.keys(automatic)).toEqual(expect.arrayContaining(RECORD_FIELDS));
        expect(automatic.newValues).toEqual({ name: "Alice", email: "a@test.com", password: null });
      });
    });

    describe("Requirement: Auditable opt-in", () => {
      it("Unmarked entity", async () => {
        await boot();
        const post = await harness.insert(ParityPost, { title: "Hello" });
        await harness.update(post, { title: "World" });
        await harness.remove(post);

        expect(await harness.listAuditRows()).toEqual([]);
      });

      it("Custom auditable type", async () => {
        await boot();
        const member = await harness.insert(ParityMember, { name: "Alice" });
        const user = await insertUser("Bob", "b@test.com");

        const rows = await harness.listAuditRows();
        expect(rows.map((r) => [r.entityType, r.entityId])).toEqual([
          ["AppUser", member.id],
          ["ParityUser", user.id],
        ]);
      });
    });

    describe("Requirement: Field filtering", () => {
      it("Except and global exclusions", async () => {
        await boot({ options: { globalExcludedFields: ["password"] } });
        await harness.insert(ParityItem, { name: "Item", secret: "hidden" });
        await harness.insert(ParityUser, {
          name: "Alice",
          email: "alice@test.com",
          password: "secret123",
        });

        const rows = await harness.listAuditRows();
        expect(rows.map((r) => r.newValues)).toEqual([
          { name: "Item" },
          { name: "Alice", email: "alice@test.com" },
        ]);
      });

      it("Only list", async () => {
        await boot();
        const article = await harness.insert(ParityArticle, { title: "Hello", content: "World" });
        await harness.update(article, { title: "Hi", content: "There" });

        const rows = await harness.listAuditRows();
        expect(rows.map((r) => [r.action, r.oldValues, r.newValues])).toEqual([
          ["created", null, { title: "Hello" }],
          ["updated", { title: "Hello" }, { title: "Hi" }],
        ]);
      });
    });

    describe("Requirement: Update diff", () => {
      it("Partial change", async () => {
        await boot();
        const user = await insertUser("Alice", "alice@test.com");
        await harness.update(user, { name: "Bob" });

        const updates = (await harness.listAuditRows()).filter((r) => r.action === "updated");
        expect(updates).toHaveLength(1);
        expect(updates[0].entityId).toBe(user.id);
        expect(updates[0].oldValues).toEqual({ name: "Alice" });
        expect(updates[0].newValues).toEqual({ name: "Bob" });
      });

      it("Entity not loaded before the update", async () => {
        await boot();
        const user = await insertUser("Alice", "alice@test.com");
        await harness.updateUnloaded(ParityUser, user.id, { name: "Bob" });

        const updates = (await harness.listAuditRows()).filter((r) => r.action === "updated");
        expect(updates.map((r) => [r.entityId, r.oldValues, r.newValues])).toEqual([
          [user.id, { name: "Alice" }, { name: "Bob" }],
        ]);
      });

      it("No effective change", async () => {
        await boot();
        const user = await insertUser("Alice", "alice@test.com");
        await harness.update(user, {});
        await harness.update(user, { name: "Alice" });

        const rows = await harness.listAuditRows();
        expect(rows.map((r) => r.action)).toEqual(["created"]);
      });
    });

    describe("Requirement: Create and delete payloads", () => {
      it("Delete payload", async () => {
        await boot();
        const user = await insertUser("Alice", "alice@test.com");
        const userId = user.id;
        await harness.remove(user);

        const [created, deleted] = await harness.listAuditRows();
        expect(created.action).toBe("created");
        expect(created.oldValues).toBeNull();
        expect(created.newValues).toEqual({
          name: "Alice",
          email: "alice@test.com",
          password: null,
        });
        expect(deleted.action).toBe("deleted");
        expect(deleted.entityType).toBe("ParityUser");
        expect(deleted.entityId).toBe(userId);
        expect(deleted.oldValues).toEqual({
          name: "Alice",
          email: "alice@test.com",
          password: null,
        });
        expect(deleted.newValues).toBeNull();
      });
    });

    describe("Requirement: Action filtering", () => {
      it("Entity-level events", async () => {
        await boot();
        const entity = await harness.insert(ParityCreateDeleteOnly, { value: "initial" });
        await harness.update(entity, { value: "changed" });
        await harness.remove(entity);

        const rows = await harness.listAuditRows();
        expect(rows.map((r) => r.action)).toEqual(["created", "deleted"]);
      });

      it("Module-level disabled action", async () => {
        await boot({ options: { disabledActions: ["deleted"] } });
        const user = await insertUser("Alice", "alice@test.com");
        await harness.update(user, { name: "Bob" });
        await harness.remove(user);

        const rows = await harness.listAuditRows();
        expect(rows.map((r) => r.action)).toEqual(["created", "updated"]);
      });
    });

    describe("Requirement: Actor and metadata attribution", () => {
      it("Resolver actor on automatic capture", async () => {
        await boot({
          options: {
            actorResolver: ResolverActor,
            defaultActor: { type: "System", id: "system" },
            metadata: { app: "parity" },
          },
        });
        const user = await insertUser("Alice", "alice@test.com");
        await harness.update(user, { name: "Bob" });

        const rows = await harness.listAuditRows();
        expect(rows.map((r) => [r.actorType, r.actorId, r.metadata])).toEqual([
          ["User", "admin-1", { app: "parity" }],
          ["User", "admin-1", { app: "parity" }],
        ]);
      });

      it("Async resolver", async () => {
        await boot({ async: true, options: { actorResolver: AsyncResolverActor } });
        await insertUser("Alice", "alice@test.com");
        const manual = await service.log({ action: "created", entityType: "X", entityId: "x-1" });

        const [automatic] = await harness.listAuditRows();
        expect([automatic.actorType, automatic.actorId]).toEqual(["AsyncUser", "async-1"]);
        expect([manual.actorType, manual.actorId]).toEqual(["AsyncUser", "async-1"]);
      });
    });

    describe("Requirement: Failure isolation for automatic capture", () => {
      it("Audit write error", async () => {
        const emit = vi.fn().mockReturnValue(true);
        await boot({ emitter: { emit } });
        await harness.dropAuditTable();

        const user = await insertUser("Alice", "alice@test.com");
        expect(user.id).toBeDefined();
        const updated = await harness.update(user, { name: "Bob" });
        expect(updated.name).toBe("Bob");
        await expect(harness.remove(updated)).resolves.toBeUndefined();
        expect(emit).not.toHaveBeenCalled();
      });
    });

    describe("Requirement: Logged event", () => {
      it("Emitter present", async () => {
        const emit = vi.fn().mockReturnValue(true);
        await boot({ emitter: { emit } });

        await insertUser("Alice", "alice@test.com");
        expect(emit).toHaveBeenCalledTimes(1);
        const [row] = await harness.listAuditRows();
        const [event, payload] = emit.mock.calls[0];
        expect(event).toBe(AUDIT_LOG_EVENTS.LOGGED);
        expect(payload.auditLog.id).toBe(row.id);
        expect(comparable(payload.auditLog)).toEqual(comparable(row));

        const manual = await service.log({
          action: "created",
          entityType: "User",
          entityId: "u-1",
        });
        expect(emit).toHaveBeenCalledTimes(2);
        expect(emit).toHaveBeenLastCalledWith(AUDIT_LOG_EVENTS.LOGGED, { auditLog: manual });
      });

      it("Emitted after commit", async () => {
        const emit = vi.fn().mockReturnValue(true);
        await boot({ emitter: { emit } });

        await harness.transaction(async (insert) => {
          await insert(ParityUser, { name: "Alice", email: "alice@test.com", password: null });
          await insert(ParityItem, { name: "Item", secret: null });
          expect(emit).not.toHaveBeenCalled();
        });

        const rows = await harness.listAuditRows();
        expect(rows).toHaveLength(2);
        expect(emit.mock.calls.map(([event, payload]) => [event, payload.auditLog.id])).toEqual(
          rows.map((row) => [AUDIT_LOG_EVENTS.LOGGED, row.id]),
        );
      });

      it("No event for a rolled-back transaction", async () => {
        const emit = vi.fn().mockReturnValue(true);
        await boot({ emitter: { emit } });
        const boom = new Error("rollback");

        await expect(
          harness.transaction(async (insert) => {
            await insert(ParityUser, { name: "Alice", email: "alice@test.com", password: null });
            throw boom;
          }),
        ).rejects.toBe(boom);

        expect(await harness.listAuditRows()).toEqual([]);
        expect(emit).not.toHaveBeenCalled();
      });

      it("Emitter absent", async () => {
        await boot();
        await insertUser("Alice", "alice@test.com");
        const manual = await service.log({
          action: "created",
          entityType: "User",
          entityId: "u-1",
        });

        expect(manual.id).toMatch(UUID);
        expect(await harness.listAuditRows()).toHaveLength(2);
      });
    });

    describe("Requirement: Manual logging", () => {
      it("Manual entry", async () => {
        await boot();
        const entry = await service.log({
          action: "created",
          entityType: "User",
          entityId: "user-1",
          newValues: { name: "Alice" },
        });

        expect(entry.id).toMatch(UUID);
        expect(entry.createdAt).toBeInstanceOf(Date);
        expect(entry.action).toBe("created");
        expect(entry.entityType).toBe("User");
        expect(entry.entityId).toBe("user-1");
        expect(entry.oldValues).toBeNull();
        expect(entry.newValues).toEqual({ name: "Alice" });

        const rows = await harness.listAuditRows();
        expect(rows.map((r) => r.id)).toEqual([entry.id]);
        expect(comparable(rows[0])).toEqual(comparable(entry));
      });
    });

    describe("Requirement: Query by entity and actor", () => {
      it("Filtered paginated query", async () => {
        await boot();
        const admin = { type: "Admin", id: "admin-1" };
        const plan: Array<["created" | "updated" | "deleted", string, typeof admin]> = [
          ["created", "2026-01-01T00:00:00.000Z", admin],
          ["updated", "2026-01-02T00:00:00.000Z", admin],
          ["updated", "2026-01-03T00:00:00.000Z", admin],
          ["updated", "2026-01-04T00:00:00.000Z", { type: "Admin", id: "admin-2" }],
          ["deleted", "2026-01-05T00:00:00.000Z", admin],
        ];
        const ids: string[] = [];
        for (const [action, date, actor] of plan) {
          const record = await service.log({ action, entityType: "User", entityId: "u-1", actor });
          await harness.setCreatedAt(record.id, new Date(date));
          ids.push(record.id);
        }
        const other = await service.log({
          action: "updated",
          entityType: "Post",
          entityId: "p-1",
          actor: admin,
        });
        await harness.setCreatedAt(other.id, new Date("2026-01-03T12:00:00.000Z"));

        const idsOf = (records: AuditLogRecord[]) => records.map((r) => r.id);

        // Entity: all of its records, newest first
        expect(idsOf(await service.getAuditLogs("User", "u-1"))).toEqual([...ids].reverse());
        // Entity: action + inclusive from/to + limit/offset
        const window = {
          from: new Date("2026-01-02T00:00:00.000Z"),
          to: new Date("2026-01-04T00:00:00.000Z"),
        };
        expect(
          idsOf(await service.getAuditLogs("User", "u-1", { action: "updated", ...window })),
        ).toEqual([ids[3], ids[2], ids[1]]);
        expect(
          idsOf(
            await service.getAuditLogs("User", "u-1", {
              action: "updated",
              ...window,
              limit: 2,
              offset: 1,
            }),
          ),
        ).toEqual([ids[2], ids[1]]);
        expect(idsOf(await service.getAuditLogs("User", "u-1", { limit: 2 }))).toEqual([
          ids[4],
          ids[3],
        ]);
        expect(idsOf(await service.getAuditLogs("User", "u-1", { limit: 2, offset: 4 }))).toEqual([
          ids[0],
        ]);
        expect(
          await service.getAuditLogs("User", "u-1", { from: new Date("2026-02-01T00:00:00Z") }),
        ).toEqual([]);

        // Actor: across entities, with the same filters
        expect(idsOf(await service.getAuditLogsByActor("Admin", "admin-1"))).toEqual([
          ids[4],
          other.id,
          ids[2],
          ids[1],
          ids[0],
        ]);
        expect(
          idsOf(await service.getAuditLogsByActor("Admin", "admin-1", { action: "deleted" })),
        ).toEqual([ids[4]]);
        expect(
          idsOf(await service.getAuditLogsByActor("Admin", "admin-1", { ...window, offset: 1 })),
        ).toEqual([ids[2], ids[1]]);
        expect(
          idsOf(await service.getAuditLogsByActor("Admin", "admin-1", { limit: 2, offset: 4 })),
        ).toEqual([ids[0]]);
        expect(idsOf(await service.getAuditLogsByActor("Admin", "admin-2"))).toEqual([ids[3]]);
      });

      it("Unknown entity", async () => {
        await boot();
        await service.log({ action: "created", entityType: "User", entityId: "user-1" });

        expect(await service.getAuditLogs("User", "non-existent")).toEqual([]);
        expect(await service.getAuditLogsByActor("Admin", "nobody")).toEqual([]);
      });
    });

    describe("Requirement: Latest record lookup", () => {
      it("No records", async () => {
        await boot();
        expect(await service.getLatestAuditLog("User", "non-existent")).toBeNull();

        const first = await service.log({ action: "created", entityType: "User", entityId: "u-1" });
        const second = await service.log({
          action: "updated",
          entityType: "User",
          entityId: "u-1",
        });
        await harness.setCreatedAt(first.id, new Date("2026-01-01T00:00:00.000Z"));
        await harness.setCreatedAt(second.id, new Date("2026-01-02T00:00:00.000Z"));

        expect((await service.getLatestAuditLog("User", "u-1"))?.id).toBe(second.id);
        expect(await service.getLatestAuditLog("User", "non-existent")).toBeNull();
      });
    });

    describe("Requirement: Entity mixin helpers", () => {
      it("Module not initialized", async () => {
        const user = new MixinUser();
        user.id = "user-1";
        expect(AuditLogService.getInstance()).toBeNull();
        await expect(user.getAuditLogs()).rejects.toBeInstanceOf(AuditLogNotInitializedException);
        await expect(user.getLatestAuditLog()).rejects.toBeInstanceOf(
          AuditLogNotInitializedException,
        );

        await boot();
        const created = await service.log({
          action: "created",
          entityType: "MixinUser",
          entityId: "user-1",
        });
        await service.log({ action: "updated", entityType: "MixinUser", entityId: "user-1" });
        await harness.setCreatedAt(created.id, new Date("2026-01-01T00:00:00.000Z"));

        expect(await user.getAuditLogs()).toHaveLength(2);
        expect((await user.getAuditLogs({ action: "created" })).map((r) => r.id)).toEqual([
          created.id,
        ]);
        expect((await user.getLatestAuditLog())?.action).toBe("updated");

        await harness.close();
        await expect(user.getAuditLogs()).rejects.toBeInstanceOf(AuditLogNotInitializedException);
      });
    });

    describe("Requirement: ORM-free core entry point", () => {
      // Loading with ORM packages unresolvable is checked on the built package by
      // `pnpm run test:exports` (task 6.3); this checks the exported surface.
      it("No ORM installed", async () => {
        const core = await import("../../src/index.js");
        expect(Object.keys(core).sort()).toEqual([
          "AUDITABLE_METADATA_KEY",
          "AUDIT_LOG_ACTOR_RESOLVER",
          "AUDIT_LOG_EVENTS",
          "AUDIT_LOG_OPTIONS",
          "AUDIT_LOG_STORAGE",
          "AuditLogNotInitializedException",
          "AuditLogService",
          "Auditable",
          "AuditableMixin",
          "computeDiff",
        ]);
      });
    });

    describe("Requirement: Adapter behaviour parity", () => {
      it("Shared suite against each adapter", async () => {
        await boot({ options: { actorResolver: ResolverActor } });
        const user = await harness.insert(ParityUser, {
          name: "Alice",
          email: "alice@test.com",
          password: null,
        });
        const userId = user.id;
        await harness.update(user, { name: "Bob", password: "hash" });
        await harness.remove(user);

        const base = {
          entityType: "ParityUser",
          entityId: userId,
          actorType: "User",
          actorId: "admin-1",
          metadata: null,
          ipAddress: null,
          userAgent: null,
        };
        expect((await harness.listAuditRows()).map(comparable)).toEqual([
          {
            ...base,
            action: "created",
            oldValues: null,
            newValues: { name: "Alice", email: "alice@test.com", password: null },
          },
          {
            ...base,
            action: "updated",
            oldValues: { name: "Alice", password: null },
            newValues: { name: "Bob", password: "hash" },
          },
          {
            ...base,
            action: "deleted",
            oldValues: { name: "Bob", email: "alice@test.com", password: "hash" },
            newValues: null,
          },
        ]);
      });
    });
  });
}
