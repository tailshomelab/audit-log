import { DynamicModule, Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
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
import { TypeOrmAuditLogEntity } from "./typeorm-audit-log.entity.js";
import { TypeOrmAuditLogStorage } from "./typeorm-audit-log.storage.js";
import { TypeOrmAuditSubscriber } from "./typeorm-audit.subscriber.js";

const adapter: AuditLogAdapter = {
  storage: TypeOrmAuditLogStorage,
  subscriber: TypeOrmAuditSubscriber,
};

/**
 * Registers the audit log for a TypeORM application. Requires a configured
 * `TypeOrmModule.forRoot()` connection whose entities include `TypeOrmAuditLogEntity`.
 */
@Module({})
export class TypeOrmAuditLogModule {
  static forRoot(options: AuditLogModuleOptions = {}): DynamicModule {
    return {
      module: TypeOrmAuditLogModule,
      global: true,
      imports: [TypeOrmModule.forFeature([TypeOrmAuditLogEntity])],
      providers: createAuditLogProviders(options, adapter),
      exports: AUDIT_LOG_EXPORTS,
    };
  }

  static forRootAsync(asyncOptions: AuditLogAsyncOptions): DynamicModule {
    return {
      module: TypeOrmAuditLogModule,
      global: true,
      imports: [...(asyncOptions.imports ?? []), TypeOrmModule.forFeature([TypeOrmAuditLogEntity])],
      providers: createAuditLogAsyncProviders(asyncOptions, adapter),
      exports: AUDIT_LOG_EXPORTS,
    };
  }
}
