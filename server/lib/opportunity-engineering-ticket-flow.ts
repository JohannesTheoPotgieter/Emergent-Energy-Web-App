export type CustomTicketDraftInput = {
  title: string;
  phase: string;
  descriptionScope: string;
  dueDate: string;
  priority: "Critical" | "High" | "Medium" | "Low";
  requiredOutput: string;
};

export type TemplateTicketItemInput = {
  id: number;
  title: string;
  description: string | null;
  defaultPriority: string | null;
  offsetDaysFromPhaseStart: number | null;
};

export function buildSamePhaseDuplicateWarning(phase: string, existingCount: number): string[] {
  if (existingCount <= 0) return [];
  return [
    `Potential duplicate: ${existingCount} existing ticket(s) already use phase '${phase}' for this opportunity/project.`,
  ];
}

export function buildCustomComments(input: CustomTicketDraftInput): string {
  return `Scope: ${input.descriptionScope}\nRequired Output: ${input.requiredOutput}`;
}

function addDaysIso(baseIso: string, days: number): string {
  const d = new Date(baseIso);
  if (Number.isNaN(d.getTime())) return baseIso;
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

export function buildTemplateTicketDrafts(params: {
  templatePhase: string;
  templateName: string;
  templateVersion: number;
  baseDueDate: string;
  items: TemplateTicketItemInput[];
}) {
  return params.items.map((item) => ({
    templateItemId: item.id,
    title: item.title,
    requestType: params.templatePhase,
    dueDate: addDaysIso(params.baseDueDate, Number(item.offsetDaysFromPhaseStart || 0)),
    priority: item.defaultPriority || "Medium",
    comments: `${item.description || "Generated from phase template."}\n[Template: ${params.templateName} v${params.templateVersion}]`,
  }));
}
