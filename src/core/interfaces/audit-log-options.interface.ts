import type { Type } from "@nestjs/common";
import type { ActorResolver } from "./actor-resolver.interface.js";

export type AuditAction = "created" | "updated" | "deleted";

export interface AuditLogModuleOptions {
  defaultActor?: { type: string; id: string };
  actorResolver?: Type<ActorResolver>;
  disabledActions?: AuditAction[];
  globalExcludedFields?: string[];
  metadata?: Record<string, any>;
}

export interface AuditLogAsyncOptions {
  imports?: any[];
  inject?: any[];
  useFactory: (...args: any[]) => Promise<AuditLogModuleOptions> | AuditLogModuleOptions;
}
