import { describe, it, expect, beforeEach, afterEach } from "vitest";
import "reflect-metadata";
import { Test, TestingModule } from "@nestjs/testing";
import { TypeOrmModule } from "@nestjs/typeorm";
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Repository,
  DataSource,
} from "typeorm";
import { AuditLogService } from "../src/audit-log.service";
import { AuditLogEntity } from "../src/entities/audit-log.entity";
import { AuditSubscriber } from "../src/audit-log.subscriber";
import { Auditable } from "../src/decorators/auditable.decorator";
import { AUDIT_LOG_OPTIONS } from "../src/audit-log.constants";

// --- Test Entities ---

@Auditable()
@Entity("test_users")
class TestUser {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column()
  name!: string;

  @Column()
  email!: string;

  @Column({ type: "varchar", nullable: true })
  password!: string | null;

  @CreateDateColumn({ name: "created_at" })
  createdAt!: Date;

  @UpdateDateColumn({ name: "updated_at" })
  updatedAt!: Date;
}

@Auditable({ except: ["secret"] })
@Entity("test_items")
class TestItemWithExcept {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column()
  name!: string;

  @Column({ type: "varchar", nullable: true })
  secret!: string | null;
}

@Auditable({ only: ["title"] })
@Entity("test_articles")
class TestArticleWithOnly {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column()
  title!: string;

  @Column({ type: "varchar", nullable: true })
  content!: string | null;
}

@Auditable({ events: ["created", "deleted"] })
@Entity("test_logs_entity")
class TestLogOnlyCreateDelete {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column()
  value!: string;
}

@Entity("test_posts")
class TestPostNotAuditable {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column()
  title!: string;
}

// --- Tests ---

describe("AuditSubscriber", () => {
  let module: TestingModule;
  let userRepo: Repository<TestUser>;
  let postRepo: Repository<TestPostNotAuditable>;
  let itemRepo: Repository<TestItemWithExcept>;
  let articleRepo: Repository<TestArticleWithOnly>;
  let logEntityRepo: Repository<TestLogOnlyCreateDelete>;
  let auditLogRepo: Repository<AuditLogEntity>;

  beforeEach(async () => {
    module = await Test.createTestingModule({
      imports: [
        TypeOrmModule.forRoot({
          type: "better-sqlite3",
          database: ":memory:",
          entities: [
            AuditLogEntity,
            TestUser,
            TestPostNotAuditable,
            TestItemWithExcept,
            TestArticleWithOnly,
            TestLogOnlyCreateDelete,
          ],
          synchronize: true,
        }),
        TypeOrmModule.forFeature([AuditLogEntity]),
      ],
      providers: [{ provide: AUDIT_LOG_OPTIONS, useValue: {} }, AuditLogService, AuditSubscriber],
    }).compile();

    await module.init();

    const ds = module.get(DataSource);
    userRepo = ds.getRepository(TestUser);
    postRepo = ds.getRepository(TestPostNotAuditable);
    itemRepo = ds.getRepository(TestItemWithExcept);
    articleRepo = ds.getRepository(TestArticleWithOnly);
    logEntityRepo = ds.getRepository(TestLogOnlyCreateDelete);
    auditLogRepo = ds.getRepository(AuditLogEntity);
  });

  afterEach(async () => {
    await module?.close();
  });

  describe("insert tracking", () => {
    it("should create audit log with action 'created' after entity insert", async () => {
      const user = userRepo.create({ name: "Alice", email: "alice@test.com" });
      await userRepo.save(user);

      const logs = await auditLogRepo.find({ where: { entityType: "TestUser" } });
      expect(logs).toHaveLength(1);
      expect(logs[0].action).toBe("created");
      expect(logs[0].entityType).toBe("TestUser");
      expect(logs[0].entityId).toBe(user.id);
    });

    it("should have newValues with entity fields and null oldValues", async () => {
      const user = userRepo.create({ name: "Alice", email: "alice@test.com" });
      await userRepo.save(user);

      const logs = await auditLogRepo.find({ where: { entityType: "TestUser" } });
      expect(logs[0].newValues).toEqual(
        expect.objectContaining({ name: "Alice", email: "alice@test.com" }),
      );
      expect(logs[0].oldValues).toBeNull();
    });

    it("should use auditableType from decorator metadata", async () => {
      const user = userRepo.create({ name: "Alice", email: "alice@test.com" });
      await userRepo.save(user);

      const logs = await auditLogRepo.find();
      expect(logs[0].entityType).toBe("TestUser");
    });
  });

  describe("update tracking", () => {
    it("should create audit log with action 'updated' after entity update", async () => {
      const user = userRepo.create({ name: "Alice", email: "alice@test.com" });
      await userRepo.save(user);

      user.name = "Bob";
      await userRepo.save(user);

      const logs = await auditLogRepo.find({
        where: { entityType: "TestUser", action: "updated" },
      });
      expect(logs).toHaveLength(1);
      expect(logs[0].action).toBe("updated");
    });

    it("should record only changed fields in oldValues/newValues", async () => {
      const user = userRepo.create({ name: "Alice", email: "alice@test.com" });
      await userRepo.save(user);

      user.name = "Bob";
      await userRepo.save(user);

      const logs = await auditLogRepo.find({
        where: { entityType: "TestUser", action: "updated" },
      });
      expect(logs[0].oldValues).toEqual({ name: "Alice" });
      expect(logs[0].newValues).toEqual({ name: "Bob" });
    });

    it("should not create audit log if no fields actually changed", async () => {
      const user = userRepo.create({ name: "Alice", email: "alice@test.com" });
      await userRepo.save(user);

      // Save again without changing anything meaningful
      await userRepo.save(user);

      const updateLogs = await auditLogRepo.find({
        where: { entityType: "TestUser", action: "updated" },
      });
      expect(updateLogs).toHaveLength(0);
    });
  });

  describe("delete tracking", () => {
    it("should create audit log with action 'deleted' after entity remove", async () => {
      const user = userRepo.create({ name: "Alice", email: "alice@test.com" });
      await userRepo.save(user);
      const userId = user.id;

      await userRepo.remove(user);

      const logs = await auditLogRepo.find({ where: { action: "deleted" } });
      expect(logs).toHaveLength(1);
      expect(logs[0].entityType).toBe("TestUser");
      expect(logs[0].entityId).toBe(userId);
    });

    it("should have oldValues with entity state and null newValues", async () => {
      const user = userRepo.create({ name: "Alice", email: "alice@test.com" });
      await userRepo.save(user);

      await userRepo.remove(user);

      const logs = await auditLogRepo.find({ where: { action: "deleted" } });
      expect(logs[0].oldValues).toEqual(
        expect.objectContaining({ name: "Alice", email: "alice@test.com" }),
      );
      expect(logs[0].newValues).toBeNull();
    });
  });

  describe("non-auditable entities", () => {
    it("should NOT create audit log for entities without @Auditable()", async () => {
      const post = postRepo.create({ title: "Hello" });
      await postRepo.save(post);

      const logs = await auditLogRepo.find();
      expect(logs).toHaveLength(0);
    });
  });

  describe("field filtering", () => {
    it("should exclude fields listed in except", async () => {
      const item = itemRepo.create({ name: "Item", secret: "hidden" });
      await itemRepo.save(item);

      const logs = await auditLogRepo.find({ where: { entityType: "TestItemWithExcept" } });
      expect(logs[0].newValues).not.toHaveProperty("secret");
      expect(logs[0].newValues).toHaveProperty("name", "Item");
    });

    it("should only track fields listed in only", async () => {
      const article = articleRepo.create({ title: "Hello", content: "World" });
      await articleRepo.save(article);

      const logs = await auditLogRepo.find({ where: { entityType: "TestArticleWithOnly" } });
      expect(logs[0].newValues).toEqual({ title: "Hello" });
      expect(logs[0].newValues).not.toHaveProperty("content");
    });
  });

  describe("event filtering", () => {
    it("should not log updates when events only includes created and deleted", async () => {
      const logEntity = logEntityRepo.create({ value: "initial" });
      await logEntityRepo.save(logEntity);

      logEntity.value = "changed";
      await logEntityRepo.save(logEntity);

      await logEntityRepo.remove(logEntity);

      const logs = await auditLogRepo.find({
        where: { entityType: "TestLogOnlyCreateDelete" },
      });
      const actions = logs.map((l) => l.action);
      expect(actions).toContain("created");
      expect(actions).toContain("deleted");
      expect(actions).not.toContain("updated");
    });
  });

  describe("disabled actions (module-level)", () => {
    let moduleWithDisabled: TestingModule;
    let disabledUserRepo: Repository<TestUser>;
    let disabledAuditRepo: Repository<AuditLogEntity>;

    beforeEach(async () => {
      moduleWithDisabled = await Test.createTestingModule({
        imports: [
          TypeOrmModule.forRoot({
            type: "better-sqlite3",
            database: ":memory:",
            entities: [AuditLogEntity, TestUser],
            synchronize: true,
          }),
          TypeOrmModule.forFeature([AuditLogEntity]),
        ],
        providers: [
          { provide: AUDIT_LOG_OPTIONS, useValue: { disabledActions: ["deleted"] } },
          AuditLogService,
          AuditSubscriber,
        ],
      }).compile();

      await moduleWithDisabled.init();
      const ds = moduleWithDisabled.get(DataSource);
      disabledUserRepo = ds.getRepository(TestUser);
      disabledAuditRepo = ds.getRepository(AuditLogEntity);
    });

    afterEach(async () => {
      await moduleWithDisabled?.close();
    });

    it("should skip disabled actions", async () => {
      const user = disabledUserRepo.create({ name: "Alice", email: "alice@test.com" });
      await disabledUserRepo.save(user);
      await disabledUserRepo.remove(user);

      const logs = await disabledAuditRepo.find();
      const actions = logs.map((l) => l.action);
      expect(actions).toContain("created");
      expect(actions).not.toContain("deleted");
    });
  });

  describe("global excluded fields", () => {
    let moduleGlobal: TestingModule;
    let globalUserRepo: Repository<TestUser>;
    let globalAuditRepo: Repository<AuditLogEntity>;

    beforeEach(async () => {
      moduleGlobal = await Test.createTestingModule({
        imports: [
          TypeOrmModule.forRoot({
            type: "better-sqlite3",
            database: ":memory:",
            entities: [AuditLogEntity, TestUser],
            synchronize: true,
          }),
          TypeOrmModule.forFeature([AuditLogEntity]),
        ],
        providers: [
          { provide: AUDIT_LOG_OPTIONS, useValue: { globalExcludedFields: ["password"] } },
          AuditLogService,
          AuditSubscriber,
        ],
      }).compile();

      await moduleGlobal.init();
      const ds = moduleGlobal.get(DataSource);
      globalUserRepo = ds.getRepository(TestUser);
      globalAuditRepo = ds.getRepository(AuditLogEntity);
    });

    afterEach(async () => {
      await moduleGlobal?.close();
    });

    it("should exclude fields from globalExcludedFields", async () => {
      const user = globalUserRepo.create({
        name: "Alice",
        email: "alice@test.com",
        password: "secret123",
      });
      await globalUserRepo.save(user);

      const logs = await globalAuditRepo.find();
      expect(logs[0].newValues).not.toHaveProperty("password");
      expect(logs[0].newValues).toHaveProperty("name", "Alice");
    });
  });

  describe("actor resolution", () => {
    let moduleWithActor: TestingModule;
    let actorUserRepo: Repository<TestUser>;
    let actorAuditRepo: Repository<AuditLogEntity>;

    beforeEach(async () => {
      moduleWithActor = await Test.createTestingModule({
        imports: [
          TypeOrmModule.forRoot({
            type: "better-sqlite3",
            database: ":memory:",
            entities: [AuditLogEntity, TestUser],
            synchronize: true,
          }),
          TypeOrmModule.forFeature([AuditLogEntity]),
        ],
        providers: [
          { provide: AUDIT_LOG_OPTIONS, useValue: {} },
          {
            provide: "ActorResolver",
            useValue: { resolve: () => ({ type: "Admin", id: "admin-1" }) },
          },
          AuditLogService,
          AuditSubscriber,
        ],
      }).compile();

      await moduleWithActor.init();
      const ds = moduleWithActor.get(DataSource);
      actorUserRepo = ds.getRepository(TestUser);
      actorAuditRepo = ds.getRepository(AuditLogEntity);
    });

    afterEach(async () => {
      await moduleWithActor?.close();
    });

    it("should include actor info from resolver in audit log", async () => {
      const user = actorUserRepo.create({ name: "Alice", email: "alice@test.com" });
      await actorUserRepo.save(user);

      const logs = await actorAuditRepo.find();
      expect(logs[0].actorType).toBe("Admin");
      expect(logs[0].actorId).toBe("admin-1");
    });
  });
});
