/**
 * Canonical Pipedrive → app stage mapping for the Main EE pipeline.
 *
 * Stage names are matched case-insensitively against the `stage_name`
 * returned by GET /v1/stages. The sync service fetches stage definitions
 * once per run and builds a stageId → name lookup before processing deals.
 *
 * conversionCta drives the one-click CTA button shown on the intake page:
 *   "first_assessment" → "Spawn First Assessment" button
 *   "cost_proposal"    → "Spawn Cost Proposal" button
 *   null               → no spawn CTA (read-only row)
 *
 * skipSync = true means deals in this Pipedrive stage are never imported.
 */

export interface PipedriveStageMapping {
  appStage: string;
  appStatus: string;
  skipSync: boolean;
  conversionCta: "first_assessment" | "cost_proposal" | null;
}

// Keys are lowercased Pipedrive stage names (exact match after trim+lower).
export const MAIN_EE_PIPELINE_STAGE_MAP: Record<string, PipedriveStageMapping> = {
  "dormant opportunities": {
    appStage: "prospect",
    appStatus: "on_hold",
    skipSync: true,
    conversionCta: null,
  },
  "create excitement": {
    appStage: "prospect",
    appStatus: "active",
    skipSync: false,
    conversionCta: null,
  },
  "s2 emergent way intro - get buy in": {
    appStage: "qualification",
    appStatus: "active",
    skipSync: false,
    conversionCta: null,
  },
  "prepare fa": {
    appStage: "qualification",
    appStatus: "active",
    skipSync: false,
    conversionCta: "first_assessment",
  },
  "s3 build commitment": {
    appStage: "proposal",
    appStatus: "active",
    skipSync: false,
    conversionCta: "cost_proposal",
  },
  "s4 test intentions": {
    appStage: "negotiation",
    appStatus: "active",
    skipSync: false,
    conversionCta: null,
  },
  "s5 get the signature": {
    appStage: "negotiation",
    appStatus: "active",
    skipSync: false,
    conversionCta: null,
  },
};

/**
 * Resolve the app-side stage/status for a Pipedrive deal.
 *
 * Priority order:
 *  1. Terminal deal.status ('won', 'lost', 'deleted') always wins.
 *  2. Exact stage-name lookup in MAIN_EE_PIPELINE_STAGE_MAP.
 *  3. Unknown stage (different pipeline or new stage not yet mapped) →
 *     safe default: prospect/active, no CTA. These will appear in the
 *     intake page as unconverted rows so nothing is silently dropped.
 */
export function resolvePipedriveStageMapping(
  stageName: string | null,
  dealStatus: string,
): PipedriveStageMapping {
  if (dealStatus === "won") {
    return { appStage: "won", appStatus: "won", skipSync: false, conversionCta: null };
  }
  if (dealStatus === "lost" || dealStatus === "deleted") {
    return { appStage: "lost", appStatus: "lost", skipSync: false, conversionCta: null };
  }

  const key = (stageName ?? "").trim().toLowerCase();
  return (
    MAIN_EE_PIPELINE_STAGE_MAP[key] ?? {
      appStage: "prospect",
      appStatus: "active",
      skipSync: false,
      conversionCta: null,
    }
  );
}

/**
 * Derive the one-click spawn CTA from the stored app stage value.
 * Used by the intake route so the frontend knows which button to render
 * without re-running the full stage-name resolution.
 */
export function getConversionCta(
  appStage: string | null,
): "first_assessment" | "cost_proposal" | null {
  const s = (appStage ?? "").toLowerCase();
  if (s === "qualification") return "first_assessment";
  if (s === "proposal") return "cost_proposal";
  return null;
}
