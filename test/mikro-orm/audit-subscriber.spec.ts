import "reflect-metadata";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Test, type TestingModule } from "@nestjs/testing";
import { MikroOrmModule } from "@mikro-orm/nestjs";
import { MikroORM, defineConfig, defineEntity, p, type EntityManager } from "@mikro-orm/libsql";
import { AuditRecorder } from "../../src/core/audit-recorder.js";
import { Auditable } from "../../src/core/decorators/auditable.decorator.js";
import type { AuditLogRecord } from "../../src/core/interfaces/index.js";
import { MikroOrmAuditLogModule } from "../../src/mikro-orm/mikro-orm-audit-log.module.js";
import { MikroOrmAuditLogSchema } from "../../src/mikro-orm/mikro-orm-audit-log.schema.js";
import { eventEmitterModule } from "../parity/harness.js";

class Address {
  declare city: string;
  declare country: string;
}
const AddressSchema = defineEntity({
  name: "Address",
  embeddable: true,
  properties: { city: p.string(), country: p.string() },
});
AddressSchema.setClass(Address);

class Team {
  declare id: number;
  declare name: string;
}
const TeamSchema = defineEntity({
  name: "Team",
  tableName: "teams",
  properties: { id: p.integer().primary().autoincrement(), name: p.string() },
});
TeamSchema.setClass(Team);

/** Autoincrement key, embeddable, to-one relation, Date and JSON properties. */
@Auditable()
class Member {
  declare id: number;
  declare name: string;
  declare address: Address;
  declare team: Team | null;
  declare joinedAt: Date;
  declare settings: Record<string, any> | null;
  /** Not persisted: must never reach the audit payload. */
  transientNote = "not persisted";
}
const MemberSchema = defineEntity({
  name: "Member",
  tableName: "members",
  properties: {
    id: p.integer().primary().autoincrement(),
    name: p.string(),
    address: () => p.embedded(Address),
    team: () => p.manyToOne(Team).nullable(),
    joinedAt: p.datetime(),
    settings: p.json<Record<string, any>>().nullable(),
  },
});
MemberSchema.setClass(Member);

@Auditable()
class Membership {
  declare tenantId: string;
  declare userId: number;
  declare role: string;
}
const MembershipSchema = defineEntity({
  name: "Membership",
  tableName: "memberships",
  properties: {
    tenantId: p.string().primary(),
    userId: p.integer().primary(),
    role: p.string(),
  },
});
MembershipSchema.setClass(Membership);

/** Not auditable. */
class Note {
  declare id: number;
  declare text: string;
}
const NoteSchema = defineEntity({
  name: "Note",
  tableName: "notes",
  properties: { id: p.integer().primary().autoincrement(), text: p.string() },
});
NoteSchema.setClass(Note);

class Ledger {
  declare id: bigint;
  declare name: string;
}
const LedgerSchema = defineEntity({
  name: "Ledger",
  tableName: "ledgers",
  properties: { id: p.bigint().primary().autoincrement(), name: p.string() },
});
LedgerSchema.setClass(Ledger);

/** A bigint property and a relation to an entity with a bigint primary key. */
@Auditable()
class Entry {
  declare id: number;
  declare amount: bigint;
  declare ledger: Ledger;
}
const EntrySchema = defineEntity({
  name: "Entry",
  tableName: "entries",
  properties: {
    id: p.integer().primary().autoincrement(),
    amount: p.bigint(),
    ledger: () => p.manyToOne(Ledger),
  },
});
EntrySchema.setClass(Entry);

/** Its primary key is a relation to an entity with a composite key. */
@Auditable()
class MembershipNote {
  declare membership: Membership;
  declare text: string;
}
const MembershipNoteSchema = defineEntity({
  name: "MembershipNote",
  tableName: "membership_notes",
  properties: {
    membership: () => p.manyToOne(Membership).primary(),
    text: p.string(),
  },
});
MembershipNoteSchema.setClass(MembershipNote);

/** Squad -> players -> Player.info.captainOf -> Squad: a cycle through an embeddable. */
class Squad {
  declare id: number;
  declare name: string;
}
class PlayerInfo {
  declare label: string;
  declare captainOf: Squad | null;
}
@Auditable()
class Player {
  declare id: number;
  declare name: string;
  declare squad: Squad;
  declare info: PlayerInfo;
}
const SquadSchema = defineEntity({
  name: "Squad",
  tableName: "squads",
  properties: {
    id: p.integer().primary().autoincrement(),
    name: p.string(),
    players: () => p.oneToMany(Player).mappedBy("squad"),
  },
});
SquadSchema.setClass(Squad);
const PlayerInfoSchema = defineEntity({
  name: "PlayerInfo",
  embeddable: true,
  properties: { label: p.string(), captainOf: () => p.manyToOne(Squad).nullable() },
});
PlayerInfoSchema.setClass(PlayerInfo);
const PlayerSchema = defineEntity({
  name: "Player",
  tableName: "players",
  properties: {
    id: p.integer().primary().autoincrement(),
    name: p.string(),
    squad: () => p.manyToOne(Squad),
    info: () => p.embedded(PlayerInfo),
  },
});
PlayerSchema.setClass(Player);

describe("MikroOrmAuditSubscriber", () => {
  let module: TestingModule;
  let orm: MikroORM;
  let em: EntityManager;
  let emit: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    emit = vi.fn().mockReturnValue(true);
    module = await Test.createTestingModule({
      imports: [
        MikroOrmModule.forRoot(
          defineConfig({
            dbName: ":memory:",
            entities: [
              MikroOrmAuditLogSchema,
              AddressSchema,
              TeamSchema,
              MemberSchema,
              MembershipSchema,
              NoteSchema,
              LedgerSchema,
              EntrySchema,
              MembershipNoteSchema,
              SquadSchema,
              PlayerInfoSchema,
              PlayerSchema,
            ],
            registerRequestContext: false,
          }),
        ),
        MikroOrmAuditLogModule.forRoot(),
        eventEmitterModule({ emit }),
      ],
    }).compile();
    await module.init();
    orm = module.get(MikroORM);
    await orm.schema.create();
    em = orm.em.fork();
  });

  afterEach(async () => {
    await module?.close();
  });

  /** Audit rows in insertion order (several rows can share one `createdAt` millisecond). */
  const auditRows = async (): Promise<AuditLogRecord[]> => {
    const ordered: Array<{ id: string }> = await orm.em
      .getConnection()
      .execute("SELECT id FROM audit_logs ORDER BY rowid");
    const ids = ordered.map((row) => row.id);
    const rows = await orm.em.fork().find(MikroOrmAuditLogSchema, { id: { $in: ids } });
    return rows
      .map((row) => ({ ...row }) as AuditLogRecord)
      .sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id));
  };
  const auditCount = () => orm.em.fork().count(MikroOrmAuditLogSchema, {});

  const newMember = (target: EntityManager, name = "Alice") =>
    target.create(Member, {
      name,
      address: { city: "Lisbon", country: "PT" },
      team: null,
      joinedAt: new Date("2026-01-01T00:00:00.000Z"),
      settings: { theme: "dark", flags: [1, 2] },
    });

  it("records the autoincrement key on create, embeddables whole and relations as their key", async () => {
    const team = em.create(Team, { name: "Core" });
    const member = newMember(em);
    member.team = team;
    await em.flush();

    expect(typeof member.id).toBe("number");
    const [log] = await auditRows();
    expect(log.action).toBe("created");
    expect(log.entityType).toBe("Member");
    expect(log.entityId).toBe(String(member.id));
    expect(log.newValues).toEqual({
      name: "Alice",
      address: { city: "Lisbon", country: "PT" },
      team: team.id,
      joinedAt: "2026-01-01T00:00:00.000Z",
      settings: { theme: "dark", flags: [1, 2] },
    });
  });

  it("writes one record per auditable entity of a single flush", async () => {
    const first = newMember(em, "Alice");
    const second = newMember(em, "Bob");
    em.create(Note, { text: "not audited" });
    await em.flush();

    const logs = await auditRows();
    expect(logs.map((l) => [l.action, l.entityId]).sort()).toEqual(
      [
        ["created", String(first.id)],
        ["created", String(second.id)],
      ].sort(),
    );
  });

  it("does not audit audit records, whether inserted natively or through the unit of work", async () => {
    em.create(MikroOrmAuditLogSchema, { action: "created", entityType: "X", entityId: "x-1" });
    await em.flush();

    expect(await auditCount()).toBe(1);
  });

  it("does not capture nativeUpdate, nativeDelete, insert or query builder writes", async () => {
    const first = newMember(em, "Alice");
    const second = newMember(em, "Bob");
    await em.flush();
    await orm.em.fork().nativeDelete(MikroOrmAuditLogSchema, {});

    const native = orm.em.fork();
    await native.nativeUpdate(Member, { id: first.id }, { name: "Carol" });
    await native.insert(Member, {
      name: "Dan",
      address: { city: "Porto", country: "PT" },
      joinedAt: new Date(),
    });
    await native
      .createQueryBuilder(Member)
      .update({ name: "Eve" })
      .where({ id: second.id })
      .execute();
    await native.nativeDelete(Member, { id: first.id });
    await native.createQueryBuilder(Member).delete().where({ id: second.id }).execute();

    expect(await orm.em.fork().count(Member, {})).toBe(1);
    expect(await auditCount()).toBe(0);
  });

  it("leaves neither the entity nor its record when em.transactional rolls back after flush", async () => {
    await expect(
      orm.em.fork().transactional(async (tx) => {
        newMember(tx);
        await tx.flush();
        expect(await tx.count(MikroOrmAuditLogSchema, {})).toBe(1);
        throw new Error("rollback");
      }),
    ).rejects.toThrow("rollback");

    expect(await orm.em.fork().count(Member, {})).toBe(0);
    expect(await auditCount()).toBe(0);
    expect(emit).not.toHaveBeenCalled();
  });

  it("emits audit.logged after the outer commit, only for savepoints that were released", async () => {
    await orm.em.fork().transactional(async (tx) => {
      newMember(tx, "Outer");
      await tx.flush();
      await tx.transactional(async (inner) => {
        newMember(inner, "Released");
        await inner.flush();
      });
      await tx
        .transactional(async (inner) => {
          newMember(inner, "RolledBack");
          await inner.flush();
          throw new Error("savepoint rollback");
        })
        .catch(() => undefined);
      expect(emit).not.toHaveBeenCalled();
    });

    const logs = await auditRows();
    expect(logs.map((l) => l.newValues?.name)).toEqual(["Outer", "Released"]);
    expect(emit.mock.calls.map(([, payload]) => payload.auditLog.id)).toEqual(
      logs.map((l) => l.id),
    );
  });

  it("emits audit.logged after the implicit flush transaction commits", async () => {
    newMember(em);
    await em.flush();

    const [log] = await auditRows();
    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit.mock.calls[0][1].auditLog.id).toBe(log.id);
  });

  it("records bigint properties and bigint relation keys as strings", async () => {
    const ledger = em.create(Ledger, { name: "Main" });
    const entry = em.create(Entry, { amount: 9007199254740993n, ledger });
    await em.flush();
    entry.amount = 9007199254740995n;
    await em.flush();
    await em.remove(entry).flush();

    const logs = await auditRows();
    expect(logs.map((l) => [l.action, l.oldValues, l.newValues])).toEqual([
      ["created", null, { amount: "9007199254740993", ledger: String(ledger.id) }],
      ["updated", { amount: "9007199254740993" }, { amount: "9007199254740995" }],
      ["deleted", { amount: "9007199254740995", ledger: String(ledger.id) }, null],
    ]);
    expect(emit).toHaveBeenCalledTimes(3);
  });

  it("diffs only the written properties of a partially loaded entity", async () => {
    const member = newMember(em);
    await em.flush();

    const partialEm = orm.em.fork();
    const partial = await partialEm.findOneOrFail(Member, { id: member.id }, { fields: ["name"] });
    partial.settings = { theme: "light" };
    await partialEm.flush();

    const updates = (await auditRows()).filter((l) => l.action === "updated");
    expect(updates.map((l) => [l.oldValues, l.newValues])).toEqual([
      [{ settings: { theme: "dark", flags: [1, 2] } }, { settings: { theme: "light" } }],
    ]);
  });

  it("records a relation inside an embeddable as its key, even when the graph is cyclic", async () => {
    const squad = em.create(Squad, { name: "Reds" });
    const player = em.create(Player, {
      name: "Ana",
      squad,
      info: { label: "C", captainOf: squad },
    });
    await em.flush();
    player.info.label = "VC";
    await em.flush();

    expect(await orm.em.fork().count(Player, {})).toBe(1);
    const logs = await auditRows();
    expect(logs.map((l) => [l.action, l.oldValues, l.newValues])).toEqual([
      [
        "created",
        null,
        { name: "Ana", squad: squad.id, info: { label: "C", captainOf: squad.id } },
      ],
      [
        "updated",
        { info: { label: "C", captainOf: squad.id } },
        { info: { label: "VC", captainOf: squad.id } },
      ],
    ]);
  });

  it("commits the user's flush when building the record throws", async () => {
    const recorder = module.get(AuditRecorder);
    const boom = () => {
      throw new Error("build failed");
    };
    vi.spyOn(recorder, "buildCreated").mockImplementation(boom);
    vi.spyOn(recorder, "buildUpdated").mockImplementation(boom);
    vi.spyOn(recorder, "buildDeleted").mockImplementation(boom);

    const member = newMember(em);
    await em.flush();
    member.name = "Bob";
    await em.flush();
    expect((await orm.em.fork().findOneOrFail(Member, { id: member.id })).name).toBe("Bob");
    await em.remove(member).flush();

    expect(await orm.em.fork().count(Member, {})).toBe(0);
    expect(await auditCount()).toBe(0);
    expect(emit).not.toHaveBeenCalled();
  });

  it("flattens a composite relation primary key into the ':'-joined entityId", async () => {
    const membership = em.create(Membership, { tenantId: "acme", userId: 7, role: "admin" });
    em.create(MembershipNote, { membership, text: "hello" });
    await em.flush();

    const note = (await auditRows()).find((l) => l.entityType === "MembershipNote");
    expect(note?.entityId).toBe("acme:7");
    expect(note?.newValues).toEqual({ membership: ["acme", 7], text: "hello" });
  });

  it("diffs Date and JSON properties without spurious changes, also after a reload", async () => {
    const member = newMember(em);
    await em.flush();

    member.name = "Bob";
    await em.flush();

    const loadedEm = orm.em.fork();
    const reloaded = await loadedEm.findOneOrFail(Member, { id: member.id });
    reloaded.name = "Dave";
    await loadedEm.flush();
    reloaded.joinedAt = new Date("2026-02-01T00:00:00.000Z");
    reloaded.settings = { theme: "light", flags: [1, 2] };
    await loadedEm.flush();

    const updates = (await auditRows()).filter((l) => l.action === "updated");
    expect(updates.map((l) => [l.oldValues, l.newValues])).toEqual([
      [{ name: "Alice" }, { name: "Bob" }],
      [{ name: "Bob" }, { name: "Dave" }],
      [
        {
          joinedAt: "2026-01-01T00:00:00.000Z",
          settings: { theme: "dark", flags: [1, 2] },
        },
        {
          joinedAt: "2026-02-01T00:00:00.000Z",
          settings: { theme: "light", flags: [1, 2] },
        },
      ],
    ]);
  });

  it("joins composite primary keys with ':' on create, update and delete", async () => {
    const membership = em.create(Membership, { tenantId: "acme", userId: 7, role: "admin" });
    await em.flush();
    membership.role = "owner";
    await em.flush();
    await em.remove(membership).flush();

    const logs = await auditRows();
    expect(logs.map((l) => [l.action, l.entityId])).toEqual([
      ["created", "acme:7"],
      ["updated", "acme:7"],
      ["deleted", "acme:7"],
    ]);
    expect(logs[0].newValues).toEqual({ tenantId: "acme", userId: 7, role: "admin" });
    expect(logs[2].oldValues).toEqual({ tenantId: "acme", userId: 7, role: "owner" });
  });
});
