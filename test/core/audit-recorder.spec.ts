import { describe, it, expect, afterEach, vi } from "vitest";
import { EventEmitter2 } from "@nestjs/event-emitter";
import "reflect-metadata";
import { Test, TestingModule } from "@nestjs/testing";
import { AuditLogService } from "../../src/core/audit-log.service.js";
import { AuditRecorder } from "../../src/core/audit-recorder.js";
import {
  AUDITABLE_METADATA_KEY,
  AUDIT_LOG_ACTOR_RESOLVER,
  AUDIT_LOG_OPTIONS,
  AUDIT_LOG_STORAGE,
} from "../../src/core/audit-log.constants.js";
import { AUDIT_LOG_EVENTS } from "../../src/core/events/audit-log.events.js";
import { Auditable } from "../../src/core/decorators/auditable.decorator.js";
import type { AuditLogModuleOptions } from "../../src/core/interfaces/index.js";
import { InMemoryAuditLogStorage } from "./in-memory-storage.js";

@Auditable()
class User {
  id = "u-1";
  name = "Alice";
  email = "alice@test.com";
  password = "hash";
  createdAt = new Date(1000);
  updated_at = new Date(1000);
}

@Auditable({ auditableType: "AppItem", except: ["secret"] })
class Item {}

@Auditable({ only: ["title"] })
class Article {}

@Auditable({ events: ["created", "deleted"] })
class CreateDeleteOnly {}

class Plain {}

let module: TestingModule | undefined;

async function setup(options: AuditLogModuleOptions = {}, emit = vi.fn()) {
  module = await Test.createTestingModule({
    providers: [
      { provide: AUDIT_LOG_OPTIONS, useValue: options },
      { provide: AUDIT_LOG_STORAGE, useValue: new InMemoryAuditLogStorage() },
      {
        provide: AUDIT_LOG_ACTOR_RESOLVER,
        useValue: { resolve: async () => ({ type: "Admin", id: "admin-1" }) },
      },
      { provide: EventEmitter2, useValue: { emit } },
      AuditLogService,
      AuditRecorder,
    ],
  }).compile();
  // The emitter is looked up in AuditLogService.onModuleInit().
  await module.init();
  return module.get(AuditRecorder);
}

const meta = (target: object) => {
  const resolved = Reflect.getMetadata(AUDITABLE_METADATA_KEY, target);
  if (!resolved) throw new Error("not auditable");
  return resolved;
};

afterEach(async () => {
  await module?.close();
  module = undefined;
});

describe("AuditRecorder", () => {
  describe("resolveTarget()", () => {
    it("returns the @Auditable metadata of the entity class", async () => {
      const recorder = await setup();
      expect(recorder.resolveTarget(new Item())).toEqual({
        auditableType: "AppItem",
        only: undefined,
        except: ["secret"],
        events: undefined,
      });
    });

    it("returns null for non-auditable entities and non-objects", async () => {
      const recorder = await setup();
      expect(recorder.resolveTarget(new Plain())).toBeNull();
      expect(recorder.resolveTarget({ id: 1 })).toBeNull();
      expect(recorder.resolveTarget(null)).toBeNull();
      expect(recorder.resolveTarget("User")).toBeNull();
    });
  });

  describe("isEnabled()", () => {
    it("honours the entity-level events list", async () => {
      const recorder = await setup();
      const m = meta(CreateDeleteOnly);
      expect(recorder.isEnabled(m, "created")).toBe(true);
      expect(recorder.isEnabled(m, "updated")).toBe(false);
      expect(recorder.isEnabled(m, "deleted")).toBe(true);
    });

    it("honours the module-level disabledActions", async () => {
      const recorder = await setup({ disabledActions: ["deleted"] });
      const m = meta(User);
      expect(recorder.isEnabled(m, "created")).toBe(true);
      expect(recorder.isEnabled(m, "deleted")).toBe(false);
    });
  });

  describe("buildCreated() / buildDeleted()", () => {
    it("drops always-excluded fields and globalExcludedFields", async () => {
      const recorder = await setup({ globalExcludedFields: ["password"] });
      const snapshot = { ...new User() };

      expect(recorder.buildCreated(meta(User), snapshot)).toEqual({
        oldValues: null,
        newValues: { name: "Alice", email: "alice@test.com" },
      });
      expect(recorder.buildDeleted(meta(User), snapshot)).toEqual({
        oldValues: { name: "Alice", email: "alice@test.com" },
        newValues: null,
      });
    });

    it("drops entity-level except fields", async () => {
      const recorder = await setup();
      expect(recorder.buildCreated(meta(Item), { id: "i-1", name: "Item", secret: "x" })).toEqual({
        oldValues: null,
        newValues: { name: "Item" },
      });
    });

    it("keeps only the entity-level only fields that the snapshot has", async () => {
      const recorder = await setup();
      expect(recorder.buildCreated(meta(Article), { title: "Hello", content: "World" })).toEqual({
        oldValues: null,
        newValues: { title: "Hello" },
      });
      expect(recorder.buildDeleted(meta(Article), { content: "World" })).toEqual({
        oldValues: {},
        newValues: null,
      });
    });
  });

  describe("buildUpdated()", () => {
    it("returns only the changed fields", async () => {
      const recorder = await setup();
      const old = { id: "u-1", name: "Alice", email: "a@test.com", updatedAt: new Date(1) };
      const current = { id: "u-1", name: "Bob", email: "a@test.com", updatedAt: new Date(2) };

      expect(recorder.buildUpdated(meta(User), old, current)).toEqual({
        oldValues: { name: "Alice" },
        newValues: { name: "Bob" },
      });
    });

    it("applies only, except and globalExcludedFields", async () => {
      const recorder = await setup({ globalExcludedFields: ["token"] });
      expect(
        recorder.buildUpdated(
          meta(Article),
          { title: "A", content: "x" },
          { title: "B", content: "y" },
        ),
      ).toEqual({ oldValues: { title: "A" }, newValues: { title: "B" } });
      expect(
        recorder.buildUpdated(
          meta(Item),
          { name: "a", secret: "1", token: "t1" },
          { name: "a", secret: "2", token: "t2" },
        ),
      ).toBeNull();
    });

    it("compares only changedFields when the adapter passes them", async () => {
      const recorder = await setup();
      // An unloaded entity's snapshot lacks `email`; it must not appear as a change.
      const old = { name: "Alice", email: "a@test.com", big: 1 };
      const current = { id: "u-1", name: "Bob" };

      expect(recorder.buildUpdated(meta(User), old, current, ["name"])).toEqual({
        oldValues: { name: "Alice" },
        newValues: { name: "Bob" },
      });
      expect(recorder.buildUpdated(meta(User), old, current, [])).toBeNull();
    });

    it("converts bigint values to strings at any depth", async () => {
      const recorder = await setup();
      expect(
        recorder.buildUpdated(
          meta(User),
          { name: "a", amount: 1n, nested: { list: [2n] } },
          { name: "a", amount: 3n, nested: { list: [2n] } },
        ),
      ).toEqual({ oldValues: { amount: "1" }, newValues: { amount: "3" } });
      expect(recorder.buildCreated(meta(User), { name: "a", nested: { list: [2n] } })).toEqual({
        oldValues: null,
        newValues: { name: "a", nested: { list: ["2"] } },
      });
    });

    it("does not throw on cyclic values", async () => {
      const recorder = await setup();
      const cyclic: Record<string, any> = { amount: 1n };
      cyclic.self = cyclic;
      const plain: Record<string, any> = { label: "x" };
      plain.self = plain;

      const created = recorder.buildCreated(meta(User), { name: "a", cyclic, plain });
      expect(created.newValues?.cyclic.amount).toBe("1");
      expect(created.newValues?.cyclic.self).toBe(cyclic);
      expect(created.newValues?.plain).toBe(plain);
      expect(() =>
        recorder.buildUpdated(meta(User), { name: "a", cyclic }, { name: "b", cyclic }),
      ).not.toThrow();
    });

    it("returns null for a no-change update", async () => {
      const recorder = await setup();
      const snapshot = { name: "Alice", tags: ["a"], settings: { theme: "dark" } };
      expect(recorder.buildUpdated(meta(User), snapshot, structuredClone(snapshot))).toBeNull();
    });
  });

  describe("formatEntityId()", () => {
    it("flattens a composite key value (a relation to a composite-key entity)", async () => {
      const recorder = await setup();
      expect(recorder.formatEntityId([["acme", 7]])).toBe("acme:7");
      expect(recorder.formatEntityId([["acme", 7], 3n])).toBe("acme:7:3");
    });

    it("stringifies a single primary key", async () => {
      const recorder = await setup();
      expect(recorder.formatEntityId(["u-1"])).toBe("u-1");
      expect(recorder.formatEntityId([42])).toBe("42");
    });

    it("joins composite primary keys with ':' in metadata order (A3)", async () => {
      const recorder = await setup();
      expect(recorder.formatEntityId(["tenant-1", 7])).toBe("tenant-1:7");
    });

    it("returns null when a key value is missing", async () => {
      const recorder = await setup();
      expect(recorder.formatEntityId([])).toBeNull();
      expect(recorder.formatEntityId(["tenant-1", undefined])).toBeNull();
      expect(recorder.formatEntityId([null])).toBeNull();
    });
  });

  describe("toDraft() / afterWrite()", () => {
    it("builds the draft with the resolved actor and module metadata", async () => {
      const recorder = await setup({ metadata: { app: "test" } });
      const draft = await recorder.toDraft(meta(Item), "created", "i-1", {
        oldValues: null,
        newValues: { name: "Item" },
      });

      expect(draft).toEqual({
        action: "created",
        entityType: "AppItem",
        entityId: "i-1",
        oldValues: null,
        newValues: { name: "Item" },
        actorType: "Admin",
        actorId: "admin-1",
        metadata: { app: "test" },
        ipAddress: null,
        userAgent: null,
      });
    });

    it("afterWrite() emits audit.logged with the written record", async () => {
      const emit = vi.fn();
      const recorder = await setup({}, emit);
      const record = {
        ...(await recorder.toDraft(meta(User), "deleted", "u-1", {
          oldValues: {},
          newValues: null,
        })),
        id: "r-1",
        createdAt: new Date(),
      };

      recorder.afterWrite(record);

      expect(emit).toHaveBeenCalledWith(AUDIT_LOG_EVENTS.LOGGED, { auditLog: record });
    });
  });
});
