export interface PlatformRouteOwner {
  route: string;
  ownerFile: string;
  readEntities: string[];
  writeEntities: string[];
}

export const PLATFORM_ROUTE_OWNERSHIP: PlatformRouteOwner[] = [
  {
    route: "/api/projects-summary",
    ownerFile: "server/routes.ts",
    readEntities: ["project_info", "project_editable_fields", "normalized_cost_lines", "normalized_revenue_lines", "work_items"],
    writeEntities: [],
  },
  {
    route: "/api/platform/projects/:projectId/summary",
    ownerFile: "server/platform-routes.ts",
    readEntities: ["project_info", "project_editable_fields", "work_items", "work_item_assignments", "approvals", "deliverables", "audit_events"],
    writeEntities: [],
  },
  {
    route: "/api/projects-summary/:projectName/latest-update",
    ownerFile: "server/routes.ts",
    readEntities: ["project_editable_fields"],
    writeEntities: ["project_editable_fields", "audit_events"],
  },
  {
    route: "/api/projects/:projectId/phase",
    ownerFile: "server/engineering-routes.ts",
    readEntities: ["project_info", "project_phase_history", "stage_gate_definitions", "approvals", "work_items"],
    writeEntities: ["project_info", "project_phase_history", "project_gate_evaluations", "audit_events"],
  },
  {
    route: "/api/project-events/project/:projectId",
    ownerFile: "server/project-events-routes.ts",
    readEntities: ["audit_events", "project_events"],
    writeEntities: [],
  },
  {
    route: "/api/approvals/*",
    ownerFile: "server/approvals-routes.ts",
    readEntities: ["approvals", "deliverables", "project_info"],
    writeEntities: ["approvals", "audit_events"],
  },
  {
    route: "/api/deliverable-capture/*",
    ownerFile: "server/deliverable-capture-routes.ts",
    readEntities: ["deliverables", "project_info", "work_items"],
    writeEntities: ["deliverables", "audit_events"],
  },
  {
    route: "/api/quality/project/*",
    ownerFile: "server/quality-routes.ts",
    readEntities: ["qc_checklist", "qc_item_instance", "project_info", "work_items"],
    writeEntities: ["qc_checklist", "qc_item_instance", "audit_events"],
  },
  {
    route: "/api/projects/:projectId/eng-tasks",
    ownerFile: "server/engineering-routes.ts",
    readEntities: ["work_items", "project_info"],
    writeEntities: [],
  },
];
