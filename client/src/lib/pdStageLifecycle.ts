import { PHASE_BY_CODE, type CanonicalPhase } from "@shared/phases";

const PD_STAGE_TO_LIFECYCLE_CODE: Record<string, string> = {
  prospect: "S01_FIRST_ASSESSMENT",
  qualification: "S01_FIRST_ASSESSMENT",
  proposal: "S02_DESIGN_COST_PROPOSAL",
  negotiation: "S02_DESIGN_COST_PROPOSAL",
  contracting: "S03_SIGNATURE_FINANCIAL_CLOSE",
};

export function pdStageToLifecycle(stage: string | null | undefined): CanonicalPhase | null {
  if (!stage) return null;
  const s = String(stage).trim().toLowerCase();
  if (!s) return null;
  for (const key of Object.keys(PD_STAGE_TO_LIFECYCLE_CODE)) {
    if (s.includes(key)) {
      const code = PD_STAGE_TO_LIFECYCLE_CODE[key];
      return PHASE_BY_CODE[code] ?? null;
    }
  }
  return null;
}

export function pdStageLifecycleLabel(stage: string | null | undefined): string | null {
  return pdStageToLifecycle(stage)?.label ?? null;
}
