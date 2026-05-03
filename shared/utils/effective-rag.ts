// ============================================================
// Effective RAG — single rule for translating stored rag_status
// into the value users actually see.
// ============================================================
// Today the only override is the in_dlp flag on project_info: when a
// project is in the Defect Liability Period it is forced to "red" with
// reason "In DLP" regardless of the stored value. Future overrides
// (compliance breaches, finance freezes, etc.) belong here too.
// ============================================================

export type RagValue = "green" | "amber" | "red" | null;

export interface EffectiveRagInput {
  /** Stored rag_status from project_execution_state. May be any case. */
  ragStatus: string | null | undefined;
  /** project_info.in_dlp flag. */
  inDlp: boolean | null | undefined;
}

export interface EffectiveRag {
  value: RagValue;
  /** Human-readable reason when the rule overrode the stored value. */
  reason: string | null;
  /** True if the value was forced by an override. */
  overridden: boolean;
}

const VALID_RAG = new Set(["green", "amber", "red"]);

function normalise(rag: string | null | undefined): RagValue {
  if (!rag) return null;
  const lc = rag.trim().toLowerCase();
  if (lc === "at risk") return "amber";
  return VALID_RAG.has(lc) ? (lc as RagValue) : null;
}

/** Compute the effective RAG value for a project. */
export function computeEffectiveRag(input: EffectiveRagInput): EffectiveRag {
  const stored = normalise(input.ragStatus);
  if (input.inDlp) {
    return { value: "red", reason: "In DLP", overridden: stored !== "red" };
  }
  return { value: stored, reason: null, overridden: false };
}

/** Lower-case helper for aggregation buckets ("green" / "amber" / "red" / ""). */
export function effectiveRagBucket(input: EffectiveRagInput): "green" | "amber" | "red" | "" {
  const r = computeEffectiveRag(input).value;
  return r ?? "";
}
