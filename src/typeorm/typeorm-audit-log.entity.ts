import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from "typeorm";
import type { AuditAction } from "../core/interfaces/audit-log-options.interface.js";
import type { AuditLogRecord } from "../core/interfaces/audit-log-record.interface.js";

@Entity("audit_logs")
@Index(["entityType", "entityId"])
@Index(["actorType", "actorId"])
@Index(["action"])
@Index(["createdAt"])
export class TypeOrmAuditLogEntity implements AuditLogRecord {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ name: "action", type: "varchar", length: 50 })
  action!: AuditAction;

  @Column({ name: "entity_type", type: "varchar", length: 255 })
  entityType!: string;

  @Column({ name: "entity_id", type: "varchar", length: 255 })
  entityId!: string;

  @Column({ name: "actor_type", type: "varchar", length: 255, nullable: true })
  actorType!: string | null;

  @Column({ name: "actor_id", type: "varchar", length: 255, nullable: true })
  actorId!: string | null;

  @Column({ name: "old_values", type: "simple-json", nullable: true })
  oldValues!: Record<string, any> | null;

  @Column({ name: "new_values", type: "simple-json", nullable: true })
  newValues!: Record<string, any> | null;

  @Column({ name: "metadata", type: "simple-json", nullable: true })
  metadata!: Record<string, any> | null;

  @Column({ name: "ip_address", type: "varchar", length: 45, nullable: true })
  ipAddress!: string | null;

  @Column({ name: "user_agent", type: "varchar", length: 512, nullable: true })
  userAgent!: string | null;

  @CreateDateColumn({ name: "created_at" })
  createdAt!: Date;
}
