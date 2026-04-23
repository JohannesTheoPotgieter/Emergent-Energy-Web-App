/**
 * Per-kind apply handlers for the Pending Approval inbox. Each handler is
 * the "release" step: it receives the exact payload that the upstream
 * writer prepared, and replays it into the destination table.
 *
 * Keep these handlers pure inserts (no side-effects beyond the target
 * table). Any post-insert orchestration (cache refresh, downstream sync,
 * etc.) should live alongside the handler call site if absolutely needed,
 * but the current writers explicitly do NOT need that.
 */
import { db } from "../db";
import { registerApprovalHandler } from "./pending-approvals-service";
import {
  opportunities,
  clients,
  intakeRequests,
  projectInfo,
  cosPeriodLocks,
  eeInfoNodes,
} from "@shared/schema";

let registered = false;

export function registerAllApprovalHandlers() {
  if (registered) return;
  registered = true;

  // ----- 1. Pipedrive opportunity create ---------------------------------
  registerApprovalHandler("pipedrive_opportunity_create", async (payload) => {
    const [row] = await db.insert(opportunities).values(payload as any).returning({ id: opportunities.id });
    return String(row.id);
  });

  // ----- 1b. Pipedrive client create -------------------------------------
  registerApprovalHandler("pipedrive_client_create", async (payload) => {
    const [row] = await db.insert(clients).values(payload as any).returning({ id: clients.id });
    return String(row.id);
  });

  // ----- 16. SharePoint intake request create ----------------------------
  registerApprovalHandler("sharepoint_intake_request_create", async (payload) => {
    // jsonb round-trip turns Date instances into ISO strings; coerce the
    // known timestamp/date columns back so Drizzle accepts them. Other
    // fields are passthrough.
    const p: any = { ...payload };
    if (typeof p.lastPulledAt === "string") p.lastPulledAt = new Date(p.lastPulledAt);
    if (typeof p.dueDate === "string" && p.dueDate.length === 0) p.dueDate = null;
    const [row] = await db.insert(intakeRequests).values(p).returning({ id: intakeRequests.id });
    return String(row.id);
  });

  // ----- 16b. SharePoint project_info shell create -----------------------
  registerApprovalHandler("sharepoint_project_shell_create", async (payload) => {
    const [row] = await db.insert(projectInfo).values(payload as any).returning({ id: projectInfo.id });
    return String(row.id);
  });

  // ----- 5. COS period auto-lock ----------------------------------------
  registerApprovalHandler("cos_period_lock_create", async (payload, ctx) => {
    // Auto-lock proposals never carry a user; on approval, attribute the
    // lock to the approver and flip auto_locked off so it reads as a
    // user-released lock in audit.
    const [row] = await db
      .insert(cosPeriodLocks)
      .values({
        ...(payload as any),
        autoLocked: false,
        lockedByUserId: ctx.decidedByUserId,
      })
      .returning({ id: cosPeriodLocks.id });
    return String(row.id);
  });

  // ----- 14. EE info-updates seed ---------------------------------------
  registerApprovalHandler("ee_info_update_seed", async (payload) => {
    const [row] = await db.insert(eeInfoNodes).values(payload as any).returning({ id: eeInfoNodes.id });
    return String(row.id);
  });
}
