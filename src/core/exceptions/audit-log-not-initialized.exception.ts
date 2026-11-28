export class AuditLogNotInitializedException extends Error {
  constructor() {
    super(
      "The audit log is not initialized. Register an audit log adapter module with forRoot() or forRootAsync() first.",
    );
    this.name = "AuditLogNotInitializedException";
  }
}
