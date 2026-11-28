import { DynamicModule, Module } from "@nestjs/common";
import { MikroOrmModule } from "@mikro-orm/nestjs";
import {
  AUDIT_LOG_EXPORTS,
  createAuditLogAsyncProviders,
  createAuditLogProviders,
  type AuditLogAdapter,
} from "../core/audit-log-providers.js";
import type {
  AuditLogAsyncOptions,
  AuditLogModuleOptions,
} from "../core/interfaces/audit-log-options.interface.js";
import { MikroOrmAuditLogSchema } from "./mikro-orm-audit-log.schema.js";
import { MikroOrmAuditLogStorage } from "./mikro-orm-audit-log.storage.js";
import { MikroOrmAuditSubscriber } from "./mikro-orm-audit.subscriber.js";

const adapter: AuditLogAdapter = {
  storage: MikroOrmAuditLogStorage,
  subscriber: MikroOrmAuditSubscriber,
};

/**
 * Registers the audit log for a MikroORM application. Requires a configured
 * `MikroOrmModule.forRoot(config)` whose entities include `MikroOrmAuditLogSchema`
 * (registered automatically with `autoLoadEntities`).
 */
@Module({})
export class MikroOrmAuditLogModule {
  static forRoot(options: AuditLogModuleOptions = {}): DynamicModule {
    return {
      module: MikroOrmAuditLogModule,
      global: true,
      imports: [MikroOrmModule.forFeature([MikroOrmAuditLogSchema])],
      providers: createAuditLogProviders(options, adapter),
      exports: AUDIT_LOG_EXPORTS,
    };
  }

  static forRootAsync(asyncOptions: AuditLogAsyncOptions): DynamicModule {
    return {
      module: MikroOrmAuditLogModule,
      global: true,
      imports: [
        ...(asyncOptions.imports ?? []),
        MikroOrmModule.forFeature([MikroOrmAuditLogSchema]),
      ],
      providers: createAuditLogAsyncProviders(asyncOptions, adapter),
      exports: AUDIT_LOG_EXPORTS,
    };
  }
}
