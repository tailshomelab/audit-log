// Type-checked only (`pnpm exec tsc --noEmit -p tsconfig.fixtures.json`, after
// `pnpm run build`), never run: the README's Turso configuration compiled, with no network,
// against the published types that the package's exports map resolves from `dist/`.
import { Module } from "@nestjs/common";
import { MikroOrmModule } from "@mikro-orm/nestjs";
import { defineConfig } from "@mikro-orm/libsql";
import { MikroOrmAuditLogModule, MikroOrmAuditLogSchema } from "@nestbolt/audit-log/mikro-orm";

@Module({
  imports: [
    MikroOrmModule.forRoot(
      defineConfig({
        dbName: "libsql://example.turso.io",
        password: "token",
        entities: [MikroOrmAuditLogSchema],
      }),
    ),
    MikroOrmAuditLogModule.forRoot({}),
  ],
})
export class TursoAppModule {}
