import { DynamicModule, Module, type Provider } from "@nestjs/common";
import { ModuleRef } from "@nestjs/core";
import { TypeOrmModule } from "@nestjs/typeorm";
import { AuditLogEntity } from "./entities/audit-log.entity";
import { AUDIT_LOG_OPTIONS } from "./audit-log.constants";
import { AuditLogService } from "./audit-log.service";
import { AuditSubscriber } from "./audit-log.subscriber";
import type {
  AuditLogModuleOptions,
  AuditLogAsyncOptions,
} from "./interfaces/audit-log-options.interface";

@Module({})
export class AuditLogModule {
  static forRoot(options: AuditLogModuleOptions = {}): DynamicModule {
    const providers: Provider[] = [
      { provide: AUDIT_LOG_OPTIONS, useValue: options },
      AuditLogService,
      AuditSubscriber,
    ];

    if (options.actorResolver) {
      providers.push({ provide: "ActorResolver", useClass: options.actorResolver });
    }

    return {
      module: AuditLogModule,
      global: true,
      imports: [TypeOrmModule.forFeature([AuditLogEntity])],
      providers,
      exports: [AuditLogService, AUDIT_LOG_OPTIONS],
    };
  }

  static forRootAsync(asyncOptions: AuditLogAsyncOptions): DynamicModule {
    const providers: Provider[] = [
      {
        provide: AUDIT_LOG_OPTIONS,
        useFactory: asyncOptions.useFactory,
        inject: asyncOptions.inject ?? [],
      },
      {
        provide: "ActorResolver",
        useFactory: async (options: AuditLogModuleOptions, moduleRef: ModuleRef) => {
          if (options.actorResolver) {
            return moduleRef.create(options.actorResolver);
          }
          return null;
        },
        inject: [AUDIT_LOG_OPTIONS, ModuleRef],
      },
      AuditLogService,
      AuditSubscriber,
    ];

    return {
      module: AuditLogModule,
      global: true,
      imports: [...(asyncOptions.imports ?? []), TypeOrmModule.forFeature([AuditLogEntity])],
      providers,
      exports: [AuditLogService, AUDIT_LOG_OPTIONS],
    };
  }
}
