import { db } from "./db";
import { engStageTemplates, engTaskTemplates, engDeliverableTemplates } from "@shared/schema";
import { eq } from "drizzle-orm";

interface StageDef {
  name: string;
  sortOrder: number;
  purpose: string;
  inputs: string[];
  raciResponsible: string;
  raciAccountable: string;
  raciConsulted: string;
  raciInformed: string;
  failureModes: string[];
  stageGateRules: Record<string, any>;
  tasks: { title: string; description?: string; isRequired: boolean; sequence: number; defaultOwnerRole: string }[];
  deliverables: { name: string; description?: string; isRequired: boolean; allowedFileTypes?: string[]; requiredCount: number }[];
}

const STAGE_DEFS: StageDef[] = [
  {
    name: "First Assessment",
    sortOrder: 1,
    purpose: "Pre-Costing Engineering Filter — determine technical viability before cost proposal effort.",
    inputs: [
      "Site address / coordinates",
      "Roof photos or drone imagery",
      "Client electricity bill / demand profile",
      "Grid connection info (NMD, supply voltage)",
    ],
    raciResponsible: "Engineer",
    raciAccountable: "Tanaka (Design Lead)",
    raciConsulted: "HoPD",
    raciInformed: "COO",
    failureModes: [
      "Overdesign too early",
      "PD sells before structural risks flagged",
      "No red-flag log maintained",
    ],
    stageGateRules: { requireAllTasks: true, requireAllDeliverables: true },
    tasks: [
      { title: "Site Technical Feasibility Review", description: "Roof orientation/tilt, shading risk visual, roof area estimate, structural risk flags, grid capacity check", isRequired: true, sequence: 1, defaultOwnerRole: "ENGINEER" },
      { title: "Rough System Sizing", description: "kWp estimate from area, inverter sizing logic, export constraint assumption", isRequired: true, sequence: 2, defaultOwnerRole: "ENGINEER" },
      { title: "Red Flag Identification", description: "Asbestos, weak supply, shading heavy, wind region, etc.", isRequired: true, sequence: 3, defaultOwnerRole: "ENGINEER" },
    ],
    deliverables: [
      { name: "Feasibility Note", description: "Text record of technical feasibility assessment", isRequired: true, requiredCount: 1 },
      { name: "Go / Conditional Go / No Go Decision", description: "Formal decision record on project viability", isRequired: true, requiredCount: 1 },
    ],
  },
  {
    name: "Cost Proposal",
    sortOrder: 2,
    purpose: "Technical model + commercial backbone — produce the engineering inputs required for an accurate cost proposal.",
    inputs: [
      "First Assessment outputs",
      "Structural survey report (if available)",
      "Detailed roof plans / as-built drawings",
      "Electrical reticulation diagrams",
      "Client requirements specification",
    ],
    raciResponsible: "Design Engineer",
    raciAccountable: "Tanaka",
    raciConsulted: "Project Finance",
    raciInformed: "COO + HoPD",
    failureModes: [
      "Undocumented assumptions",
      "Overstated yield",
      "Grid risk not priced",
    ],
    stageGateRules: { requireAllTasks: true, requireAllDeliverables: true },
    tasks: [
      { title: "Detailed PV Modelling", description: "Helioscope layout, PV*SOL model, shading analysis, string config, loss assumptions", isRequired: true, sequence: 1, defaultOwnerRole: "ENGINEER" },
      { title: "Electrical Design", description: "Prelim SLD, inverter selection, AC combiner logic, protection philosophy, metering design", isRequired: true, sequence: 2, defaultOwnerRole: "ENGINEER" },
      { title: "Grid Compliance Pre-Check", description: "NRS alignment, inverter cert, export limitation strategy", isRequired: true, sequence: 3, defaultOwnerRole: "ENGINEER" },
      { title: "Structural Allowance Assumption", description: "kg/m² loading calc, ballast vs penetration, placeholder risk", isRequired: true, sequence: 4, defaultOwnerRole: "ENGINEER" },
      { title: "Costing Input Sheet Completion", description: "BOS quantities, cable length estimates, mounting selection, labour assumptions", isRequired: true, sequence: 5, defaultOwnerRole: "ENGINEER" },
    ],
    deliverables: [
      { name: "CP Pack Deliverable Set", description: "Yield summary, prelim SLD, assumption register", isRequired: true, requiredCount: 1 },
    ],
  },
  {
    name: "IFC Planning",
    sortOrder: 3,
    purpose: "Project Engineer execution phase — finalize all Issued for Construction (IFC) documentation.",
    inputs: [
      "Cost Proposal outputs",
      "Signed EPC contract",
      "Final structural survey",
      "Site visit measurements",
      "Equipment procurement confirmations",
    ],
    raciResponsible: "Project Engineer",
    raciAccountable: "Tanaka",
    raciConsulted: "PM + CM",
    raciInformed: "COO",
    failureModes: [
      "IFC not frozen → change orders explode",
    ],
    stageGateRules: { requireAllTasks: true, requireAllDeliverables: true },
    tasks: [
      { title: "Final site visit + measurements", description: "Verify all site dimensions and conditions", isRequired: true, sequence: 1, defaultOwnerRole: "ENGINEER" },
      { title: "Confirm inverter room layout", description: "Finalize inverter room positioning and ventilation", isRequired: true, sequence: 2, defaultOwnerRole: "ENGINEER" },
      { title: "Confirm cable routing", description: "Finalize DC and AC cable routes", isRequired: true, sequence: 3, defaultOwnerRole: "ENGINEER" },
      { title: "Confirm mounting detail", description: "Final mounting system specification and layout", isRequired: true, sequence: 4, defaultOwnerRole: "ENGINEER" },
      { title: "Final SLD (IFC)", description: "Issue single line diagram for construction", isRequired: true, sequence: 5, defaultOwnerRole: "ENGINEER" },
      { title: "Earthing design", description: "Complete earthing and lightning protection design", isRequired: true, sequence: 6, defaultOwnerRole: "ENGINEER" },
      { title: "Protection settings finalization", description: "Finalize all protection relay and breaker settings", isRequired: true, sequence: 7, defaultOwnerRole: "ENGINEER" },
      { title: "Detailed cable schedules", description: "Complete cable schedule with sizes, lengths, and terminations", isRequired: true, sequence: 8, defaultOwnerRole: "ENGINEER" },
      { title: "String layouts", description: "Final string configuration layouts", isRequired: true, sequence: 9, defaultOwnerRole: "ENGINEER" },
    ],
    deliverables: [
      { name: "IFC Drawing Pack", description: "Complete set of Issued for Construction drawings", isRequired: true, requiredCount: 1 },
      { name: "BOQ Freeze Confirmation", description: "Signed-off Bill of Quantities freeze document", isRequired: true, requiredCount: 1 },
      { name: "Technical Issue Log", description: "Log of all technical issues identified and resolved", isRequired: true, requiredCount: 1 },
    ],
  },
  {
    name: "Construction Support",
    sortOrder: 4,
    purpose: "Project Engineer execution phase — provide engineering support during construction.",
    inputs: [
      "IFC Drawing Pack",
      "BOQ",
      "Construction programme",
      "Site photos and progress reports",
    ],
    raciResponsible: "Project Engineer",
    raciAccountable: "Tanaka",
    raciConsulted: "PM + CM",
    raciInformed: "COO",
    failureModes: [
      "Site changes without signoff",
      "As-built differs from IFC",
      "Commissioning data missing",
    ],
    stageGateRules: { requireAllTasks: true, requireAllDeliverables: true },
    tasks: [
      { title: "Respond to RFIs", description: "Address all Requests for Information from site", isRequired: true, sequence: 1, defaultOwnerRole: "ENGINEER" },
      { title: "Approve substitutions", description: "Review and approve any material/equipment substitutions", isRequired: true, sequence: 2, defaultOwnerRole: "ENGINEER" },
      { title: "Review installation photos", description: "Check installation quality from site photos", isRequired: true, sequence: 3, defaultOwnerRole: "ENGINEER" },
      { title: "Verify inverter settings", description: "Confirm inverter programming and settings", isRequired: true, sequence: 4, defaultOwnerRole: "ENGINEER" },
      { title: "Grid witness testing support", description: "Support grid operator witness testing process", isRequired: true, sequence: 5, defaultOwnerRole: "ENGINEER" },
      { title: "Commissioning sheet review", description: "Review and validate commissioning test sheets", isRequired: true, sequence: 6, defaultOwnerRole: "ENGINEER" },
      { title: "Snag list technical close-out", description: "Technical review and close-out of all snag items", isRequired: true, sequence: 7, defaultOwnerRole: "ENGINEER" },
    ],
    deliverables: [
      { name: "RFI Log", description: "Complete log of all RFIs with responses", isRequired: true, requiredCount: 1 },
      { name: "Approved Substitutions Register", description: "Register of all approved material/equipment substitutions", isRequired: true, requiredCount: 1 },
      { name: "Commissioning Review Signoff", description: "Signed-off commissioning review document", isRequired: true, requiredCount: 1 },
    ],
  },
  {
    name: "Handover Pack",
    sortOrder: 5,
    purpose: "Compile complete project handover documentation with QA review and technical signoff.",
    inputs: [
      "All previous stage outputs",
      "As-built information from site",
      "Test reports and certificates",
      "Equipment datasheets and warranties",
    ],
    raciResponsible: "Project Engineer (pack compilation)",
    raciAccountable: "Tanaka (final signoff)",
    raciConsulted: "Dean (QA)",
    raciInformed: "PM + COO",
    failureModes: [
      "Missing CoCs",
      "As-built mismatch",
      "No version control",
      "Rushed for invoice milestone",
    ],
    stageGateRules: { requireAllTasks: true, requireAllDeliverables: true, requireQaApproval: true, requireTechnicalSignoff: true },
    tasks: [
      { title: "As-built SLD", description: "Final as-built single line diagram", isRequired: true, sequence: 1, defaultOwnerRole: "ENGINEER" },
      { title: "As-built layout drawings", description: "Final as-built layout drawings", isRequired: true, sequence: 2, defaultOwnerRole: "ENGINEER" },
      { title: "Cable schedule final", description: "Final as-built cable schedule", isRequired: true, sequence: 3, defaultOwnerRole: "ENGINEER" },
      { title: "Datasheets (as installed)", description: "Datasheets for all installed equipment", isRequired: true, sequence: 4, defaultOwnerRole: "ENGINEER" },
      { title: "CoCs", description: "Certificates of Compliance", isRequired: true, sequence: 5, defaultOwnerRole: "ENGINEER" },
      { title: "Test reports", description: "All test reports (insulation, earth, etc.)", isRequired: true, sequence: 6, defaultOwnerRole: "ENGINEER" },
      { title: "Commissioning sheets", description: "Completed commissioning datasheets", isRequired: true, sequence: 7, defaultOwnerRole: "ENGINEER" },
      { title: "PR report", description: "Performance Ratio report", isRequired: true, sequence: 8, defaultOwnerRole: "ENGINEER" },
      { title: "SSEG approval (if applicable)", description: "Small Scale Embedded Generation approval documentation", isRequired: false, sequence: 9, defaultOwnerRole: "ENGINEER" },
      { title: "O&M manual", description: "Operations and Maintenance manual", isRequired: true, sequence: 10, defaultOwnerRole: "ENGINEER" },
      { title: "Warranty register", description: "Complete warranty register for all equipment", isRequired: true, sequence: 11, defaultOwnerRole: "ENGINEER" },
      { title: "Final performance summary", description: "Summary of system performance vs design", isRequired: true, sequence: 12, defaultOwnerRole: "ENGINEER" },
      { title: "Internal QA Review (Dean)", description: "QA review of complete handover pack — REQUIRED", isRequired: true, sequence: 13, defaultOwnerRole: "QUALITY_MANAGER" },
      { title: "Final Technical Signoff (Tanaka)", description: "Final technical signoff of handover pack — REQUIRED", isRequired: true, sequence: 14, defaultOwnerRole: "ENGINEER" },
      { title: "PM issues to client", description: "PM issues handover pack to client (informational step)", isRequired: false, sequence: 15, defaultOwnerRole: "PROJECT_MANAGER_SITE" },
    ],
    deliverables: [
      { name: "Complete HO Pack Deliverable Set", description: "Complete handover pack with versioning including all documents", isRequired: true, requiredCount: 1 },
    ],
  },
];

export async function seedEngStageTemplates() {
  try {
    const existing = await db.select({ id: engStageTemplates.id }).from(engStageTemplates).limit(1);
    if (existing.length > 0) {
      console.log("[Seed] Engineering stage templates already present, skipping.");
      return;
    }

    for (const stage of STAGE_DEFS) {
      const [template] = await db.insert(engStageTemplates).values({
        name: stage.name,
        purpose: stage.purpose,
        inputs: stage.inputs,
        raciResponsible: stage.raciResponsible,
        raciAccountable: stage.raciAccountable,
        raciConsulted: stage.raciConsulted,
        raciInformed: stage.raciInformed,
        failureModes: stage.failureModes,
        stageGateRules: stage.stageGateRules,
        sortOrder: stage.sortOrder,
      }).returning({ id: engStageTemplates.id });

      for (const task of stage.tasks) {
        await db.insert(engTaskTemplates).values({
          stageTemplateId: template.id,
          title: task.title,
          description: task.description,
          isRequired: task.isRequired,
          sequence: task.sequence,
          defaultOwnerRole: task.defaultOwnerRole,
        });
      }

      for (const del of stage.deliverables) {
        await db.insert(engDeliverableTemplates).values({
          stageTemplateId: template.id,
          name: del.name,
          description: del.description,
          isRequired: del.isRequired,
          allowedFileTypes: del.allowedFileTypes || null,
          requiredCount: del.requiredCount,
        });
      }
    }

    console.log(`[Seed] Engineering stage templates seeded: ${STAGE_DEFS.length} stages`);
  } catch (error) {
    console.error("[Seed] Engineering stage templates error:", error);
  }
}
