type MyWorkSource =
  | "personal"
  | "operational"
  | "plan"
  | "engineering_task"
  | "quality_task"
  | "approvals"
  | "deliverables"
  | "tr_register"
  | "notifications"
  | "microsoft";

type ProjectSubTab =
  | "task-grid"
  | "eng-tasks"
  | "quality"
  | "approvals"
  | "notifications"
  | "chat"
  | "local-files";

export interface MyWorkSourceLinkInput {
  source: MyWorkSource;
  rawId?: number | string | null;
  itemKey?: string | null;
  projectName?: string | null;
  sourceType?: string | null;
  linkedTaskId?: number | null;
  linkedTaskType?: "personal" | "operational" | null;
  linkedQualityItemInstanceId?: number | null;
  webLink?: string | null;
}

export interface MyWorkSourceLinks {
  sourceHref: string;
  sourceContextLabel: string;
  sourceTypeLabel: string;
  projectHref: string | null;
  externalHref: string | null;
}

function buildProjectHref(projectName?: string | null) {
  if (!projectName) return null;
  return `/project/${encodeURIComponent(projectName)}`;
}

function buildProjectExecutionHref(projectName: string, section: string, subTab?: ProjectSubTab) {
  const params = new URLSearchParams({ mode: "execution", section });
  if (subTab) params.set("subTab", subTab);
  return `${buildProjectHref(projectName)}?${params.toString()}`;
}

function buildMyWorkItemHref(itemKey?: string | null, fallback?: string) {
  if (itemKey) {
    return `/my-work/tasks?itemKey=${encodeURIComponent(itemKey)}`;
  }
  return fallback || "/my-work/tasks";
}

function toMicrosoftTypeLabel(sourceType?: string | null) {
  switch ((sourceType || "").toLowerCase()) {
    case "email":
      return "Microsoft Email";
    case "event":
      return "Microsoft Calendar";
    case "teams":
      return "Microsoft Teams";
    case "sharepoint_file":
      return "Microsoft File";
    default:
      return "Microsoft Item";
  }
}

function buildProjectContext(projectName: string, subTab: ProjectSubTab, label: string) {
  const sourceHref =
    subTab === "quality"
      ? buildProjectExecutionHref(projectName, "quality", subTab)
      : subTab === "eng-tasks"
        ? buildProjectExecutionHref(projectName, "engineering", subTab)
        : subTab === "task-grid"
          ? buildProjectExecutionHref(projectName, "delivery", subTab)
          : buildProjectExecutionHref(projectName, "collaboration", subTab);

  return {
    sourceHref,
    sourceContextLabel: label,
  };
}

export function buildMyWorkSourceLinks(input: MyWorkSourceLinkInput): MyWorkSourceLinks {
  const itemKey = input.itemKey || null;
  const projectHref = buildProjectHref(input.projectName);

  if (input.source === "personal") {
    return {
      sourceHref: buildMyWorkItemHref(itemKey, input.rawId ? `/my-work/tasks?itemKey=personal-${input.rawId}` : "/my-work/tasks"),
      sourceContextLabel: "Open personal task",
      sourceTypeLabel: "Personal Task",
      projectHref,
      externalHref: null,
    };
  }

  if (input.source === "tr_register") {
    return {
      sourceHref: buildMyWorkItemHref(itemKey, input.rawId ? `/my-work/tasks?itemKey=tr-${input.rawId}` : "/my-work/tasks"),
      sourceContextLabel: "Open action detail",
      sourceTypeLabel: "Action Item",
      projectHref,
      externalHref: null,
    };
  }

  if (input.source === "operational" && input.projectName) {
    const context = buildProjectContext(input.projectName, "task-grid", "Open project delivery");
    return {
      ...context,
      sourceTypeLabel: "Assigned Task",
      projectHref,
      externalHref: null,
    };
  }

  if (input.source === "plan" && input.projectName) {
    const context = buildProjectContext(input.projectName, "task-grid", "Open plan context");
    return {
      ...context,
      sourceTypeLabel: "Project Plan",
      projectHref,
      externalHref: null,
    };
  }

  if (input.source === "engineering_task" && input.projectName) {
    const context = buildProjectContext(input.projectName, "eng-tasks", "Open engineering context");
    return {
      ...context,
      sourceTypeLabel: "Engineering Task",
      projectHref,
      externalHref: null,
    };
  }

  if (input.source === "quality_task" && input.projectName) {
    const context = buildProjectContext(input.projectName, "quality", "Open quality context");
    return {
      ...context,
      sourceTypeLabel: "Quality Item",
      projectHref,
      externalHref: null,
    };
  }

  if (input.source === "deliverables" && input.projectName) {
    const context = buildProjectContext(input.projectName, "approvals", "Open deliverable flow");
    return {
      ...context,
      sourceTypeLabel: "Deliverable",
      projectHref,
      externalHref: null,
    };
  }

  if (input.source === "deliverables") {
    return {
      sourceHref: buildMyWorkItemHref(itemKey, input.rawId ? `/my-work/tasks?itemKey=${encodeURIComponent(`del-${input.rawId}`)}` : "/my-work/tasks"),
      sourceContextLabel: "Open deliverable detail",
      sourceTypeLabel: "Deliverable",
      projectHref,
      externalHref: null,
    };
  }

  if (input.source === "approvals" && input.projectName) {
    const approvalType = (input.sourceType || "").toLowerCase();
    const context = buildProjectContext(input.projectName, "approvals", "Open approval context");
    return {
      ...context,
      sourceTypeLabel:
        approvalType === "engineering"
          ? "Engineering Approval"
          : approvalType === "quality"
            ? "Quality Approval"
            : "General Approval",
      projectHref,
      externalHref: null,
    };
  }

  if (input.source === "approvals") {
    const approvalType = (input.sourceType || "").toLowerCase();
    return {
      sourceHref: buildMyWorkItemHref(itemKey, input.rawId ? `/my-work/tasks?itemKey=${encodeURIComponent(`approval-gen-${input.rawId}`)}` : "/my-work/tasks"),
      sourceContextLabel: "Open approval detail",
      sourceTypeLabel:
        approvalType === "engineering"
          ? "Engineering Approval"
          : approvalType === "quality"
            ? "Quality Approval"
            : "General Approval",
      projectHref,
      externalHref: null,
    };
  }

  if (input.source === "notifications") {
    if (input.projectName) {
      const context = buildProjectContext(input.projectName, "notifications", "Open project notifications");
      return {
        ...context,
        sourceTypeLabel: "Notification",
        projectHref,
        externalHref: input.webLink || null,
      };
    }

    return {
      sourceHref: input.webLink || buildMyWorkItemHref(itemKey),
      sourceContextLabel: input.webLink ? "Open original notification" : "Open notification detail",
      sourceTypeLabel: "Notification",
      projectHref,
      externalHref: input.webLink || null,
    };
  }

  if (input.source === "microsoft") {
    if (input.projectName && input.linkedTaskId && input.linkedTaskType === "operational") {
      const context = input.linkedQualityItemInstanceId
        ? buildProjectContext(input.projectName, "quality", "Open linked quality item")
        : buildProjectContext(input.projectName, "task-grid", "Open linked project task");
      return {
        ...context,
        sourceTypeLabel: toMicrosoftTypeLabel(input.sourceType),
        projectHref,
        externalHref: input.webLink || null,
      };
    }

    if (input.projectName) {
      const subTab: ProjectSubTab =
        input.sourceType === "sharepoint_file"
          ? "local-files"
          : "chat";
      const label = subTab === "local-files" ? "Open linked project files" : "Open linked project communication";
      const context = buildProjectContext(input.projectName, subTab, label);
      return {
        ...context,
        sourceTypeLabel: toMicrosoftTypeLabel(input.sourceType),
        projectHref,
        externalHref: input.webLink || null,
      };
    }

    if (input.linkedTaskId && input.linkedTaskType === "personal") {
      return {
        sourceHref: `/my-work/tasks?itemKey=${encodeURIComponent(`personal-${input.linkedTaskId}`)}`,
        sourceContextLabel: "Open linked personal task",
        sourceTypeLabel: toMicrosoftTypeLabel(input.sourceType),
        projectHref,
        externalHref: input.webLink || null,
      };
    }

    const fallbackHref =
      input.sourceType === "event"
        ? "/my-work/calendar"
        : input.sourceType === "teams"
          ? "/my-work/teams"
          : input.sourceType === "email"
            ? "/my-work/email"
            : "/my-work";

    return {
      sourceHref: input.webLink || fallbackHref,
      sourceContextLabel: input.webLink ? "Open Microsoft item" : "Open Microsoft workspace",
      sourceTypeLabel: toMicrosoftTypeLabel(input.sourceType),
      projectHref,
      externalHref: input.webLink || null,
    };
  }

  return {
    sourceHref: buildMyWorkItemHref(itemKey),
    sourceContextLabel: "Open item",
    sourceTypeLabel: "My Work Item",
    projectHref,
    externalHref: input.webLink || null,
  };
}
