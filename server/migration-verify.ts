import { db } from "./db";
import { sql } from "drizzle-orm";

interface VerifyResult {
  check: string;
  status: "PASS" | "FAIL" | "WARN" | "SKIP";
  legacy: number | string;
  canonical: number | string;
  details?: string;
}

export async function runMigrationVerification(): Promise<{
  overall: "PASS" | "FAIL";
  timestamp: string;
  results: VerifyResult[];
}> {
  const results: VerifyResult[] = [];

  const legacyPlanCount = await db.execute(sql.raw(`SELECT COUNT(*) as cnt FROM normalized_plan_tasks`));
  const canonicalPlanCount = await db.execute(sql.raw(`SELECT COUNT(*) as cnt FROM work_items WHERE workstream = 'PM' AND source = 'SMART_IMPORT' AND deleted_at IS NULL`));
  const lpc = Number((legacyPlanCount as any).rows?.[0]?.cnt ?? 0);
  const cpc = Number((canonicalPlanCount as any).rows?.[0]?.cnt ?? 0);
  results.push({
    check: "PM Plan Task Count",
    status: lpc === 0 && cpc === 0 ? "SKIP" : lpc === cpc ? "PASS" : cpc === 0 ? "WARN" : "FAIL",
    legacy: lpc,
    canonical: cpc,
    details: cpc === 0 ? "Dual-write not yet active or no imports done" : undefined,
  });

  const legacyPerProject = await db.execute(sql.raw(`
    SELECT project_name, COUNT(*) as cnt FROM normalized_plan_tasks GROUP BY project_name ORDER BY project_name
  `));
  const canonicalPerProject = await db.execute(sql.raw(`
    SELECT pi.project_name, COUNT(*) as cnt FROM work_items wi 
    JOIN project_info pi ON wi.project_id = pi.id 
    WHERE wi.workstream = 'PM' AND wi.source = 'SMART_IMPORT' AND wi.deleted_at IS NULL
    GROUP BY pi.project_name ORDER BY pi.project_name
  `));
  const legacyMap = new Map<string, number>();
  const canonicalMap = new Map<string, number>();
  for (const r of (legacyPerProject as any).rows || []) legacyMap.set(r.project_name, Number(r.cnt));
  for (const r of (canonicalPerProject as any).rows || []) canonicalMap.set(r.project_name, Number(r.cnt));

  const allProjects = new Set([...legacyMap.keys(), ...canonicalMap.keys()]);
  let projectMismatches = 0;
  for (const pn of allProjects) {
    const l = legacyMap.get(pn) || 0;
    const c = canonicalMap.get(pn) || 0;
    if (l !== c && c > 0) projectMismatches++;
  }
  results.push({
    check: "Per-Project Task Count Match",
    status: canonicalMap.size === 0 ? "SKIP" : projectMismatches === 0 ? "PASS" : "FAIL",
    legacy: `${legacyMap.size} projects`,
    canonical: `${canonicalMap.size} projects`,
    details: projectMismatches > 0 ? `${projectMismatches} projects have count mismatches` : undefined,
  });

  const legacyMilestones = await db.execute(sql.raw(`
    SELECT COUNT(*) as cnt FROM normalized_plan_tasks WHERE is_milestone = true
  `));
  const canonicalMilestones = await db.execute(sql.raw(`
    SELECT COUNT(*) as cnt FROM work_items WHERE workstream = 'PM' AND source = 'SMART_IMPORT' AND type = 'milestone' AND deleted_at IS NULL
  `));
  const lmc = Number((legacyMilestones as any).rows?.[0]?.cnt ?? 0);
  const cmc = Number((canonicalMilestones as any).rows?.[0]?.cnt ?? 0);
  results.push({
    check: "Milestone Count",
    status: cmc === 0 ? "SKIP" : lmc === cmc ? "PASS" : "WARN",
    legacy: lmc,
    canonical: cmc,
  });

  const legacyAssignments = await db.execute(sql.raw(`
    SELECT COUNT(*) as cnt FROM normalized_plan_tasks WHERE assignee_user_id IS NOT NULL
  `));
  const canonicalAssignments = await db.execute(sql.raw(`
    SELECT COUNT(DISTINCT work_item_id) as cnt FROM work_item_assignments
  `));
  const lac = Number((legacyAssignments as any).rows?.[0]?.cnt ?? 0);
  const cac = Number((canonicalAssignments as any).rows?.[0]?.cnt ?? 0);
  results.push({
    check: "Assignment Count",
    status: cac === 0 ? "SKIP" : lac <= cac ? "PASS" : "WARN",
    legacy: lac,
    canonical: cac,
  });

  const orphanedWorkItems = await db.execute(sql.raw(`
    SELECT COUNT(*) as cnt FROM work_items wi 
    WHERE wi.legacy_id IS NOT NULL 
    AND wi.legacy_table = 'normalized_plan_tasks'
    AND NOT EXISTS (SELECT 1 FROM normalized_plan_tasks npt WHERE npt.id = wi.legacy_id)
    AND wi.deleted_at IS NULL
  `));
  const orphans = Number((orphanedWorkItems as any).rows?.[0]?.cnt ?? 0);
  results.push({
    check: "Orphaned Work Items (legacy ref missing)",
    status: orphans === 0 ? "PASS" : "FAIL",
    legacy: "N/A",
    canonical: orphans,
    details: orphans > 0 ? `${orphans} work_items reference deleted legacy tasks` : undefined,
  });

  const workItemsNoProject = await db.execute(sql.raw(`
    SELECT COUNT(*) as cnt FROM work_items WHERE project_id IS NULL AND workstream != 'PERSONAL' AND deleted_at IS NULL
  `));
  const noProj = Number((workItemsNoProject as any).rows?.[0]?.cnt ?? 0);
  results.push({
    check: "Work Items Without Project (non-personal)",
    status: noProj === 0 ? "PASS" : "WARN",
    legacy: "N/A",
    canonical: noProj,
  });

  const overall = results.some(r => r.status === "FAIL") ? "FAIL" : "PASS";

  return {
    overall,
    timestamp: new Date().toISOString(),
    results,
  };
}
