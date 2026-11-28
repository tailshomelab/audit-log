// Checks the published entry points of the built package (run `pnpm run build` first).
// Each case runs in a fresh Node process. ORM packages are made unresolvable with
// scripts/block-packages.mjs to prove that an entry point loads without them.
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const blockHook = fileURLToPath(new URL("./block-packages.mjs", import.meta.url));

const TYPEORM = ["typeorm", "@nestjs/typeorm"];
const MIKRO_ORM = ["@mikro-orm/*"];

function run(name, { blocked = [], esm, cjs, expectFailure = false }) {
  const args = [];
  if (blocked.length > 0) args.push("--import", blockHook);
  if (esm) args.push("--input-type=module", "--eval", esm);
  else args.push("--eval", cjs);

  const result = spawnSync(process.execPath, args, {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, BLOCKED_PACKAGES: blocked.join(",") },
  });
  const ok = expectFailure
    ? result.status !== 0 && /blocked by scripts\/block-packages\.mjs/.test(result.stderr)
    : result.status === 0;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}`);
  if (!ok) {
    process.stdout.write(result.stdout);
    process.stderr.write(result.stderr);
    process.exitCode = 1;
  }
}

const assert = `import assert from "node:assert/strict";`;

// (a) The root entry point is the ORM-free core.
run("(a) '.' loads with typeorm, @nestjs/typeorm and @mikro-orm/* blocked", {
  blocked: [...TYPEORM, ...MIKRO_ORM],
  esm: `${assert}
    const core = await import("@nestbolt/audit-log");
    for (const name of ["AuditLogService", "Auditable", "AuditableMixin", "AUDIT_LOG_EVENTS",
      "AUDIT_LOG_OPTIONS", "AUDIT_LOG_STORAGE", "AUDIT_LOG_ACTOR_RESOLVER",
      "AuditLogNotInitializedException", "computeDiff"]) {
      assert.ok(core[name], "missing core export " + name);
    }
    const adapterSymbols = Object.keys(core).filter((k) => /typeorm|mikro/i.test(k));
    assert.deepEqual(adapterSymbols, [], "root exports adapter symbols");`,
});

// (b) The TypeORM entry point needs no MikroORM package. A4: every TypeORM and
// @nestjs/typeorm named import the adapter uses resolves under ESM.
run("(b) './typeorm' loads with @mikro-orm/* blocked; TypeORM named imports resolve", {
  blocked: MIKRO_ORM,
  esm: `${assert}
    import { Column, CreateDateColumn, DataSource, Entity, Index, PrimaryGeneratedColumn,
      Repository } from "typeorm";
    import { InjectRepository, TypeOrmModule } from "@nestjs/typeorm";
    for (const [name, value] of Object.entries({ Column, CreateDateColumn, DataSource, Entity,
      Index, PrimaryGeneratedColumn, Repository, InjectRepository, TypeOrmModule })) {
      assert.equal(typeof value, "function", name + " is not a function");
    }
    const adapter = await import("@nestbolt/audit-log/typeorm");
    assert.deepEqual(Object.keys(adapter).sort(),
      ["TypeOrmAuditLogEntity", "TypeOrmAuditLogModule", "TypeOrmAuditLogStorage"]);
    const dynamic = adapter.TypeOrmAuditLogModule.forRoot({});
    assert.equal(dynamic.module, adapter.TypeOrmAuditLogModule);`,
});

// (c) The MikroORM entry point needs no TypeORM package.
run("(c) './mikro-orm' loads with typeorm and @nestjs/typeorm blocked", {
  blocked: TYPEORM,
  esm: `${assert}
    const adapter = await import("@nestbolt/audit-log/mikro-orm");
    assert.deepEqual(Object.keys(adapter).sort(),
      ["MikroOrmAuditLogModule", "MikroOrmAuditLogSchema", "MikroOrmAuditLogStorage"]);
    const dynamic = adapter.MikroOrmAuditLogModule.forRoot({});
    assert.equal(dynamic.module, adapter.MikroOrmAuditLogModule);`,
});

// (d) CommonJS consumers load the ESM package through require(esm).
run("(d) require() of '.', './typeorm' and './mikro-orm' works through require(esm)", {
  cjs: `const core = require("@nestbolt/audit-log");
    if (typeof core.AuditLogService !== "function") throw new Error("AuditLogService missing");
    const typeorm = require("@nestbolt/audit-log/typeorm");
    if (typeof typeorm.TypeOrmAuditLogModule !== "function") {
      throw new Error("TypeOrmAuditLogModule missing");
    }
    const mikroOrm = require("@nestbolt/audit-log/mikro-orm");
    if (typeof mikroOrm.MikroOrmAuditLogModule !== "function") {
      throw new Error("MikroOrmAuditLogModule missing");
    }`,
});

// Controls: the hook really blocks, so (a)-(c) are not vacuous.
run("(control) './typeorm' fails with typeorm blocked", {
  blocked: TYPEORM,
  esm: `await import("@nestbolt/audit-log/typeorm");`,
  expectFailure: true,
});
run("(control) './mikro-orm' fails with @mikro-orm/* blocked", {
  blocked: MIKRO_ORM,
  esm: `await import("@nestbolt/audit-log/mikro-orm");`,
  expectFailure: true,
});
