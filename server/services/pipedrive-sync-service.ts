/**
 * D1: Pipedrive sync service
 *
 * Read-only sync from Pipedrive CRM into the opportunities table.
 * Pipedrive is the CRM truth — this service reads deals and maps them
 * to local Opportunity records.
 *
 * Hardened 2026-04-22 (task #29):
 *   - Centralised field mapping registry (see ./pipedrive-field-mapping.ts)
 *   - Schema self-check at sync start so a missing column produces ONE
 *     clear error instead of N per-deal failures
 *   - Structured per-deal errors {dealId, dealTitle, class, message,
 *     retryable} replacing raw SQL/JSON dumps
 *   - Hardened client/org matching: pipedrive_org_id → email domain →
 *     safe new client (PD-{orgId}) inside an advisory-locked txn so
 *     concurrent syncs cannot duplicate
 *   - Idempotent UPDATEs: skips the write entirely when nothing changed
 *   - project_info-linked guard preserved so converted projects are not
 *     resurrected by CRM updates
 *
 * Prerequisites:
 *   - PIPEDRIVE_API_TOKEN environment variable
 *   - opportunities table (migration 20260351)
 *   - clients table with pipedrive_org_id (migration 20260349) and
 *     primary_email_domain / additional_email_domains (migration 0013)
 *
 * Rate limiting: Pipedrive allows 100 requests per 10 seconds.
 */

import { db } from "../db";
import { and, eq, isNull, or, sql as drizzleSql } from "drizzle-orm";
import { opportunities, clients, projectInfo } from "@shared/schema/projects";
import { users } from "@shared/schema/users";
import { resolvePipedriveStageMapping } from "@shared/pipedrive-stage-map";
import { isConnectorMocked } from "../lib/connector-mode";
import * as pipedriveMocks from "../mocks/pipedrive-fixtures";
import {
  buildCrmOwnedFieldsFromDeal,
  classifySyncError,
  coerceOrgIdToText,
  PIPEDRIVE_CUSTOM_FIELD_KEYS,
  PIPEDRIVE_WRITABLE_COLUMNS,
  type OpportunityWritablePayload,
  type StructuredSyncError,
  type SyncErrorClass,
} from "./pipedrive-field-mapping";

/** Drizzle's transaction callback receives a `tx` whose surface mirrors
 *  `db`. Typing it as `typeof db` matches the codebase convention used in
 *  `server/repositories/controlled-documents-repository.ts` and lets us
 *  use the resolver without an `any` cast. */
type DbTx = typeof db;

// ===================== TYPES =====================

interface PipedriveDeal {
  id: number;
  title: string;
  value: number;
  currency: string;
  status: string;
  stage_id: number;
  pipeline_id: number;
  org_id: { value: number | string; name: string } | null;
  user_id: { id: number; name: string; email: string } | null;
  person_id: { value: number; name: string; email?: Array<{ value: string }>; phone?: Array<{ value: string }> } | null;
  expected_close_date: string | null;
  won_time: string | null;
  lost_time: string | null;
  lost_reason: string | null;
  stage_change_time: string | null;
  probability: number | null;
  weighted_value: number | null;
  activities_count: number | null;
  last_activity_date: string | null;
  next_activity_date: string | null;
  next_activity_subject: string | null;
  label: string | number | null;
  add_time: string;
  update_time: string;
  [customFieldHash: string]: unknown;
}

interface PipedrivePerson {
  id: number;
  name: string;
  email?: Array<{ value: string; primary?: boolean }>;
  phone?: Array<{ value: string; primary?: boolean }>;
}

interface PipedriveDealField {
  key: string;
  name: string;
  options?: Array<{ id: number; label: string }>;
}

interface PipedriveStage {
  id: number;
  name: string;
  pipeline_id: number;
  active_flag: boolean;
}

export interface PipedriveSyncResult {
  dealsProcessed: number;
  dealsCreated: number;
  dealsUpdated: number;
  dealsUnchanged: number;
  errors: StructuredSyncError[];
  skipped: number;
  schemaError: StructuredSyncError | null;
}

// ===================== API CLIENT =====================

class PipedriveClient {
  private baseUrl = "https://api.pipedrive.com/v1";
  private token: string;

  constructor(token: string) {
    this.token = token;
  }

  private async apiGet(path: string): Promise<unknown> {
    const sep = path.includes("?") ? "&" : "?";
    const url = `${this.baseUrl}${path}${sep}api_token=${this.token}`;
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Pipedrive API error: ${response.status} ${response.statusText}`);
    return response.json();
  }

  async getStages(): Promise<PipedriveStage[]> {
    const result = await this.apiGet("/stages") as { data: PipedriveStage[] | null };
    return result.data ?? [];
  }

  async getPerson(personId: number): Promise<PipedrivePerson | null> {
    try {
      const result = await this.apiGet(`/persons/${personId}`) as { data: PipedrivePerson | null };
      return result.data ?? null;
    } catch {
      return null;
    }
  }

  async getDealFields(): Promise<PipedriveDealField[]> {
    try {
      const result = await this.apiGet(`/dealFields`) as { data: PipedriveDealField[] | null };
      return result.data ?? [];
    } catch {
      return [];
    }
  }

  async getDeals(start = 0, limit = 100): Promise<{ data: PipedriveDeal[] | null; additional_data?: { pagination?: { more_items_in_collection: boolean; next_start: number } } }> {
    return this.apiGet(`/deals?start=${start}&limit=${limit}`) as Promise<{ data: PipedriveDeal[] | null; additional_data?: { pagination?: { more_items_in_collection: boolean; next_start: number } } }>;
  }

  async getAllDeals(): Promise<PipedriveDeal[]> {
    const allDeals: PipedriveDeal[] = [];
    let start = 0;
    let hasMore = true;
    while (hasMore) {
      const result = await this.getDeals(start);
      if (result.data) allDeals.push(...result.data);
      hasMore = result.additional_data?.pagination?.more_items_in_collection ?? false;
      start = result.additional_data?.pagination?.next_start ?? 0;
      if (hasMore) await new Promise(r => setTimeout(r, 150));
    }
    return allDeals;
  }
}

// ===================== SCHEMA SELF-CHECK =====================

/**
 * Required Postgres columns the sync depends on. We probe these once at
 * the start of every sync; any miss is reported as a single
 * `schema_mismatch` error and the sync aborts rather than failing per-deal
 * with cryptic SQL dumps. Keep in sync with shared/schema/projects.ts.
 */
const REQUIRED_COLUMNS: Array<{ table: string; column: string }> = [
  { table: "clients", column: "id" },
  { table: "clients", column: "client_id" },
  { table: "clients", column: "pipedrive_org_id" },
  { table: "clients", column: "name" },
  { table: "clients", column: "primary_email_domain" },
  { table: "clients", column: "additional_email_domains" },
  { table: "opportunities", column: "id" },
  { table: "opportunities", column: "pipedrive_deal_id" },
  { table: "opportunities", column: "source" },
  { table: "opportunities", column: "client_id" },
  { table: "opportunities", column: "deal_name" },
  { table: "opportunities", column: "deal_owner_user_id" },
  { table: "opportunities", column: "deal_owner_name" },
  { table: "opportunities", column: "currency" },
  { table: "opportunities", column: "labels" },
];

export async function checkSchemaParity(): Promise<StructuredSyncError | null> {
  try {
    const tables = Array.from(new Set(REQUIRED_COLUMNS.map(c => c.table)));
    // Drizzle's sql template expands a bare JS array into a comma-separated
    // list of bind parameters (`$1, $2`), which produced invalid SQL of the
    // form `ANY($1, $2)` and broke every sync with a spurious
    // "schema mismatch". Build an explicit IN(...) list using the codebase's
    // standard sql.join pattern instead.
    const tableList = drizzleSql.join(
      tables.map((t) => drizzleSql`${t}`),
      drizzleSql`, `,
    );
    const rows = (await db.execute(drizzleSql`
      SELECT table_name, column_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name IN (${tableList})
    `)) as unknown as { rows: Array<{ table_name: string; column_name: string }> };
    const present = new Set((rows.rows || []).map(r => `${r.table_name}.${r.column_name}`));
    const missing = REQUIRED_COLUMNS.filter(c => !present.has(`${c.table}.${c.column}`));
    if (missing.length === 0) return null;
    const summary = missing.map(c => `${c.table}.${c.column}`).join(", ");
    return {
      dealId: null,
      dealTitle: null,
      class: "schema_mismatch",
      message: `Required column(s) missing in this database: ${summary}. Run \`npm run db:push\` to align schema before re-running the sync.`,
      retryable: false,
    };
  } catch (err) {
    return {
      dealId: null,
      dealTitle: null,
      class: "schema_mismatch",
      message: `Could not introspect schema: ${err instanceof Error ? err.message : String(err)}`,
      retryable: true,
    };
  }
}

// ===================== SYNC ENGINE =====================

export type PipedrivePullScope =
  | { scope: "all" }
  | { scope: "owner"; ownerEmail: string };

export async function syncPipedriveDeals(
  scope: PipedrivePullScope = { scope: "all" },
): Promise<PipedriveSyncResult> {
  const startedAt = new Date();

  if (isConnectorMocked("pipedrive")) {
    const deals = pipedriveMocks.mockPipedriveDeals();
    return {
      dealsProcessed: deals.length,
      dealsCreated: 0,
      dealsUpdated: deals.length,
      dealsUnchanged: 0,
      errors: [],
      skipped: 0,
      schemaError: null,
    };
  }

  const result: PipedriveSyncResult = {
    dealsProcessed: 0, dealsCreated: 0, dealsUpdated: 0, dealsUnchanged: 0,
    errors: [], skipped: 0, schemaError: null,
  };

  const token = process.env.PIPEDRIVE_API_TOKEN;
  if (!token) {
    result.errors.push({
      dealId: null, dealTitle: null, class: "api_error",
      message: "PIPEDRIVE_API_TOKEN not configured", retryable: false,
    });
    await safeRecordRun({ startedAt, status: "failure", errorCode: "missing_token",
      errorDetail: "PIPEDRIVE_API_TOKEN not configured", result, scope });
    return result;
  }

  // Schema self-check up-front. A single clear error beats N opaque
  // "column does not exist" failures spread across the deal loop.
  const schemaError = await checkSchemaParity();
  if (schemaError) {
    result.schemaError = schemaError;
    result.errors.push(schemaError);
    await safeRecordRun({ startedAt, status: "failure", errorCode: "schema_mismatch",
      errorDetail: schemaError.message, result, scope });
    return result;
  }

  const ownerEmailLower = scope.scope === "owner" ? scope.ownerEmail.trim().toLowerCase() : null;
  if (scope.scope === "owner" && !ownerEmailLower) {
    const msg = "Owner-scoped Pipedrive pull requires a non-empty email.";
    result.errors.push({ dealId: null, dealTitle: null, class: "unknown", message: msg, retryable: false });
    await safeRecordRun({ startedAt, status: "failure", errorCode: "missing_owner_email",
      errorDetail: msg, result, scope });
    return result;
  }

  const client = new PipedriveClient(token);

  // Fetch reference data once.
  let stageIdToName = new Map<number, string>();
  try {
    const stages = await client.getStages();
    for (const s of stages) stageIdToName.set(s.id, s.name);
  } catch (err) {
    console.warn("[PipedriveSync] Could not fetch stage definitions:", err);
  }

  const labelMap = new Map<string, string>();
  try {
    const fields = await client.getDealFields();
    const labelField = fields.find((f) => f.key === "label");
    if (labelField?.options) {
      for (const opt of labelField.options) labelMap.set(String(opt.id), opt.label);
    }
  } catch (err) {
    console.warn("[PipedriveSync] Could not fetch dealFields for label mapping:", err);
  }

  const userByEmail = new Map<string, number>();
  try {
    const userRows = await db.select({ id: users.id, email: users.email }).from(users);
    for (const u of userRows) {
      if (u.email) userByEmail.set(u.email.trim().toLowerCase(), u.id);
    }
  } catch (err) {
    console.warn("[PipedriveSync] Could not load users for owner mapping:", err);
  }

  try {
    const deals = await client.getAllDeals();

    for (const deal of deals) {
      if (ownerEmailLower) {
        const dealOwnerEmail = deal.user_id?.email?.trim().toLowerCase() ?? null;
        if (!dealOwnerEmail || dealOwnerEmail !== ownerEmailLower) continue;
      }

      const stageName = stageIdToName.get(deal.stage_id) ?? null;
      const mapping = resolvePipedriveStageMapping(stageName, deal.status);
      if (mapping.skipSync) { result.skipped++; continue; }

      const raw = deal.expected_close_date;
      if (!raw) {
        // Required-field gate: surface as a structured warning so admins
        // can see *which* deals dropped out of sync and why, instead of
        // a silent counter bump.
        result.skipped++;
        result.errors.push({
          dealId: deal.id ?? null, dealTitle: deal.title ?? null,
          class: "missing_field", retryable: false,
          message: "expected_close_date is null in Pipedrive; deal cannot be synced until a close date is set.",
        });
        continue;
      }
      const closeDate = new Date(raw);
      if (Number.isNaN(closeDate.getTime())) {
        result.skipped++;
        result.errors.push({
          dealId: deal.id ?? null, dealTitle: deal.title ?? null,
          class: "missing_field", retryable: false,
          message: `expected_close_date "${raw}" is not a valid date.`,
        });
        continue;
      }
      const todayMidnight = new Date(); todayMidnight.setHours(0, 0, 0, 0);
      // Past-dated close dates are a benign skip (deal already overdue);
      // not surfaced as a warning to avoid noise.
      if (closeDate.getTime() <= todayMidnight.getTime()) { result.skipped++; continue; }

      result.dealsProcessed++;
      try {
        const ownerEmailL = deal.user_id?.email?.trim().toLowerCase() ?? null;
        const ownerUserId = ownerEmailL ? (userByEmail.get(ownerEmailL) ?? null) : null;
        const ownerName = deal.user_id?.name ?? null;

        let person: PipedrivePerson | null = null;
        if (deal.person_id?.value) person = await client.getPerson(deal.person_id.value);

        await syncSingleDeal(deal, {
          appStage: mapping.appStage,
          appStatus: mapping.appStatus,
          stageName,
          labelMap,
          ownerUserId,
          ownerName,
          personName: person?.name ?? deal.person_id?.name ?? null,
          personEmail: person ? pickPrimary(person.email) : null,
          personPhone: person ? pickPrimary(person.phone) : null,
        }, result);
      } catch (err) {
        const cls = classifySyncError(err);
        result.errors.push({
          dealId: deal.id ?? null,
          dealTitle: deal.title ?? null,
          class: cls.class,
          message: cls.message,
          retryable: cls.retryable,
        });
      }
    }
  } catch (err) {
    const cls = classifySyncError(err);
    result.errors.push({
      dealId: null, dealTitle: null,
      class: cls.class, message: `Fetch failed: ${cls.message}`, retryable: cls.retryable,
    });
  }

  const status: "success" | "failure" | "partial" =
    result.errors.length === 0 ? "success"
      : result.dealsProcessed > 0 ? "partial"
        : "failure";

  await safeRecordRun({
    startedAt, status,
    errorCode: result.errors.length > 0 ? "deal_sync_errors" : null,
    errorDetail: result.errors.length > 0
      ? result.errors.slice(0, 5).map(e => `${e.class}: ${e.message}`).join(" | ")
      : null,
    result, scope,
  });

  return result;
}

async function safeRecordRun(params: {
  startedAt: Date;
  status: "success" | "failure" | "partial";
  errorCode: string | null;
  errorDetail: string | null;
  result: PipedriveSyncResult;
  scope: PipedrivePullScope;
}): Promise<void> {
  try {
    const { recordIntegrationRun } = await import("./integration-health-service");
    await recordIntegrationRun({
      name: "pipedrive",
      runType: params.scope.scope === "owner" ? "sync_owner_deals" : "sync_all_deals",
      startedAt: params.startedAt,
      finishedAt: new Date(),
      status: params.status,
      recordsProcessed: params.result.dealsProcessed,
      errorCode: params.errorCode,
      errorDetail: params.errorDetail,
      metadata: {
        dealsCreated: params.result.dealsCreated,
        dealsUpdated: params.result.dealsUpdated,
        dealsUnchanged: params.result.dealsUnchanged,
        dealsSkipped: params.result.skipped,
        errorCount: params.result.errors.length,
        scope: params.scope.scope,
        ...(params.scope.scope === "owner" ? { ownerEmail: params.scope.ownerEmail } : {}),
      },
    });
  } catch (err) {
    console.error("[PipedriveSync] Failed to record integration health event:", err);
  }
}

function pickPrimary(arr: Array<{ value: string; primary?: boolean }> | undefined): string | null {
  if (!arr || arr.length === 0) return null;
  return (arr.find((x) => x.primary)?.value ?? arr[0]?.value) ?? null;
}

// ===================== CLIENT/ORG RESOLUTION =====================

/** Per-process advisory lock key for the client-create critical section.
 *  Different from the EE-Cxxxx generator lock so the two are independent. */
const PD_CLIENT_RESOLVE_LOCK = 0x5044_4341; // 'PDCA' ≈ pipedrive client auto-create

/**
 * Resolve the app-side `clients.id` for a Pipedrive deal's organisation.
 * Documented priority:
 *   1) `clients.pipedrive_org_id` exact match (text)
 *   2) `primary_email_domain` / `additional_email_domains` containment
 *      match against the Pipedrive person email's domain
 *   3) Safe new-client creation with `client_id = PD-{orgId}` inside an
 *      advisory-locked transaction so concurrent syncs cannot duplicate
 *
 * Returns null only when the deal has no `org_id` at all (handled by the
 * caller as a `missing_org` warning).
 */
export async function resolveClientId(
  deal: PipedriveDeal,
  resolvedPersonEmail: string | null,
): Promise<{
  clientId: number | null;
  missingOrg: boolean;
  backfilledOrgId: boolean;
  warning?: { class: SyncErrorClass; message: string; retryable: boolean };
}> {
  const orgIdStr = coerceOrgIdToText(deal.org_id?.value ?? null);
  if (!orgIdStr) return { clientId: null, missingOrg: true, backfilledOrgId: false };

  // (1) Direct match on pipedrive_org_id
  const [direct] = await db
    .select({ id: clients.id })
    .from(clients)
    .where(eq(clients.pipedriveOrgId, orgIdStr))
    .limit(1);
  if (direct) return { clientId: direct.id, missingOrg: false, backfilledOrgId: false };

  // (2) Email-domain match — strictly unambiguous only.
  //     We pull *all* candidates (no LIMIT), then bind/backfill only when:
  //       (a) exactly one candidate row matches the domain, AND
  //       (b) that row's pipedrive_org_id is null OR equals this orgIdStr.
  //     Any other shape (multiple candidates, or a single candidate with
  //     a different pipedrive_org_id) emits a `client_resolve` warning
  //     and falls through to the safe-create branch — never silently
  //     binding a deal to the wrong client.
  const domain = resolvedPersonEmail ? extractEmailDomain(resolvedPersonEmail) : null;
  if (domain) {
    const candidates = await db
      .select({ id: clients.id, pipedriveOrgId: clients.pipedriveOrgId })
      .from(clients)
      .where(or(
        eq(clients.primaryEmailDomain, domain),
        drizzleSql`${clients.additionalEmailDomains} @> ${JSON.stringify([domain])}::jsonb`,
      ));

    if (candidates.length === 1) {
      const only = candidates[0];
      if (only.pipedriveOrgId == null) {
        await db.update(clients).set({ pipedriveOrgId: orgIdStr }).where(eq(clients.id, only.id));
        return { clientId: only.id, missingOrg: false, backfilledOrgId: true };
      }
      if (only.pipedriveOrgId === orgIdStr) {
        return { clientId: only.id, missingOrg: false, backfilledOrgId: false };
      }
      // Conflict: domain matches a client already bound to a *different* org.
      // Surface a warning AND fall through to step (3) safe-create so the
      // deal still gets a `PD-{orgId}` client and never lands as an orphan.
      const created = await safeCreatePdClient(deal, orgIdStr);
      return {
        clientId: created, missingOrg: false, backfilledOrgId: false,
        warning: {
          class: "client_resolve", retryable: false,
          message: `Domain "${domain}" matches client ${only.id} already bound to pipedrive_org_id ${only.pipedriveOrgId}; refused to merge with ${orgIdStr}, created PD-${orgIdStr} instead.`,
        },
      };
    }
    if (candidates.length > 1) {
      // Ambiguous: surface a warning AND fall through to safe-create so the
      // deal still has a client. Operators can later merge manually.
      const created = await safeCreatePdClient(deal, orgIdStr);
      return {
        clientId: created, missingOrg: false, backfilledOrgId: false,
        warning: {
          class: "client_resolve", retryable: false,
          message: `Domain "${domain}" matches ${candidates.length} clients [${candidates.map((c: { id: number }) => c.id).join(", ")}]; ambiguous, created PD-${orgIdStr} instead of guessing.`,
        },
      };
    }
  }

  // (3) Safe create.
  const created = await safeCreatePdClient(deal, orgIdStr);
  return { clientId: created, missingOrg: false, backfilledOrgId: false };
}

/**
 * Idempotent advisory-locked create of a `PD-{orgId}` client. Wrapped in a
 * transaction so two concurrent syncs cannot race on the
 * `(client_id)` / `(pipedrive_org_id)` unique constraints.
 */
async function safeCreatePdClient(deal: PipedriveDeal, orgIdStr: string): Promise<number> {
  const orgName = deal.org_id?.name || `Pipedrive Org ${orgIdStr}`;
  const clientIdCode = `PD-${orgIdStr}`;
  return db.transaction(async (tx: DbTx): Promise<number> => {
    await tx.execute(drizzleSql`SELECT pg_advisory_xact_lock(${PD_CLIENT_RESOLVE_LOCK})`);

    // Re-check inside the lock — another sync may have created it.
    const [byOrg] = await tx
      .select({ id: clients.id })
      .from(clients)
      .where(eq(clients.pipedriveOrgId, orgIdStr))
      .limit(1);
    if (byOrg) return byOrg.id;

    const [byClientId] = await tx
      .select({ id: clients.id })
      .from(clients)
      .where(eq(clients.clientId, clientIdCode))
      .limit(1);
    if (byClientId) {
      // Backfill the org id onto the existing PD-shaped client.
      await tx.update(clients).set({ pipedriveOrgId: orgIdStr }).where(eq(clients.id, byClientId.id));
      return byClientId.id;
    }

    const [newRow] = await tx
      .insert(clients)
      .values({
        clientId: clientIdCode,
        name: orgName,
        pipedriveOrgId: orgIdStr,
        status: "prospect",
      })
      .returning({ id: clients.id });
    return newRow.id;
  });
}

function extractEmailDomain(email: string): string | null {
  const at = email.lastIndexOf("@");
  if (at < 0) return null;
  const d = email.slice(at + 1).trim().toLowerCase();
  return d || null;
}

// ===================== SINGLE-DEAL SYNC =====================

interface SyncDealCtx {
  appStage: string;
  appStatus: string;
  stageName: string | null;
  labelMap: Map<string, string>;
  ownerUserId: number | null;
  ownerName: string | null;
  personName: string | null;
  personEmail: string | null;
  personPhone: string | null;
}

export async function syncSingleDeal(
  deal: PipedriveDeal,
  ctx: SyncDealCtx,
  result: PipedriveSyncResult,
): Promise<void> {
  const dealIdStr = String(deal.id);

  const [existing] = await db
    .select()
    .from(opportunities)
    .where(eq(opportunities.pipedriveDealId, dealIdStr));

  // GUARD: opportunity already converted to project_info → never overwrite.
  if (existing) {
    const [linkedShell] = await db
      .select({ id: projectInfo.id })
      .from(projectInfo)
      .where(and(eq(projectInfo.opportunityId, existing.id), isNull(projectInfo.deletedAt)))
      .limit(1);
    if (linkedShell) { result.skipped++; return; }
  }

  // Resolve client (registry-driven + hardened). Pass the resolved
  // primary person email so the email-domain fallback can fire when the
  // pipedrive_org_id has no direct match yet.
  const resolved = await resolveClientId(deal, ctx.personEmail);
  if (resolved.warning) {
    // Surface ambiguity/conflict in the admin UI without aborting the deal.
    result.errors.push({
      dealId: deal.id ?? null, dealTitle: deal.title ?? null,
      class: resolved.warning.class, message: resolved.warning.message, retryable: resolved.warning.retryable,
    });
  }
  if (resolved.missingOrg && !existing) {
    // Don't create a CRM-orphan opportunity. Record as a structured warning.
    throw new Error("Pipedrive deal has no org_id; cannot create app-side opportunity without a client");
  }
  const clientId = resolved.clientId ?? existing?.clientId ?? null;

  // Build the full CRM-owned payload from the registry.
  const payload = buildCrmOwnedFieldsFromDeal(deal as unknown as Record<string, unknown>, {
    stageName: ctx.stageName,
    labelMap: ctx.labelMap,
    appStage: ctx.appStage,
    appStatus: ctx.appStatus,
    enrichment: {
      ownerUserId: ctx.ownerUserId,
      ownerName: ctx.ownerName,
      personName: ctx.personName,
      personEmail: ctx.personEmail,
      personPhone: ctx.personPhone,
    },
    clientId,
  });

  // Defence in depth: drop any column not in the registry's writable set.
  // (clientId is always allowed.) The cast goes through Record<string,
  // unknown> so we never widen back to `any`.
  const safePayload: OpportunityWritablePayload = {};
  for (const [k, v] of Object.entries(payload as Record<string, unknown>)) {
    if (k === "clientId" || PIPEDRIVE_WRITABLE_COLUMNS.has(k)) {
      (safePayload as Record<string, unknown>)[k] = v;
    }
  }

  if (!existing) {
    await db.insert(opportunities).values({
      ...safePayload,
      // Seed `notes` once on create so the row is recognisable in legacy
      // surfaces. `notes` is app-owned thereafter.
      notes: `Pipedrive: ${deal.title || `Deal ${deal.id}`}`,
    });
    result.dealsCreated++;
    return;
  }

  // Idempotency: only call UPDATE when at least one tracked field actually
  // changes. A re-run with no Pipedrive changes must produce zero updates.
  const existingRow = existing as Record<string, unknown>;
  const diff: OpportunityWritablePayload = {};
  for (const [k, v] of Object.entries(safePayload as Record<string, unknown>)) {
    if (!fieldsEqual(existingRow[k], v)) {
      (diff as Record<string, unknown>)[k] = v;
    }
  }

  if (Object.keys(diff).length === 0) {
    result.dealsUnchanged++;
    return;
  }

  // Stamp updatedAt only when a real change is being written.
  diff.updatedAt = new Date();

  await db.update(opportunities)
    .set(diff)
    .where(eq(opportunities.id, existing.id));
  result.dealsUpdated++;
}

/** Loose equality helper covering Date/Decimal/text for the diff step.
 *  Drizzle returns decimals as strings and dates as Date objects. */
function fieldsEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a == null && b == null) return true;
  if (a == null || b == null) return false;
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
  if (a instanceof Date) return a.toISOString() === String(b);
  if (b instanceof Date) return b.toISOString() === String(a);
  // Numeric strings vs numbers
  if (typeof a === "number" || typeof b === "number") {
    const na = Number(a), nb = Number(b);
    if (Number.isFinite(na) && Number.isFinite(nb)) return na === nb;
  }
  return String(a) === String(b);
}

// Re-exports kept for backward compatibility with existing imports.
export { PIPEDRIVE_CUSTOM_FIELD_KEYS };
