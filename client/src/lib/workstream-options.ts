export interface WorkstreamOption {
  value: string;
  label: string;
  badgeClass: string;
  filterClass: string;
}

export const WORKSTREAM_OPTIONS: WorkstreamOption[] = [
  {
    value: "PM",
    label: "Project",
    badgeClass: "bg-emerald-100 text-emerald-800",
    filterClass: "bg-emerald-50 text-emerald-700 border-emerald-200",
  },
  {
    value: "ENG",
    label: "Engineering",
    badgeClass: "bg-blue-100 text-blue-800",
    filterClass: "bg-blue-50 text-blue-700 border-blue-200",
  },
  {
    value: "QUALITY",
    label: "Quality",
    badgeClass: "bg-purple-100 text-purple-800",
    filterClass: "bg-purple-50 text-purple-700 border-purple-200",
  },
];

export const UNKNOWN_WORKSTREAM_OPTION: WorkstreamOption = {
  value: "",
  label: "Unspecified",
  badgeClass: "bg-slate-100 text-slate-700",
  filterClass: "bg-slate-50 text-slate-700 border-slate-200",
};

export function resolveWorkstream(raw: string | null | undefined): WorkstreamOption {
  if (!raw) return WORKSTREAM_OPTIONS[0];
  if (raw === "SMART_IMPORT") return WORKSTREAM_OPTIONS[0];
  const match = WORKSTREAM_OPTIONS.find((w) => w.value === raw);
  if (match) return match;
  return { ...UNKNOWN_WORKSTREAM_OPTION, label: raw };
}

export function workstreamMatchesFilter(
  raw: string | null | undefined,
  filterValue: string,
): boolean {
  if (filterValue === "All") return true;
  const resolved = resolveWorkstream(raw);
  return resolved.value === filterValue;
}
