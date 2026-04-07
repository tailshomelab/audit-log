export class AuditLogNotInitializedException extends Error {
  constructor() {
    super(
      "AuditLogModule has not been initialized. Make sure AuditLogModule.forRoot() is imported.",
    );
    this.name = "AuditLogNotInitializedException";
  }
}
