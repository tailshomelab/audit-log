import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import "reflect-metadata";
import { Test, TestingModule } from "@nestjs/testing";
import { TypeOrmModule } from "@nestjs/typeorm";
import {
  Column,
  DataSource,
  Entity,
  ManyToOne,
  PrimaryColumn,
  PrimaryGeneratedColumn,
  type Repository,
} from "typeorm";
import { AuditRecorder } from "../../src/core/audit-recorder.js";
import { Auditable } from "../../src/core/decorators/auditable.decorator.js";
import { TypeOrmAuditLogEntity } from "../../src/typeorm/typeorm-audit-log.entity.js";
import { TypeOrmAuditLogModule } from "../../src/typeorm/typeorm-audit-log.module.js";
import { eventEmitterModule } from "../parity/harness.js";

class Address {
  @Column({ type: "varchar" })
  city!: string;

  @Column({ type: "varchar" })
  country!: string;
}

@Entity("teams")
class Team {
  @PrimaryGeneratedColumn("increment")
  id!: number;

  @Column({ type: "varchar" })
  name!: string;
}

@Auditable()
@Entity("members")
class Member {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "varchar" })
  name!: string;

  @Column(() => Address)
  address!: Address;

  @ManyToOne(() => Team, { nullable: true })
  team!: Team | null;

  /** Not a column: must never reach the audit payload. */
  transientNote = "not persisted";

  get displayName(): string {
    return `Member ${this.name}`;
  }
}

@Auditable()
@Entity("memberships")
class Membership {
  @PrimaryColumn({ type: "varchar" })
  tenantId!: string;

  @PrimaryColumn({ type: "integer" })
  userId!: number;

  @Column({ type: "varchar" })
  role!: string;
}

describe("TypeOrmAuditSubscriber", () => {
  let module: TestingModule;
  let dataSource: DataSource;
  let members: Repository<Member>;
  let audit: Repository<TypeOrmAuditLogEntity>;
  let emit: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    emit = vi.fn().mockReturnValue(true);
    module = await Test.createTestingModule({
      imports: [
        TypeOrmModule.forRoot({
          type: "better-sqlite3",
          database: ":memory:",
          entities: [TypeOrmAuditLogEntity, Member, Team, Membership],
          synchronize: true,
        }),
        TypeOrmAuditLogModule.forRoot(),
        eventEmitterModule({ emit }),
      ],
    }).compile();
    await module.init();

    dataSource = module.get(DataSource);
    members = dataSource.getRepository(Member);
    audit = dataSource.getRepository(TypeOrmAuditLogEntity);
  });

  afterEach(async () => {
    await module?.close();
  });

  const newMember = (name = "Alice") =>
    members.create({ name, address: { city: "Lisbon", country: "PT" }, team: null });

  it("records only mapped columns: embedded objects whole, relations as their key", async () => {
    const team = await dataSource.getRepository(Team).save({ name: "Core" });
    const member = newMember();
    member.team = team;
    await members.save(member);

    const [log] = await audit.find();
    expect(log.newValues).toEqual({
      name: "Alice",
      address: { city: "Lisbon", country: "PT" },
      team: team.id,
    });
  });

  it("does not capture repository.update(), repository.delete() or query builder writes", async () => {
    const first = await members.save(newMember("Alice"));
    const second = await members.save(newMember("Bob"));
    await audit.clear();

    await members.update(first.id, { name: "Carol" });
    await dataSource
      .createQueryBuilder()
      .update(Member)
      .set({ name: "Dan" })
      .where("id = :id", { id: second.id })
      .execute();
    await members.delete(first.id);
    await dataSource
      .createQueryBuilder()
      .delete()
      .from(Member)
      .where("id = :id", { id: second.id })
      .execute();

    expect(await members.count()).toBe(0);
    expect(await audit.count()).toBe(0);
  });

  it("leaves neither the entity nor its record when the transaction rolls back", async () => {
    await expect(
      dataSource.transaction(async (manager) => {
        await manager.save(newMember());
        expect(await manager.count(TypeOrmAuditLogEntity)).toBe(1);
        throw new Error("rollback");
      }),
    ).rejects.toThrow("rollback");

    expect(await members.count()).toBe(0);
    expect(await audit.count()).toBe(0);
    expect(emit).not.toHaveBeenCalled();
  });

  it("emits audit.logged after the outer commit, only for savepoints that were released", async () => {
    await dataSource.transaction(async (manager) => {
      const runner = manager.queryRunner;
      if (!runner) throw new Error("transaction manager without a query runner");
      await manager.save(newMember("Outer"));

      await runner.startTransaction();
      await manager.save(newMember("Released"));
      await runner.commitTransaction();

      await runner.startTransaction();
      await manager.save(newMember("RolledBack"));
      await runner.rollbackTransaction();

      expect(emit).not.toHaveBeenCalled();
    });

    const logs = await audit.find();
    expect(logs.map((l) => l.newValues?.name).sort()).toEqual(["Outer", "Released"]);
    expect(emit.mock.calls.map(([, payload]) => payload.auditLog.id).sort()).toEqual(
      logs.map((l) => l.id).sort(),
    );
  });

  it("emits audit.logged after save()'s own transaction commits", async () => {
    await members.save(newMember());

    const [log] = await audit.find();
    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit.mock.calls[0][1].auditLog.id).toBe(log.id);
  });

  it("commits the user's operations when building the record throws", async () => {
    const recorder = module.get(AuditRecorder);
    const boom = () => {
      throw new Error("build failed");
    };
    vi.spyOn(recorder, "buildCreated").mockImplementation(boom);
    vi.spyOn(recorder, "buildUpdated").mockImplementation(boom);
    vi.spyOn(recorder, "buildDeleted").mockImplementation(boom);

    const member = await members.save(newMember());
    member.name = "Bob";
    await members.save(member);
    expect((await members.findOneByOrFail({ id: member.id })).name).toBe("Bob");
    await members.remove(member);

    expect(await members.count()).toBe(0);
    expect(await audit.count()).toBe(0);
    expect(emit).not.toHaveBeenCalled();
  });

  it("commits the user's transaction when the audit table is missing", async () => {
    await dataSource.query("DROP TABLE audit_logs");

    await dataSource.transaction(async (manager) => {
      const member = await manager.save(newMember());
      member.name = "Bob";
      await manager.save(member);
    });

    expect((await members.find()).map((m) => m.name)).toEqual(["Bob"]);
  });

  it("joins composite primary keys with ':' on create, update and delete", async () => {
    const memberships = dataSource.getRepository(Membership);
    const membership = await memberships.save(
      memberships.create({ tenantId: "acme", userId: 7, role: "admin" }),
    );
    membership.role = "owner";
    await memberships.save(membership);
    await memberships.remove(membership);

    const logs = await audit.find();
    expect(logs.map((l) => [l.action, l.entityId])).toEqual(
      expect.arrayContaining([
        ["created", "acme:7"],
        ["updated", "acme:7"],
        ["deleted", "acme:7"],
      ]),
    );
    expect(logs).toHaveLength(3);
    expect(logs.find((l) => l.action === "created")?.newValues).toEqual({
      tenantId: "acme",
      userId: 7,
      role: "admin",
    });
  });
});
