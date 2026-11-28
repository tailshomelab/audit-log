import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import type { AuditLogDraft } from "../core/interfaces/audit-log-record.interface.js";
import type {
  AuditLogQueryOptions,
  AuditLogStorage,
} from "../core/interfaces/audit-log-storage.interface.js";
import { TypeOrmAuditLogEntity } from "./typeorm-audit-log.entity.js";

/** `AuditLogStorage` backed by the `TypeOrmAuditLogEntity` repository. */
@Injectable()
export class TypeOrmAuditLogStorage implements AuditLogStorage {
  constructor(
    @InjectRepository(TypeOrmAuditLogEntity)
    private readonly repository: Repository<TypeOrmAuditLogEntity>,
  ) {}

  save(draft: AuditLogDraft): Promise<TypeOrmAuditLogEntity> {
    return this.repository.save(this.repository.create(draft));
  }

  findByEntity(
    entityType: string,
    entityId: string,
    query?: AuditLogQueryOptions,
  ): Promise<TypeOrmAuditLogEntity[]> {
    return this.find({ entityType, entityId }, query);
  }

  findByActor(
    actorType: string,
    actorId: string,
    query?: AuditLogQueryOptions,
  ): Promise<TypeOrmAuditLogEntity[]> {
    return this.find({ actorType, actorId }, query);
  }

  findLatest(entityType: string, entityId: string): Promise<TypeOrmAuditLogEntity | null> {
    return this.repository.findOne({
      where: { entityType, entityId },
      order: { createdAt: "DESC" },
    });
  }

  private find(
    match: Partial<Record<"entityType" | "entityId" | "actorType" | "actorId", string>>,
    query?: AuditLogQueryOptions,
  ): Promise<TypeOrmAuditLogEntity[]> {
    const qb = this.repository.createQueryBuilder("audit");

    for (const [field, value] of Object.entries(match)) {
      qb.andWhere(`audit.${field} = :${field}`, { [field]: value });
    }
    if (query?.action) {
      qb.andWhere("audit.action = :action", { action: query.action });
    }
    if (query?.from) {
      qb.andWhere("audit.createdAt >= :from", { from: query.from });
    }
    if (query?.to) {
      qb.andWhere("audit.createdAt <= :to", { to: query.to });
    }

    qb.orderBy("audit.createdAt", "DESC");

    if (query?.limit) {
      qb.take(query.limit);
    }
    if (query?.offset) {
      qb.skip(query.offset);
    }

    return qb.getMany();
  }
}
