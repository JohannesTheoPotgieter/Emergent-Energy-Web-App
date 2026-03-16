export type AssigneeType = "internal_user" | "external_counterparty" | "external_contact";

export type AssignableDirectoryEntry = {
  assigneeType: AssigneeType;
  assigneeId: number;
  displayLabel: string;
  secondaryLabel: string | null;
  sourceLabel: string;
  counterpartyId: number | null;
  contactId: number | null;
  isActive: boolean;
  roleTags: string[];
};

export type CanonicalAssignment = {
  id: number | null;
  entityType: string;
  entityId: number;
  assignmentRole: string;
  assigneeType: AssigneeType;
  assigneeId: number;
  displayLabel: string;
  displayLabelSnapshot: string;
  secondaryLabel: string | null;
  active: boolean;
};

export function getAuthHeaders(): Record<string, string> {
  const token = localStorage.getItem("auth_token");
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export function getAssignableQueryUrl(taskSource?: string, search?: string): string {
  const params = new URLSearchParams();
  if (taskSource) params.set("taskSource", taskSource);
  if (search) params.set("search", search);
  const qs = params.toString();
  return `/api/assignables${qs ? `?${qs}` : ""}`;
}

export async function fetchAssignables(taskSource?: string, search?: string): Promise<AssignableDirectoryEntry[]> {
  const res = await fetch(getAssignableQueryUrl(taskSource, search), {
    credentials: "include",
    headers: getAuthHeaders(),
  });
  if (!res.ok) {
    throw new Error("Failed to load assignables");
  }
  return res.json();
}

export function getLegacyExternalToken(entry: Pick<AssignableDirectoryEntry, "assigneeType" | "assigneeId">): string {
  if (entry.assigneeType === "external_counterparty") return `counterparty:${entry.assigneeId}`;
  if (entry.assigneeType === "external_contact") return `contact:${entry.assigneeId}`;
  return String(entry.assigneeId);
}

export function getAssigneeBadgeLabel(assigneeType: AssigneeType): string {
  switch (assigneeType) {
    case "internal_user":
      return "Internal";
    case "external_contact":
      return "Contact";
    default:
      return "External";
  }
}

export function isExternalAssigneeType(assigneeType: AssigneeType): boolean {
  return assigneeType === "external_contact" || assigneeType === "external_counterparty";
}

export function resolveLegacyExternalEntry(
  token: string,
  assignables: AssignableDirectoryEntry[],
): AssignableDirectoryEntry | null {
  if (token.startsWith("counterparty:")) {
    const id = Number(token.split(":")[1]);
    return assignables.find((entry) => entry.assigneeType === "external_counterparty" && entry.assigneeId === id) || null;
  }
  if (token.startsWith("contact:")) {
    const id = Number(token.split(":")[1]);
    return assignables.find((entry) => entry.assigneeType === "external_contact" && entry.assigneeId === id) || null;
  }
  return null;
}
