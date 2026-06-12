/**
 * Realised REV / COS by month (+ per-project breakdown) rolled up from the
 * § 3.3.2 single read path (finance-line-level-repository).
 *
 * Read-map enforcement (fix/two-sheet-canonical-source): the COS / Revenue /
 * company-GP tabs' "realised" figures derive from the per-project Expenditure
 * Breakdown ledger via the canonical (Q/X)×J formula + the § 3.2 realisation
 * gate (`bucket === "realised"`), bucketed on the invoice-raised month (col T)
 * — NOT a second engine. This supersedes the prior FYE-engine realised source
 * for those tabs so every surface reads REV/COS/GP from the one canonical path.
 *
 * Scope is every active project (the same scope canonical-project-totals /
 * verify:finance use) — no curated subset — so the figure is the true sum of
 * the per-project ledgers (§ 3.3.1).
 */
import { FinanceLineLevelRepository } from "../../repositories/finance-line-level-repository";
import { ProjectInfoRepository } from "../../repositories/project-info-repository";

const projectInfoRepository = new ProjectInfoRepository();

export interface RealisedByMonthEntry {
  total: number;
  projects: Map<string, number>;
}

export async function canonicalRealisedByMonth(opts: {
  metric: "cos" | "revenue";
  fyStart?: string;
  fyEnd?: string;
}): Promise<Map<string, RealisedByMonthEntry>> {
  const out = new Map<string, RealisedByMonthEntry>();
  const projects = await projectInfoRepository.listActiveIdName();
  const projIdToName = new Map<number, string>();
  for (const p of projects) {
    projIdToName.set(p.id, String(p.projectName ?? "").replace(/_Tracker$/i, ""));
  }
  if (projIdToName.size === 0) return out;

  const repo = new FinanceLineLevelRepository();
  const lines = await repo.getPortfolioFinanceLines([...projIdToName.keys()], {
    fyStart: opts.fyStart,
    fyEnd: opts.fyEnd,
  });
  for (const line of lines) {
    if (line.bucket !== "realised" || !line.recognitionMonth) continue;
    const name = projIdToName.get(line.projectId);
    if (!name) continue;
    const amount = opts.metric === "cos" ? line.actualTotal : line.perLineRevenue;
    if (!Number.isFinite(amount) || amount === 0) continue;
    let entry = out.get(line.recognitionMonth);
    if (!entry) {
      entry = { total: 0, projects: new Map() };
      out.set(line.recognitionMonth, entry);
    }
    entry.total += amount;
    entry.projects.set(name, (entry.projects.get(name) ?? 0) + amount);
  }
  // Round at finalisation (per-line += accumulates FP drift; see r2 note in
  // finance-line-level-repository).
  for (const entry of out.values()) {
    entry.total = Number(entry.total.toFixed(2));
    for (const [k, v] of entry.projects) entry.projects.set(k, Number(v.toFixed(2)));
  }
  return out;
}
