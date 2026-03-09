// audit.ts

// A module for audit logging in the Emergent Energy Web App

class AuditLogger {
    private logs: string[] = [];

    log(action: string, username: string): void {
        const timestamp = new Date().toISOString();
        const logEntry = `${timestamp} - ${username}: ${action}`;
        this.logs.push(logEntry);
        console.log(logEntry); // Output to console
    }

    getLogs(): string[] {
        return this.logs;
    }
}

export default new AuditLogger();
