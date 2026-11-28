// Bun smoke test (design.md D11): `pnpm run build && bun scripts/bun-smoke.mjs`.
// Plain JS on the built package, so Bun's TypeScript transpiler is not involved:
// the decorators are applied by hand. Also runs on Node. Exits non-zero on failure.
import "reflect-metadata";
import assert from "node:assert/strict";
import { Module } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { MikroOrmModule } from "@mikro-orm/nestjs";
import { MikroORM, defineConfig, defineEntity, p } from "@mikro-orm/libsql";
import { AuditLogService, Auditable } from "@nestbolt/audit-log";
import { MikroOrmAuditLogModule, MikroOrmAuditLogSchema } from "@nestbolt/audit-log/mikro-orm";

const runtime = typeof Bun === "undefined" ? `Node ${process.version}` : `Bun ${Bun.version}`;

// The TypeORM adapter is not supported on Bun (no database driver); check that it loads.
const typeorm = await import("@nestbolt/audit-log/typeorm");
assert.equal(typeof typeorm.TypeOrmAuditLogModule, "function");

class User {}
Auditable()(User);
const UserSchema = defineEntity({
  name: "User",
  tableName: "users",
  properties: { id: p.integer().primary().autoincrement(), name: p.string() },
});
UserSchema.setClass(User);

class AppModule {}
Module({
  imports: [
    MikroOrmModule.forRoot(
      defineConfig({ dbName: ":memory:", entities: [MikroOrmAuditLogSchema, UserSchema] }),
    ),
    MikroOrmAuditLogModule.forRoot({}),
  ],
})(AppModule);

const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
try {
  const orm = app.get(MikroORM);
  await orm.schema.create();

  const em = orm.em.fork();
  const user = em.create(User, { name: "Alice" });
  await em.flush();
  user.name = "Bob";
  await em.flush();
  em.remove(user);
  await em.flush();

  const logs = await app.get(AuditLogService).getAuditLogs("User", String(user.id));
  assert.deepEqual(logs.map((log) => log.action).sort(), ["created", "deleted", "updated"]);
  const updated = logs.find((log) => log.action === "updated");
  assert.deepEqual([updated.oldValues, updated.newValues], [{ name: "Alice" }, { name: "Bob" }]);
  console.log(`bun-smoke: ok on ${runtime} (${logs.length} audit records)`);
} finally {
  await app.close();
}
