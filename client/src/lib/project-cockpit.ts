export type CockpitMode = "executive" | "execution";

export type CockpitExecutionTarget = {
  section: string;
  subTab?: string;
};

export function parseCockpitMode(mode: string | null | undefined): CockpitMode {
  return mode === "execution" ? "execution" : "executive";
}

export function toCockpitModeQuery(searchParams: URLSearchParams, mode: CockpitMode): string {
  const next = new URLSearchParams(searchParams.toString());
  next.set("mode", mode);
  return next.toString();
}

export function resolveSummaryDeepLink(target: "plan" | "procurement" | "quality" | "history"): CockpitExecutionTarget {
  switch (target) {
    case "plan":
      return { section: "delivery", subTab: "task-grid" };
    case "procurement":
      return { section: "commercial", subTab: "procurement" };
    case "quality":
      return { section: "quality", subTab: "quality" };
    case "history":
      return { section: "collaboration", subTab: "history" };
    default:
      return { section: "overview" };
  }
}
