import { Inject, Injectable, OnModuleDestroy, OnModuleInit, Optional } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { AuditLogEntity } from "./entities/audit-log.entity";
import { AUDIT_LOG_EVENTS } from "./events/audit-log.events";
import { AUDIT_LOG_OPTIONS } from "./audit-log.constants";
import type { AuditLogModuleOptions, AuditAction } from "./interfaces/audit-log-options.interface";
import type { ActorResolver, AuditActor } from "./interfaces/actor-resolver.interface";

interface EventEmitterLike {
  emit(event: string, ...args: any[]): boolean;
}

export interface AuditLogQueryOptions {
  action?: AuditAction;
  from?: Date;
  to?: Date;
  limit?: number;
  offset?: number;
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
    @InjectRepository(AuditLogEntity)
    private readonly auditLogRepo: Repository<AuditLogEntity>,
    @Optional() @Inject("ActorResolver") private readonly actorResolver?: ActorResolver,
    @Optional() @Inject("EventEmitter2") private readonly eventEmitter?: EventEmitterLike,
  ) {}

  onModuleInit(): void {
    AuditLogService.instance = this;
  }

  onModuleDestroy(): void {
    if (AuditLogService.instance === this) {
      AuditLogService.instance = null;
    }
  }

  static getInstance(): AuditLogService | null {
    return AuditLogService.instance;
  }

  // --- Options ---

  getOptions(): AuditLogModuleOptions {
    return this.options;
  }

  // --- Manual Logging ---

  async log(params: ManualAuditLogParams): Promise<AuditLogEntity> {
    const actor = params.actor ?? (await this.resolveActor());

    const entry = this.auditLogRepo.create({
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

    const saved = await this.auditLogRepo.save(entry);
    this.emit(AUDIT_LOG_EVENTS.LOGGED, { auditLog: saved });
    return saved;
  }

  // --- Query ---

  async getAuditLogs(
    entityType: string,
    entityId: string,
    options?: AuditLogQueryOptions,
  ): Promise<AuditLogEntity[]> {
    const qb = this.auditLogRepo
      .createQueryBuilder("audit")
      .where("audit.entityType = :entityType", { entityType })
      .andWhere("audit.entityId = :entityId", { entityId });

    if (options?.action) {
      qb.andWhere("audit.action = :action", { action: options.action });
    }
    if (options?.from) {
      qb.andWhere("audit.createdAt >= :from", { from: options.from });
    }
    if (options?.to) {
      qb.andWhere("audit.createdAt <= :to", { to: options.to });
    }

    qb.orderBy("audit.createdAt", "DESC");

    if (options?.limit) {
      qb.take(options.limit);
    }
    if (options?.offset) {
      qb.skip(options.offset);
    }

    return qb.getMany();
  }

  async getAuditLogsByActor(
    actorType: string,
    actorId: string,
    options?: AuditLogQueryOptions,
  ): Promise<AuditLogEntity[]> {
    const qb = this.auditLogRepo
      .createQueryBuilder("audit")
      .where("audit.actorType = :actorType", { actorType })
      .andWhere("audit.actorId = :actorId", { actorId });

    if (options?.action) {
      qb.andWhere("audit.action = :action", { action: options.action });
    }
    if (options?.from) {
      qb.andWhere("audit.createdAt >= :from", { from: options.from });
    }
    if (options?.to) {
      qb.andWhere("audit.createdAt <= :to", { to: options.to });
    }

    qb.orderBy("audit.createdAt", "DESC");

    if (options?.limit) {
      qb.take(options.limit);
    }
    if (options?.offset) {
      qb.skip(options.offset);
    }

    return qb.getMany();
  }

  async getLatestAuditLog(entityType: string, entityId: string): Promise<AuditLogEntity | null> {
    return this.auditLogRepo.findOne({
      where: { entityType, entityId },
      order: { createdAt: "DESC" },
    });
  }

  // --- Actor Resolution ---

  async resolveActor(): Promise<AuditActor | null> {
    if (this.actorResolver) {
      return this.actorResolver.resolve();
    }
    return this.options.defaultActor ?? null;
  }

  // --- Private ---

  private emit(event: string, payload: any): void {
    if (this.eventEmitter) {
      this.eventEmitter.emit(event, payload);
    }
  }
}
