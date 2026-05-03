/**
 * Excel-vs-App structured metrics.
 *
 * One JSON line per emit, prefixed `[ExcelVsApp.metrics]` so a log
 * forwarder (e.g. the existing `[SmartImport.metrics]` consumer)
 * can pick them up reliably without parsing free-form output.
 *
 * Three event shapes today:
 *   - `view` — diff page load. Captures verified / unverified
 *              counts so a dashboard can chart drift over time.
 *   - `resolve` — accept_excel / keep_app / request_approval.
 *                 Captures actor role + entry count + section.
 *   - `cell-edit` — operator wrote a manual_overrides entry from
 *                   one of the operational tabs (cost / revenue /
 *                   plan). Lets us see the cell-edit volume side
 *                   by side with import volume.
 *
 * Each emit includes `t` (ISO timestamp) and `tag` so consumers
 * can filter without a second pass.
 */

interface BaseEvent {
  tag: "ExcelVsApp.metrics";
  t: string;
}

export interface ViewMetric extends BaseEvent {
  op: "view";
  scope: "program" | "project";
  projectId?: number;
  unverifiedTotal: number;
  verifiedTotal: number;
  legacyRowsWithoutSnapshot?: number;
}

export interface ResolveMetric extends BaseEvent {
  op: "resolve";
  action: "accept_excel" | "keep_app" | "request_approval";
  projectId: number;
  section?: "PLAN" | "REVENUE" | "EXPENDITURE" | "MIXED";
  count: number;
  actorRole: string | null;
  actorUserId: number | null;
}

export type ExcelVsAppMetric = ViewMetric | ResolveMetric;

type ViewInput = Omit<ViewMetric, "tag" | "t">;
type ResolveInput = Omit<ResolveMetric, "tag" | "t">;

export function emitExcelVsAppMetric(m: ViewInput | ResolveInput): void {
  const out = { tag: "ExcelVsApp.metrics" as const, t: new Date().toISOString(), ...m };
  // eslint-disable-next-line no-console
  console.info(`[ExcelVsApp.metrics] ${JSON.stringify(out)}`);
}
