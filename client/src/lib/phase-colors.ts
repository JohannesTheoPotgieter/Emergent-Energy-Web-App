/**
 * Single source of truth for project phase color mapping.
 * Used across engineering dashboard, tasks page, and project detail views.
 */
export const PHASE_COLORS: Record<string, { bg: string; text: string; accent: string }> = {
  P0_FIRST_ASSESSMENT: { bg: "bg-muted", text: "text-foreground", accent: "bg-slate-500" },
  P1_COST_PROPOSAL_DESIGN: { bg: "bg-violet-50", text: "text-violet-700", accent: "bg-violet-500" },
  P2_PD_PM_HANDOVER: { bg: "bg-indigo-50", text: "text-indigo-700", accent: "bg-indigo-500" },
  P3_DETAILED_DESIGN_PROC_RELEASE: { bg: "bg-blue-50", text: "text-blue-700", accent: "bg-blue-500" },
  P4_CONSTRUCTION_INSTALLATION: { bg: "bg-amber-50", text: "text-amber-700", accent: "bg-amber-500" },
  P5_COMMISSIONING_TESTING: { bg: "bg-orange-50", text: "text-orange-700", accent: "bg-orange-500" },
  P6_HANDOVER_CLIENT_MATRIARCH: { bg: "bg-teal-50", text: "text-teal-700", accent: "bg-teal-500" },
  P7_CLOSEOUT_POSTMORTEM: { bg: "bg-emerald-50", text: "text-emerald-700", accent: "bg-emerald-500" },
};
