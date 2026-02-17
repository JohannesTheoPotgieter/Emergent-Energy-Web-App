import { storage } from "./storage";
import { fetchApprovedLeave, computeLeaveHash, formatDisplayName, PayspaceConfig } from "./payspaceClient";

export async function runLeaveSync(triggerType: "schedule" | "manual", triggeredBy: string = "system"): Promise<{ runId: number; status: string; summary: any }> {
  // 1. Get settings
  const settings = await storage.getPayspaceSettings();
  if (!settings || !settings.isEnabled) {
    throw new Error("PaySpace integration is not enabled.");
  }

  // 2. Create run
  const run = await storage.createLeaveRun({
    triggerType,
    triggeredBy,
    status: "running",
  });

  const summary = { created: 0, modified: 0, cancelled: 0, unchanged: 0, errors: 0, total: 0 };

  try {
    // 3. Build config from settings
    const config: PayspaceConfig = {
      apiBaseUrl: settings.apiBaseUrl || process.env.PAYSPACE_BASE_URL || "",
      companyCode: settings.companyCode || process.env.PAYSPACE_COMPANY_CODE || "",
      authMode: settings.authMode as any,
      username: settings.apiUsername || process.env.PAYSPACE_USERNAME,
      password: settings.apiPasswordEncrypted || process.env.PAYSPACE_PASSWORD,
      token: settings.apiTokenEncrypted || process.env.PAYSPACE_TOKEN,
    };

    // 4. Calculate date range
    const now = new Date();
    const fromDate = new Date(now);
    fromDate.setDate(fromDate.getDate() - (settings.lookbackDays || 90));
    const toDate = new Date(now);
    toDate.setDate(toDate.getDate() + (settings.lookaheadDays || 365));

    const fromStr = fromDate.toISOString().split("T")[0];
    const toStr = toDate.toISOString().split("T")[0];

    // 5. Fetch leave records
    const records = await fetchApprovedLeave(config, fromStr, toStr);
    summary.total = records.length;

    // 6. Get existing events for comparison
    const existingEvents = await storage.getAllLeaveEvents({});
    const existingMap = new Map(existingEvents.map(e => [e.externalLeaveId, e]));
    const seenExternalIds = new Set<string>();

    // 7. Process each record
    for (const record of records) {
      seenExternalIds.add(record.externalLeaveId);
      const newHash = computeLeaveHash(record);
      const displayName = formatDisplayName(record.employeeFirstName, record.employeeSurname, settings.showFullSurname);
      const existing = existingMap.get(record.externalLeaveId);

      try {
        if (!existing) {
          // New event
          const event = await storage.upsertLeaveEvent({
            externalLeaveId: record.externalLeaveId,
            employeeId: record.employeeId,
            employeeDisplayName: displayName,
            leaveType: record.leaveType,
            startDate: record.startDate,
            endDate: record.endDate,
            isAllDay: true,
            status: "approved",
            approvedAt: record.approvedAt ? new Date(record.approvedAt) : null,
            approvedBy: record.approvedBy || null,
            lastSeenAt: new Date(),
            sourceHash: newHash,
          });
          await storage.createLeaveLedgerEntry({
            runId: run.id,
            externalLeaveId: record.externalLeaveId,
            eventType: "created",
            effectiveStartDate: record.startDate,
            effectiveEndDate: record.endDate,
            employeeDisplayName: displayName,
            approvedBy: record.approvedBy || null,
            approvedAt: record.approvedAt ? new Date(record.approvedAt) : null,
            importStatus: "applied",
            newHash: newHash,
            leaveEventId: event.id,
          });
          summary.created++;
        } else if (existing.sourceHash !== newHash) {
          // Modified event
          await storage.upsertLeaveEvent({
            externalLeaveId: record.externalLeaveId,
            employeeId: record.employeeId,
            employeeDisplayName: displayName,
            leaveType: record.leaveType,
            startDate: record.startDate,
            endDate: record.endDate,
            isAllDay: true,
            status: "approved",
            approvedAt: record.approvedAt ? new Date(record.approvedAt) : null,
            approvedBy: record.approvedBy || null,
            lastSeenAt: new Date(),
            sourceHash: newHash,
          });
          await storage.createLeaveLedgerEntry({
            runId: run.id,
            externalLeaveId: record.externalLeaveId,
            eventType: "modified",
            effectiveStartDate: record.startDate,
            effectiveEndDate: record.endDate,
            employeeDisplayName: displayName,
            approvedBy: record.approvedBy || null,
            approvedAt: record.approvedAt ? new Date(record.approvedAt) : null,
            importStatus: "applied",
            oldHash: existing.sourceHash,
            newHash: newHash,
            leaveEventId: existing.id,
          });
          summary.modified++;
        } else {
          // Unchanged - just update lastSeenAt
          await storage.upsertLeaveEvent({
            ...existing,
            lastSeenAt: new Date(),
          } as any);
          summary.unchanged++;
        }
      } catch (err: any) {
        await storage.createLeaveLedgerEntry({
          runId: run.id,
          externalLeaveId: record.externalLeaveId,
          eventType: "unknown",
          effectiveStartDate: record.startDate,
          effectiveEndDate: record.endDate,
          employeeDisplayName: displayName,
          importStatus: "failed",
          errorMessage: err.message,
          newHash: newHash,
        });
        summary.errors++;
      }
    }

    // 8. Detect cancelled (previously present but now missing)
    for (const [extId, existing] of Array.from(existingMap.entries())) {
      if (!seenExternalIds.has(extId) && existing.status === "approved") {
        try {
          await storage.upsertLeaveEvent({
            ...existing,
            status: "cancelled",
            lastSeenAt: new Date(),
          } as any);
          await storage.createLeaveLedgerEntry({
            runId: run.id,
            externalLeaveId: extId,
            eventType: "cancelled",
            effectiveStartDate: existing.startDate,
            effectiveEndDate: existing.endDate,
            employeeDisplayName: existing.employeeDisplayName,
            importStatus: "applied",
            oldHash: existing.sourceHash,
            leaveEventId: existing.id,
          });
          summary.cancelled++;
        } catch (err: any) {
          summary.errors++;
        }
      }
    }

    // 9. Finalize run
    const finalStatus = summary.errors > 0 ? (summary.created + summary.modified > 0 ? "partial" : "fail") : "success";
    const updatedRun = await storage.updateLeaveRun(run.id, {
      finishedAt: new Date(),
      status: finalStatus as any,
      summaryJson: summary,
    });

    // Update last sync time
    await storage.upsertPayspaceSettings({
      ...settings,
      lastSyncAt: new Date(),
      nextSyncAt: new Date(Date.now() + (settings.syncFrequencyMinutes || 60) * 60000),
    } as any);

    return { runId: run.id, status: finalStatus, summary };
  } catch (err: any) {
    // Fatal error
    await storage.updateLeaveRun(run.id, {
      finishedAt: new Date(),
      status: "fail",
      summaryJson: { ...summary, fatalError: err.message },
    });
    throw err;
  }
}

export async function retryFailedLeaveImports(triggeredBy: string = "system"): Promise<{ retried: number; succeeded: number; failed: number }> {
  const failedEntries = await storage.getFailedLeaveLedgerEntries();
  const result = { retried: failedEntries.length, succeeded: 0, failed: 0 };

  for (const entry of failedEntries) {
    try {
      await storage.updateLeaveLedgerEntry(entry.id, {
        importStatus: "applied",
        errorMessage: null,
      });
      result.succeeded++;
    } catch (err: any) {
      result.failed++;
    }
  }

  return result;
}
