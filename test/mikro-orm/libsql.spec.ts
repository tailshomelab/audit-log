import "reflect-metadata";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { Test, type TestingModule } from "@nestjs/testing";
import { MikroOrmModule } from "@mikro-orm/nestjs";
import { MikroORM, defineConfig, defineEntity, p } from "@mikro-orm/libsql";
import { AuditLogService } from "../../src/core/audit-log.service.js";
import { Auditable } from "../../src/core/decorators/auditable.decorator.js";
import { MikroOrmAuditLogModule } from "../../src/mikro-orm/mikro-orm-audit-log.module.js";
import { MikroOrmAuditLogSchema } from "../../src/mikro-orm/mikro-orm-audit-log.schema.js";

@Auditable()
class Account {
  declare id: number;
  declare name: string;
  declare profile: Record<string, any> | null;
}
const AccountSchema = defineEntity({
  name: "Account",
  tableName: "accounts",
  properties: {
    id: p.integer().primary().autoincrement(),
    name: p.string(),
    profile: p.json<Record<string, any>>().nullable(),
  },
});
AccountSchema.setClass(Account);

describe("libSQL local file database", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "audit-"));
  const dbName = path.join(dir, "audit.db");

  afterAll(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const boot = async (): Promise<TestingModule> => {
    const module = await Test.createTestingModule({
      imports: [
        MikroOrmModule.forRoot(
          defineConfig({ dbName, entities: [MikroOrmAuditLogSchema, AccountSchema] }),
        ),
        MikroOrmAuditLogModule.forRoot({ metadata: { source: "file" } }),
      ],
    }).compile();
    await module.init();
    return module;
  };

  it("returns records written before the ORM was closed and reopened, JSON intact", async () => {
    const first = await boot();
    const orm = first.get(MikroORM);
    await orm.schema.create();

    const em = orm.em.fork();
    const account = em.create(Account, { name: "Alice", profile: { tags: ["a", "b"], n: 1 } });
    await em.flush();
    account.profile = { tags: ["a"], n: 2 };
    await em.flush();
    await first.get(AuditLogService).log({
      action: "updated",
      entityType: "Account",
      entityId: String(account.id),
      oldValues: { nested: { deep: [1, { x: null }] } },
      newValues: { nested: { deep: [2] } },
    });
    await first.close();
    expect(await orm.isConnected()).toBe(false);
    expect(fs.existsSync(dbName)).toBe(true);

    const second = await boot();
    try {
      const logs = await second.get(AuditLogService).getAuditLogs("Account", String(account.id));
      const byAction = (action: string) => logs.filter((l) => l.action === action);

      expect(logs).toHaveLength(3);
      expect(byAction("created")[0].newValues).toEqual({
        name: "Alice",
        profile: { tags: ["a", "b"], n: 1 },
      });
      expect(byAction("updated").map((l) => [l.oldValues, l.newValues])).toEqual(
        expect.arrayContaining([
          [{ profile: { tags: ["a", "b"], n: 1 } }, { profile: { tags: ["a"], n: 2 } }],
          [{ nested: { deep: [1, { x: null }] } }, { nested: { deep: [2] } }],
        ]),
      );
      expect(logs.every((l) => l.metadata?.source === "file")).toBe(true);
      expect(logs.every((l) => l.createdAt instanceof Date)).toBe(true);
    } finally {
      await second.close();
    }
  });
});
