import { storage } from "./storage";
import { runLeaveSync } from "./leaveSyncEngine";

let schedulerInterval: ReturnType<typeof setInterval> | null = null;

export function startLeaveScheduler() {
  if (schedulerInterval) {
    clearInterval(schedulerInterval);
  }

  schedulerInterval = setInterval(async () => {
    try {
      const settings = await storage.getPayspaceSettings();
      if (!settings || !settings.isEnabled) return;

      const now = new Date();
      if (settings.nextSyncAt && now >= new Date(settings.nextSyncAt)) {
        console.log("[LeaveScheduler] Starting scheduled sync...");
        const result = await runLeaveSync("schedule", "scheduler");
        console.log(`[LeaveScheduler] Sync complete: ${result.status}`, result.summary);
      }
    } catch (err: any) {
      console.error("[LeaveScheduler] Error:", err.message);
    }
  }, 60000);

  console.log("[LeaveScheduler] Started (checking every 60s)");
}

export function stopLeaveScheduler() {
  if (schedulerInterval) {
    clearInterval(schedulerInterval);
    schedulerInterval = null;
  }
}
