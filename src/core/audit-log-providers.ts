import type { Provider, Type } from "@nestjs/common";
import { ModuleRef } from "@nestjs/core";
import {
  AUDIT_LOG_ACTOR_RESOLVER,
  AUDIT_LOG_OPTIONS,
  AUDIT_LOG_STORAGE,
} from "./audit-log.constants.js";
import { AuditLogService } from "./audit-log.service.js";
import { AuditRecorder } from "./audit-recorder.js";
import type {
  AuditLogAsyncOptions,
  AuditLogModuleOptions,
} from "./interfaces/audit-log-options.interface.js";
import type { AuditLogStorage } from "./interfaces/audit-log-storage.interface.js";

/** What an ORM adapter module contributes to the shared providers. */
export interface AuditLogAdapter {
  /** Registered under `AUDIT_LOG_STORAGE`. */
  storage: Type<AuditLogStorage>;
  /** The adapter's change-capture subscriber, which injects `AuditRecorder`. */
  subscriber: Type<unknown>;
}

/** The tokens every adapter module exports to the application. */
export const AUDIT_LOG_EXPORTS = [AuditLogService, AUDIT_LOG_OPTIONS];

function sharedProviders(adapter: AuditLogAdapter): Provider[] {
  return [
    { provide: AUDIT_LOG_STORAGE, useClass: adapter.storage },
    AuditLogService,
    AuditRecorder,
    adapter.subscriber,
  ];
}

export function createAuditLogProviders(
  options: AuditLogModuleOptions,
  adapter: AuditLogAdapter,
): Provider[] {
  const providers: Provider[] = [
    { provide: AUDIT_LOG_OPTIONS, useValue: options },
    ...sharedProviders(adapter),
  ];
  if (options.actorResolver) {
    providers.push({ provide: AUDIT_LOG_ACTOR_RESOLVER, useClass: options.actorResolver });
  }
  return providers;
}

export function createAuditLogAsyncProviders(
  asyncOptions: AuditLogAsyncOptions,
  adapter: AuditLogAdapter,
): Provider[] {
  return [
    {
      provide: AUDIT_LOG_OPTIONS,
      useFactory: asyncOptions.useFactory,
      inject: asyncOptions.inject ?? [],
    },
    {
      provide: AUDIT_LOG_ACTOR_RESOLVER,
      useFactory: (options: AuditLogModuleOptions, moduleRef: ModuleRef) =>
        options.actorResolver ? moduleRef.create(options.actorResolver) : null,
      inject: [AUDIT_LOG_OPTIONS, ModuleRef],
    },
    ...sharedProviders(adapter),
  ];
}
