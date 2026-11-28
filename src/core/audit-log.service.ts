import { Inject, Injectable, OnModuleDestroy, OnModuleInit, Optional } from "@nestjs/common";
import { ModuleRef } from "@nestjs/core";
import {
  AUDIT_LOG_ACTOR_RESOLVER,
  AUDIT_LOG_OPTIONS,
  AUDIT_LOG_STORAGE,
} from "./audit-log.constants.js";
import { AUDIT_LOG_EVENTS } from "./events/audit-log.events.js";
import type { ActorResolver, AuditActor } from "./interfaces/actor-resolver.interface.js";
import type {
  AuditAction,
  AuditLogModuleOptions,
} from "./interfaces/audit-log-options.interface.js";
import type { AuditLogRecord } from "./interfaces/audit-log-record.interface.js";
import type {
  AuditLogQueryOptions,
  AuditLogStorage,
} from "./interfaces/audit-log-storage.interface.js";

interface EventEmitterLike {
  emit(event: string, ...args: any[]): boolean;
}

export interface ManualAuditLogParams {
  action: AuditAction;
  entityType: string;
  entityId: string;
  oldValues?: Record<string, any> | null;
  newValues?: Record<string, any> | null;
  actor?: AuditActor;
  metadata?: Record<string, any>;
  ipAddress?: string;
  userAgent?: string;
}

@Injectable()
export class AuditLogService implements OnModuleInit, OnModuleDestroy {
  private static instance: AuditLogService | null = null;

  constructor(
    @Inject(AUDIT_LOG_OPTIONS) private readonly options: AuditLogModuleOptions,
    @Inject(AUDIT_LOG_STORAGE) private readonly storage: AuditLogStorage,
    @Inject(ModuleRef) private readonly moduleRef: ModuleRef,
    @Optional()
    @Inject(AUDIT_LOG_ACTOR_RESOLVER)
    private readonly actorResolver?: ActorResolver | null,
  ) {}

  private eventEmitter: EventEmitterLike | null = null;

  async onModuleInit(): Promise<void> {
    AuditLogService.instance = this;
    this.eventEmitter = await resolveEventEmitter(this.moduleRef);
  }

  onModuleDestroy(): void {
    if (AuditLogService.instance === this) {
      AuditLogService.instance = null;
    }
  }

  /**
   * The active service, used only by `AuditableMixin`, whose methods run on entity
   * instances outside dependency injection. Everything else receives the service through DI.
   */
  static getInstance(): AuditLogService | null {
    return AuditLogService.instance;
  }

  getOptions(): AuditLogModuleOptions {
    return this.options;
  }

  async log(params: ManualAuditLogParams): Promise<AuditLogRecord> {
    const actor = params.actor ?? (await this.resolveActor());

    const saved = await this.storage.save({
      action: params.action,
      entityType: params.entityType,
      entityId: params.entityId,
      oldValues: params.oldValues ?? null,
      newValues: params.newValues ?? null,
      actorType: actor?.type ?? null,
      actorId: actor?.id ?? null,
      metadata: params.metadata ?? this.options.metadata ?? null,
      ipAddress: params.ipAddress ?? null,
      userAgent: params.userAgent ?? null,
    });

    this.notifyLogged(saved);
    return saved;
  }

  getAuditLogs(
    entityType: string,
    entityId: string,
    options?: AuditLogQueryOptions,
  ): Promise<AuditLogRecord[]> {
    return this.storage.findByEntity(entityType, entityId, options);
  }

  getAuditLogsByActor(
    actorType: string,
    actorId: string,
    options?: AuditLogQueryOptions,
  ): Promise<AuditLogRecord[]> {
    return this.storage.findByActor(actorType, actorId, options);
  }

  getLatestAuditLog(entityType: string, entityId: string): Promise<AuditLogRecord | null> {
    return this.storage.findLatest(entityType, entityId);
  }

  async resolveActor(): Promise<AuditActor | null> {
    if (this.actorResolver) {
      return this.actorResolver.resolve();
    }
    return this.options.defaultActor ?? null;
  }

  /** Emits `audit.logged` for a persisted record when an event emitter is registered. */
  notifyLogged(record: AuditLogRecord): void {
    this.eventEmitter?.emit(AUDIT_LOG_EVENTS.LOGGED, { auditLog: record });
  }
}

/**
 * The application's `EventEmitter2` from `@nestjs/event-emitter`, looked up by its class
 * token (the provider `EventEmitterModule.forRoot()` registers). The package is an optional
 * peer, so it is imported lazily: without it, or without the module, no event is emitted.
 */
async function resolveEventEmitter(moduleRef: ModuleRef): Promise<EventEmitterLike | null> {
  let EventEmitter2: typeof import("@nestjs/event-emitter").EventEmitter2;
  try {
    ({ EventEmitter2 } = await import("@nestjs/event-emitter"));
  } catch {
    // The optional peer is not installed, so there is no emitter to notify.
    return null;
  }
  try {
    return moduleRef.get(EventEmitter2, { strict: false });
  } catch {
    // The package is installed but `EventEmitterModule` is not imported by the application.
    return null;
  }
}
