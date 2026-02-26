import { db } from "./db";
import { eeInfoNodes } from "@shared/schema";
import { eq } from "drizzle-orm";
import { randomUUID } from "crypto";

interface NodeUpdate {
  slug: string;
  title: string;
  category: string;
  contentMarkdown: string;
  status: string;
  responsibleRole?: string;
  escalationRole?: string;
}

const NEW_NODES: NodeUpdate[] = [
  {
    slug: "cos-tracking",
    title: "COS Tracking",
    category: "process",
    status: "published",
    responsibleRole: "Head of Finance",
    escalationRole: "COO",
    contentMarkdown: `## Cost of Sales (COS) Tracking

COS tracking monitors the realisation of project expenditure — whether invoices have been raised, confirmed, and paid.

### The 4 COS Statuses

Every expenditure line in the system gets one of 4 statuses:

1. **COS Realised** — The line has an Invoice Number AND the Invoice Raised Date has **black font colour** (confirmed paid). This means the cost has been formally realised.
2. **Deferred** — The line has an invoice and invoice date, but the font is **red** (not yet confirmed). The cost exists but hasn't been realised yet.
3. **Flagged** — The invoice date font IS black (confirmed), but the Invoice Number is **missing**. This needs attention — something is incomplete.
4. **Planned** — Default state for all other lines. No invoice or confirmation present yet.

### Font Colour Rules

- **Black font** on invoice date = confirmed/paid
- **Red font** on invoice date = forecast/not yet confirmed
- **NULL or empty** font colour = treated as NOT confirmed (this is important — it does NOT default to confirmed)
- PO number is NOT required for COS realisation

### COS Flagged Override

Users can override the Flagged status by clicking the badge in the COS Tracker. An override dialog lets you provide a new status and reason. Overrides are stored in the database and persist across re-imports. The override reason is shown on hover.

### Where to See COS Data

- **Company-wide**: Money > COS Tracker (monthly grid with drill-down)
- **Project-level**: Project Detail > Money > COS Tracker sub-tab (grouped by expense category)

### Related Processes
- [[Cashflow Management]]
- [[Revenue Recognition]]
- [[Payment Requests (PMA2)]]`,
  },
  {
    slug: "cashflow-management",
    title: "Cashflow Management",
    category: "process",
    status: "published",
    responsibleRole: "Head of Finance",
    escalationRole: "COO",
    contentMarkdown: `## Cashflow Management

Cashflow tracking monitors when money actually leaves or enters the company bank account, separate from COS realisation.

### Cash Outflow Statuses

- **Out of Bank** — Payment date font is **black** AND has an invoice number. Money has actually left the bank.
- **Payment Planned** — Payment date exists but font is **red**. Payment is scheduled but not yet made.
- **Planned** — No payment date or insufficient data. Default state.

### Font Colour Toggle

Users can click the colour dot next to payment dates in the Expenditure Breakdown to toggle between:
- **Black** (confirmed — payment has been made)
- **Red** (forecast — payment is planned)

This override is saved in the database and persists across re-imports.

### Cashflow Views

- **Company Cashflow**: Money > Cashflow — shows aggregated inflows and outflows
- **Cashflow Forecast**: Projected cash position based on planned payments and expected revenue
- **Project-level**: Each project's detail page shows its own cashflow breakdown

### Related Processes
- [[COS Tracking]]
- [[Revenue Recognition]]`,
  },
  {
    slug: "revenue-recognition",
    title: "Revenue Recognition",
    category: "process",
    status: "published",
    responsibleRole: "Head of Finance",
    contentMarkdown: `## Revenue Recognition

Revenue recognition tracks the amounts clients owe or have paid for project work.

### How Revenue is Tracked

- Revenue amounts are extracted from the "REVENUE RECOGNITION AMOUNT" column in the Expenditure Breakdown sheet during Smart Import
- Stored per expenditure line in the database
- Both the legacy parser and Smart Import normaliser extract this field

### Revenue Views

- **Company Revenue**: Money > Revenue — shows revenue tracking across all projects
- **Project Revenue**: Project Detail > Revenue tab — per-project breakdown
- **COS Tracker**: YTD Revenue Realised is tracked alongside COS for margin analysis

### Related Processes
- [[COS Tracking]]
- [[Cashflow Management]]
- [[Smart Import Process]]`,
  },
  {
    slug: "smart-import-process",
    title: "Smart Import Process",
    category: "process",
    status: "published",
    responsibleRole: "Program Manager",
    contentMarkdown: `## Smart Import Process

Smart Import is the **sole method** for creating and updating project data in the system. It's a 5-step wizard that takes Excel tracker files and imports them into the database.

### The 5 Steps

1. **Upload** — Drag and drop Excel tracker files. Multiple files can be uploaded at once.
2. **Section Detection** — The system automatically detects Plan, Revenue, and Expenditure Breakdown sections in each file.
3. **Column Mapping** — Excel columns are mapped to standard system fields. Costed columns (left side) and Actual columns (right side) are mapped separately.
4. **Issue Resolution** — Data validation highlights problems. Users can Accept, Ignore, or fix issues.
5. **Commit** — Validated data is saved to the database.

### Project Name Derivation

The project name comes from the Excel filename:
- Everything before "_Tracker" or "_tracker" becomes the project name
- Underscores are replaced with spaces
- Example: \`Coega_Steels_Phase_2_Tracker.xlsx\` → "Coega Steels Phase 2"

### Re-Import Behaviour

Re-importing the same file updates existing data rather than creating duplicates. Font colour overrides (for COS/cashflow status) persist across re-imports.

### Costed vs Actual Detection

The Expenditure Breakdown sheet has dual sections:
- **Costed** (left, columns 2-8): costed qty, costed rate, costed total, costed COS
- **Actual** (right, columns 13-26): actual quantities, rates, invoice data, payment data

### Data End Detection

The detector scans up to 50 rows ahead past empty gaps to find more data. This prevents premature cutoff when Excel files have large empty row gaps between categories.

### Related Processes
- [[Excel Project Tracker]]
- [[COS Tracking]]`,
  },
  {
    slug: "weekly-review-process",
    title: "Weekly Review Process",
    category: "process",
    status: "published",
    responsibleRole: "Project Manager",
    escalationRole: "Program Manager",
    contentMarkdown: `## Weekly Review Process

A structured 6-step process for Project Managers to report weekly on project status.

### The 6 Steps

1. **Schedule** — Is the project on track, delayed, or ahead?
2. **Costed** — Any variances or financial concerns?
3. **Risks** — Active risk assessment and mitigation
4. **Quality** — Inspection and quality status
5. **Actions** — Next week's tasks and deliverables
6. **Summary** — Overall status and key messages for management

### Who Does It

- **Project Managers** (Site PMs) complete the weekly review for each project they manage
- **Program Manager** oversees completion across all projects
- **COO/CEO** review submitted reports for oversight

### Tracking Compliance

The Weekly Reviews page shows:
- Which projects have completed their weekly check-in
- Which are overdue
- Historical review data

### Related Processes
- [[Project Management & Accounting (PMA)]]
- [[Project Development & Project Management (PDPM)]]`,
  },
  {
    slug: "engineering-stage-gating",
    title: "Engineering Stage Gating",
    category: "process",
    status: "published",
    responsibleRole: "Head of Engineering",
    escalationRole: "COO",
    contentMarkdown: `## Engineering Stage Gating

Stage gating controls when an engineering stage can be marked as complete. Each stage has gate rules that must be satisfied.

### Gate Rule Types

- **requireAllTasks** — All required tasks must be marked complete
- **requireDeliverables** — All required deliverables must be uploaded
- **requireQaApproval** — QA Review approval must be obtained (Handover Pack)
- **requireTechnicalSignoff** — Technical Signoff must be obtained (Handover Pack)

### Handover Pack Special Rules

The Handover Pack stage has the strictest gating:
- All 12+ tasks must be complete
- Required deliverables uploaded
- **QA Review** approved by Dean (Quality Manager)
- **Technical Signoff** approved by Tanaka (Engineer)

### COO Override

The COO can override stage completion requirements if needed:
- A mandatory reason must be provided
- The override is logged to the audit trail
- This is an exceptional process, not standard workflow

### Lifecycle Board Integration

Engineering stages are auto-generated when projects move on the Company Lifecycle Board:
- First Assessment phase → "First Assessment" stage
- Cost Proposal phase → "Cost Proposal" stage
- Planning phase → "IFC Planning" stage
- Construction phase → "IFC Planning" + "Construction Support" stages
- QA/Handover phase → "Handover Pack" stage

### Related Processes
- [[Engineering Pack (EPM1)]]
- [[Hand Over (PM4)]]`,
  },
  {
    slug: "permission-access-control",
    title: "Permission & Access Control",
    category: "process",
    status: "published",
    responsibleRole: "COO",
    contentMarkdown: `## Permission & Access Control

The system uses role-based access control to manage what each user can see and do.

### Section-Level Access

Access is controlled across 7 main sections:
1. **COCKPIT** — Executive overview (EXCO tools, lifecycle board)
2. **PROJECTS** — Project management (execution board, summaries, PM dashboard)
3. **MONEY** — Financial tracking (cashflow, COS, procurement)
4. **DELIVERY** — Engineering (task board, engineering dashboard)
5. **GOVERNANCE** — Quality management
6. **INFORMATION** — Knowledge base and walkthroughs
7. **ADMIN** — System administration (roles, templates, audit)

### Entity Permissions

Within each section, permissions control specific actions:
- **View** — Can see the data
- **Edit** — Can modify data
- **Approve** — Can approve workflows (e.g., stage completion, QA review)
- **Override** — Can bypass gate rules (COO only)

### Key Roles

- **CEO_ADMIN** — Full access to all sections
- **COO_ADMIN** — Full access, can override stage gates
- **PROGRAM_MANAGER** — Projects, money, delivery access
- **PROJECT_MANAGER_SITE** — Limited to assigned projects, PM Dashboard
- **QUALITY_MANAGER** — Quality dashboard, QA approvals
- **ENGINEER** — Engineering tasks, stage checklist items
- **CFO** — Financial sections access

### Admin Management

Roles and permissions are managed at Admin > Roles & Permissions. Changes take effect immediately.`,
  },
  {
    slug: "emergent-dashboard-tool",
    title: "Emergent Dashboard",
    category: "tool",
    status: "published",
    contentMarkdown: `## Emergent Dashboard

The Emergent Dashboard is the primary project management and operational tool for Emergent Energy. It replaces multiple spreadsheets and standalone tools with a single integrated platform.

### Key Capabilities

- **Smart Import** — Upload Excel trackers to create/update project data
- **Financial Tracking** — COS realisation, cashflow management, revenue recognition
- **Engineering Management** — 5-stage checklist system, task board, engineering dashboard
- **Quality Management** — Multi-phase checklists, QA warnings, formal approvals
- **Lifecycle Management** — Company-wide project phase tracking with drag-and-drop board
- **Weekly Reviews** — Structured reporting for project managers
- **Subcontractor Management** — Supplier tracking and procurement oversight
- **Personal Productivity** — My Tool for individual task and priority management

### Data Sources

All project data enters through Smart Import from Excel tracker files. The system then computes COS status, cashflow status, and other derived metrics automatically based on the imported data and font colour rules.

### Related Tools
- [[Click Up]]
- [[SharePoint]]
- [[Excel Project Tracker]]`,
  },
];

const STUB_UPDATES: { slug: string; contentMarkdown: string; responsibleRole?: string; escalationRole?: string }[] = [
  {
    slug: "quality-manager",
    responsibleRole: "Quality Manager",
    contentMarkdown: `## Quality Manager

**Current Role Holder**: Dean

### Responsibilities

- Manages the Quality Dashboard across all projects
- Conducts multi-phase quality inspections
- Acknowledges, overrides, or resolves QA warnings with mandatory notes
- Provides **QA Review** approval for Engineering Handover Pack stage gate
- Ensures compliance with quality standards and safety requirements

### Key Tools
- Quality Dashboard (Governance section)
- Engineering Stage Approvals (Handover Pack QA Review)
- QC Checklists per project

### Related Roles
- [[Head of Engineering]]
- [[Construction Manager]]`,
  },
  {
    slug: "project-manager",
    responsibleRole: "Project Manager (Site)",
    contentMarkdown: `## Project Manager

**Typical Role Holders**: Eon, Shaun, JT, Lloyd, Justin

### Responsibilities

- Day-to-day management of assigned projects on site
- Completes Weekly Reviews (6-step wizard) for each managed project
- Tracks project schedule, costed amounts, risks, and quality
- Manages subcontractor activities on site
- Updates project status and phase progression

### Key Tools
- **PM Dashboard** — View-only overview of assigned projects
- **Weekly Review Wizard** — Structured weekly reporting
- **Project Detail** — Full project information and management
- **Engineering Tasks** — Can view and update engineering task status

### Access Level
- Limited to assigned projects only
- Cannot access admin functions, lifecycle board management, or financial override features

### Related Roles
- [[Program Manager]]
- [[Construction Manager]]`,
  },
  {
    slug: "project-engineer",
    responsibleRole: "Engineer",
    contentMarkdown: `## Project Engineer

### Responsibilities

- Executes engineering tasks assigned via the Engineering Task Board
- Works through Engineering Stage checklist items as task owner
- Uploads deliverables for engineering stages
- Provides **Technical Signoff** for Handover Pack (Tanaka)
- Creates engineering design documentation and reports

### Key Tools
- Engineering Task Board — View and manage assigned tasks
- Engineering Stages — Complete checklist items, upload deliverables
- Project Detail — Access project technical information

### Related Roles
- [[Head of Engineering]]
- [[Quality Manager]]`,
  },
  {
    slug: "head-of-engineering",
    responsibleRole: "Head of Engineering",
    escalationRole: "COO",
    contentMarkdown: `## Head of Engineering

### Responsibilities

- Oversees the Engineering Dashboard and team workload
- Manages engineering stage template configuration (via Admin)
- Reviews engineering task assignments and progress
- Ensures stage gate requirements are met before stage completion
- Coordinates with Quality Manager on Handover Pack approvals

### Key Tools
- **Engineering Dashboard** — Team workload overview, blockers, project health
- **Engineering Task Board** — Task assignment and tracking
- **Engineering Stage Templates** (Admin) — Configure the 5-stage checklist system
- **Lifecycle Board** — Monitor engineering stage auto-generation

### Related Roles
- [[Chief Operations Officer]]
- [[Quality Manager]]
- [[Project Engineer]]`,
  },
  {
    slug: "excel-project-tracker",
    contentMarkdown: `## Excel Project Tracker

The Excel Project Tracker is the source document for project data. Each project has its own tracker file that follows a standard format.

### Expected File Format

The tracker filename determines the project name:
- Format: \`<ProjectName>_Tracker.xlsx\`
- Example: \`Coega_Steels_Phase_2_Tracker.xlsx\` → "Coega Steels Phase 2"

### Key Sheets

1. **Expenditure Breakdown** — The main data sheet with two sections:
   - **Costed section** (left, columns 2-8): Costed quantities, rates, totals
   - **Actual section** (right, columns 13-26): Actual costs, invoices, payments, supplier info
2. **Plan** — Project schedule and milestones
3. **Revenue** — Revenue recognition and client billing

### Font Colour Significance

- **Black font** on invoice/payment dates = confirmed (paid/received)
- **Red font** = forecast (planned but not yet confirmed)
- These colours drive COS status and cashflow calculations in the dashboard

### Importing

Use the [[Smart Import Process]] to upload tracker files into the system. This is the sole method for project creation and data updates.

### Related Tools
- [[Smart Import Process]]
- [[Emergent Dashboard]]`,
  },
  {
    slug: "excel-templates",
    contentMarkdown: `## Excel Templates

### Expenditure Breakdown Template

The Expenditure Breakdown sheet is the most important sheet in the project tracker. It must follow this structure:

**Costed Section (Left Side)**
- Column headers: Description, Qty, Rate/Unit, Total, Costed COS
- Contains costed/quoted values

**Actual Section (Right Side)**  
- Column headers: Description, Supplier, PO Number, Invoice Number, Invoice Date, Payment Date, Actual COS, Revenue Recognition Amount
- Contains real transaction data

### Column Detection

The Smart Import system automatically detects both costed and actual section headers. If headers don't match expected patterns, the mapping step allows manual correction.

### Related Tools
- [[Excel Project Tracker]]
- [[Smart Import Process]]`,
  },
];

const ENGINEERING_NODE_UPDATES: { slug: string; appendContent: string }[] = [
  {
    slug: "engineering-pack-epm1",
    appendContent: `

### Engineering Stages System (New)

Engineering work is now tracked through a formal 5-stage checklist system:
1. **First Assessment** — Initial project evaluation
2. **Cost Proposal** — Detailed costing and proposal preparation  
3. **IFC Planning** — Issued For Construction planning
4. **Construction Support** — On-site engineering support
5. **Handover Pack** — Final documentation and formal sign-off

Each stage has defined tasks, required deliverables, RACI roles, and stage gate rules. Stages can be auto-generated from the [[Engineering Stage Gating|Lifecycle Board]] when projects move phases.

See [[Engineering Stage Gating]] for gate rules and approval requirements.`,
  },
];

export async function seedEeInfoUpdates() {
  try {
    for (const node of NEW_NODES) {
      const existing = await db.select().from(eeInfoNodes).where(eq(eeInfoNodes.slug, node.slug));
      if (existing.length > 0) {
        continue;
      }
      await db.insert(eeInfoNodes).values({
        id: randomUUID(),
        slug: node.slug,
        title: node.title,
        category: node.category,
        contentMarkdown: node.contentMarkdown,
        status: node.status,
        responsibleRole: node.responsibleRole || null,
        escalationRole: node.escalationRole || null,
        flowEnabled: false,
        tags: [],
        nextSlugs: [],
        prevSlugs: [],
        gateConditions: [],
        blockingConditions: [],
      });
      console.log(`[EE-Info-Update] Created node: ${node.title}`);
    }

    for (const update of STUB_UPDATES) {
      const existing = await db.select().from(eeInfoNodes).where(eq(eeInfoNodes.slug, update.slug));
      if (existing.length === 0) continue;
      const node = existing[0];
      if (node.status !== "stub" && node.contentMarkdown && node.contentMarkdown.length > 50) {
        continue;
      }
      await db.update(eeInfoNodes)
        .set({
          contentMarkdown: update.contentMarkdown,
          status: "published",
          responsibleRole: update.responsibleRole || node.responsibleRole,
          escalationRole: update.escalationRole || node.escalationRole,
        })
        .where(eq(eeInfoNodes.slug, update.slug));
      console.log(`[EE-Info-Update] Updated stub: ${node.title}`);
    }

    for (const eng of ENGINEERING_NODE_UPDATES) {
      const existing = await db.select().from(eeInfoNodes).where(eq(eeInfoNodes.slug, eng.slug));
      if (existing.length === 0) continue;
      const node = existing[0];
      if (node.contentMarkdown && node.contentMarkdown.includes("Engineering Stages System")) {
        continue;
      }
      await db.update(eeInfoNodes)
        .set({
          contentMarkdown: (node.contentMarkdown || "") + eng.appendContent,
        })
        .where(eq(eeInfoNodes.slug, eng.slug));
      console.log(`[EE-Info-Update] Appended to: ${node.title}`);
    }

    console.log("[EE-Info-Update] Seed updates complete.");
  } catch (err) {
    console.error("[EE-Info-Update] Error:", err);
  }
}
