import type { PermissionAction, PermissionEntity } from "@shared/schema";

export type QuickCreateActionId =
  | "pd-ticket"
  | "engineering-request"
  | "task"
  | "handover"
  | "create-po"
  | "link-invoice";

export type QuickCreateAction = {
  id: QuickCreateActionId;
  label: string;
  path: string;
};

type ActionAccessContext = {
  canViewPath: (path: string) => boolean;
  canAccessEntityAction: (entity: PermissionEntity, action: PermissionAction) => boolean;
};

type ActionDefinition = QuickCreateAction & {
  isVisible: (context: ActionAccessContext) => boolean;
};

const QUICK_CREATE_ACTIONS: ActionDefinition[] = [
  {
    id: "pd-ticket",
    label: "New PD Ticket",
    path: "/pd/tickets/create",
    isVisible: ({ canAccessEntityAction }) => canAccessEntityAction("pd_tickets", "create"),
  },
  {
    id: "engineering-request",
    label: "Create Engineering Request",
    path: "/actions/launchpad?action=engineering-request",
    isVisible: ({ canAccessEntityAction }) => canAccessEntityAction("eng_tasks", "create"),
  },
  {
    id: "task",
    label: "Create Task",
    path: "/actions/launchpad?action=task",
    isVisible: ({ canAccessEntityAction }) => canAccessEntityAction("eng_tasks", "create"),
  },
  {
    id: "handover",
    label: "Start Handover",
    path: "/actions/launchpad?action=handover",
    isVisible: ({ canAccessEntityAction, canViewPath }) =>
      canAccessEntityAction("projects", "edit") || canViewPath("/handover-control"),
  },
  {
    id: "create-po",
    label: "Create PO",
    path: "/actions/launchpad?action=create-po",
    isVisible: ({ canViewPath }) => canViewPath("/pm/on-the-go"),
  },
  {
    id: "link-invoice",
    label: "Link Invoice",
    path: "/actions/launchpad?action=link-invoice",
    isVisible: ({ canViewPath }) => canViewPath("/pm/on-the-go"),
  },
];

export function getAvailableQuickCreateActions(context: ActionAccessContext): QuickCreateAction[] {
  return QUICK_CREATE_ACTIONS
    .filter((action) => action.isVisible(context))
    .map(({ id, label, path }) => ({ id, label, path }));
}
