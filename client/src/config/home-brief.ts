export type QuickAction = {
  label: string;
  description: string;
  path: string;
};

function normalizeRole(value?: string | null) {
  return (value || "").trim().toLowerCase().replace(/[_\s]+/g, "-");
}

const roleAlias: Record<string, string> = {
  administrator: "admin",
  superadmin: "admin",
  "project-manager": "pm",
  "program-manager": "pm",
  "eng-program-manager": "engineering",
  "quality-manager": "quality",
  finance: "finance",
  member: "pm",
  viewer: "pm",
};

const roleQuickActions: Record<string, QuickAction[]> = {
  pm: [
    { label: "Project Board", description: "Review portfolio execution and status.", path: "/projects" },
    { label: "Approvals", description: "Clear pending approvals and unblock delivery.", path: "/my-work/approvals" },
    { label: "PM Handover Review", description: "Progress handover decisions.", path: "/pm/handover-review" },
    { label: "Execution Board", description: "Prioritize tasks and risks for today.", path: "/execution-board" },
  ],
  engineering: [
    { label: "Engineering Requests", description: "Triage new requests and assignments.", path: "/engineering/tasks" },
    { label: "Engineering Dashboard", description: "Monitor throughput and constraints.", path: "/engineering" },
    { label: "Review Queue", description: "Complete assigned technical reviews.", path: "/engineering/inbox" },
    { label: "PD Handover", description: "Coordinate technical handover items.", path: "/pd/pm-handover" },
  ],
  finance: [
    { label: "PO Approvals", description: "Approve pending procurement requests.", path: "/my-work/approvals" },
    { label: "Invoice Matching", description: "Resolve invoice linking and gaps.", path: "/actions/launchpad?action=link-invoice" },
    { label: "COS Control", description: "Check budget vs actual exceptions.", path: "/cos-control" },
    { label: "Cashflow", description: "Review near-term cashflow posture.", path: "/cashflow" },
  ],
  quality: [
    { label: "Quality Dashboard", description: "Track QA status and compliance issues.", path: "/quality" },
    { label: "Inspections", description: "Review inspections and close-outs.", path: "/quality" },
    { label: "My Approvals", description: "Resolve quality sign-off dependencies.", path: "/my-work/approvals" },
  ],
  admin: [
    { label: "Admin Control Center", description: "Monitor system governance and health.", path: "/admin/control-center" },
    { label: "Users & Roles", description: "Manage access and permissions.", path: "/admin/roles" },
    { label: "System Settings", description: "Update core operational settings.", path: "/admin/settings" },
    { label: "Company Priorities", description: "Manage company-wide priorities.", path: "/company-priorities" },
  ],
};

const defaultQuickActions: QuickAction[] = [
  { label: "My Tasks", description: "Start with your active tasks.", path: "/my-work/tasks" },
  { label: "Approvals", description: "Resolve pending approvals.", path: "/my-work/approvals" },
  { label: "Projects", description: "Check live project context.", path: "/projects" },
];

export function normalizeRoleLabel(value?: string | null) {
  const normalized = normalizeRole(value);
  return roleAlias[normalized] || normalized || "pm";
}

export function getRoleQuickActions(value?: string | null): QuickAction[] {
  const role = normalizeRoleLabel(value);
  return roleQuickActions[role] || defaultQuickActions;
}
