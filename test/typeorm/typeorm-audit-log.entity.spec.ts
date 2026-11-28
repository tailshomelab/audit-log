import { describe, it, expect, beforeAll, afterAll } from "vitest";
import "reflect-metadata";
import { DataSource } from "typeorm";
import { TypeOrmAuditLogEntity } from "../../src/typeorm/typeorm-audit-log.entity.js";

interface ColumnInfo {
  name: string;
  notnull: number;
  pk: number;
}

describe("TypeOrmAuditLogEntity", () => {
  let dataSource: DataSource;

  beforeAll(async () => {
    dataSource = new DataSource({
      type: "better-sqlite3",
      database: ":memory:",
      entities: [TypeOrmAuditLogEntity],
      synchronize: true,
    });
    await dataSource.initialize();
  });

  afterAll(async () => {
    await dataSource?.destroy();
  });

  it("maps to audit_logs with the specified columns and nullability", async () => {
    const columns: ColumnInfo[] = await dataSource.query("PRAGMA table_info(audit_logs)");

    expect(
      Object.fromEntries(columns.map((c) => [c.name, { notnull: c.notnull, pk: c.pk }])),
    ).toEqual({
      id: { notnull: 1, pk: 1 },
      action: { notnull: 1, pk: 0 },
      entity_type: { notnull: 1, pk: 0 },
      entity_id: { notnull: 1, pk: 0 },
      actor_type: { notnull: 0, pk: 0 },
      actor_id: { notnull: 0, pk: 0 },
      old_values: { notnull: 0, pk: 0 },
      new_values: { notnull: 0, pk: 0 },
      metadata: { notnull: 0, pk: 0 },
      ip_address: { notnull: 0, pk: 0 },
      user_agent: { notnull: 0, pk: 0 },
      created_at: { notnull: 1, pk: 0 },
    });
  });

  it("indexes the four specified column sets", async () => {
    const indexes: Array<{ name: string; origin: string }> = await dataSource.query(
      "PRAGMA index_list(audit_logs)",
    );
    const columnSets: string[] = [];
    for (const index of indexes.filter((i) => i.origin === "c")) {
      const info: Array<{ seqno: number; name: string }> = await dataSource.query(
        `PRAGMA index_info("${index.name}")`,
      );
      columnSets.push(
        info
          .sort((a, b) => a.seqno - b.seqno)
          .map((c) => c.name)
          .join(","),
      );
    }

    expect(columnSets.sort()).toEqual(
      ["entity_type,entity_id", "actor_type,actor_id", "action", "created_at"].sort(),
    );
  });

  it("generates the UUID id and created_at on insert", async () => {
    const repository = dataSource.getRepository(TypeOrmAuditLogEntity);
    const saved = await repository.save(
      repository.create({ action: "created", entityType: "User", entityId: "user-1" }),
    );

    expect(saved.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(saved.createdAt).toBeInstanceOf(Date);
  });
});
