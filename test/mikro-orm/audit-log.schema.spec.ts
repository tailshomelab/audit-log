import "reflect-metadata";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MikroORM, defineConfig } from "@mikro-orm/libsql";
import { DataSource } from "typeorm";
import { MikroOrmAuditLogSchema } from "../../src/mikro-orm/mikro-orm-audit-log.schema.js";
import { TypeOrmAuditLogEntity } from "../../src/typeorm/typeorm-audit-log.entity.js";

interface ColumnInfo {
  name: string;
  notnull: number;
  pk: number;
}

interface TableShape {
  columns: Array<{ name: string; nullable: boolean; primary: boolean }>;
  indexes: string[][];
}

type Query = (sql: string) => Promise<any[]>;

/** Column names, nullability and the column sets of non-primary-key indexes. */
async function tableShape(query: Query): Promise<TableShape> {
  const columns = (await query("PRAGMA table_info(audit_logs)")) as ColumnInfo[];
  const indexList = (await query("PRAGMA index_list(audit_logs)")) as Array<{
    name: string;
    origin: string;
  }>;
  const indexes: string[][] = [];
  for (const index of indexList.filter((i) => i.origin === "c")) {
    const info = (await query(`PRAGMA index_info('${index.name}')`)) as Array<{
      seqno: number;
      name: string;
    }>;
    indexes.push(info.sort((a, b) => a.seqno - b.seqno).map((c) => c.name));
  }
  return {
    columns: columns
      .map((c) => ({ name: c.name, nullable: c.notnull === 0 && c.pk === 0, primary: c.pk > 0 }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    indexes: indexes.sort((a, b) => a.join().localeCompare(b.join())),
  };
}

describe("MikroOrmAuditLogSchema", () => {
  let orm: MikroORM;
  let dataSource: DataSource;

  beforeAll(async () => {
    orm = await MikroORM.init(
      defineConfig({ dbName: ":memory:", entities: [MikroOrmAuditLogSchema] }),
    );
    await orm.schema.create();

    dataSource = new DataSource({
      type: "better-sqlite3",
      database: ":memory:",
      entities: [TypeOrmAuditLogEntity],
      synchronize: true,
    });
    await dataSource.initialize();
  });

  afterAll(async () => {
    await orm?.close(true);
    await dataSource?.destroy();
  });

  it("matches the TypeORM table's columns, nullability and indexed column sets", async () => {
    const mikro = await tableShape((sql) => orm.em.getConnection().execute(sql));
    const typeorm = await tableShape((sql) => dataSource.query(sql));

    expect(mikro).toEqual(typeorm);
    expect(mikro.columns.map((c) => c.name)).toEqual([
      "action",
      "actor_id",
      "actor_type",
      "created_at",
      "entity_id",
      "entity_type",
      "id",
      "ip_address",
      "metadata",
      "new_values",
      "old_values",
      "user_agent",
    ]);
    expect(mikro.indexes).toEqual([
      ["action"],
      ["actor_type", "actor_id"],
      ["created_at"],
      ["entity_type", "entity_id"],
    ]);
  });

  it("generates a UUID id and created_at on insert", async () => {
    const em = orm.em.fork();
    const record = em.create(MikroOrmAuditLogSchema, {
      action: "created",
      entityType: "User",
      entityId: "u-1",
      newValues: { name: "Alice" },
    });
    await em.flush();

    expect(record.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(record.createdAt).toBeInstanceOf(Date);
    const [row] = await orm.em.fork().find(MikroOrmAuditLogSchema, { entityId: "u-1" });
    expect(row.newValues).toEqual({ name: "Alice" });
    expect(row.oldValues).toBeNull();
  });
});
