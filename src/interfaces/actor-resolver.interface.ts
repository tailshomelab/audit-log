export interface AuditActor {
  type: string;
  id: string;
}

export interface ActorResolver {
  resolve(): AuditActor | null | Promise<AuditActor | null>;
}
