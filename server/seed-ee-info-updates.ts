import { db } from "./db";
import { eeInfoNodes, eeInfoNodeDetails, eeInfoNodeMetrics } from "@shared/schema";
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

const SOP_ENRICHMENTS: { slug: string; marker: string; contentMarkdown: string; responsibleRole?: string; escalationRole?: string; category?: string }[] = [
  {
    slug: "first-assessment-request-epd1",
    marker: "SOP-FA-v1",
    responsibleRole: "Head of Project Development",
    escalationRole: "COO",
    category: "process",
    contentMarkdown: `## First Assessment Request (EPD1)

### Purpose
Provide a high-level technical and financial feasibility analysis for a prospective project so that the [[Head of Project Development]] can decide whether to proceed to [[Cost Proposal Request - EPD2|Cost Proposal]].

### Definition of Ready (DoR)
- Site visit report uploaded to [[SharePoint]]
- Client brief / RFI received and filed
- [[Hand over charter]] completed by [[Project Developer]]
- Geo-coordinates and aerial imagery available

### Definition of Done (DoD)
- FA Template fully populated (yield, layout, high-level costed estimate)
- [[PVSOL]] simulation file saved to project folder
- Pre-engineering board ticket marked complete
- [[Project Developer]] notified via [[MS Teams]] announcement

### RACI

| Activity | R | A | C | I |
|---|---|---|---|---|
| Load FA request on pre-engineering board | [[Project Developer]] | [[Head of Project Development]] | — | [[Quality Manager]] |
| Set priority | [[Head of Project Development]] | [[Head of Project Development]] | [[Chief Operations Officer]] | [[Project Developer]] |
| Assign to engineer | [[Quality Manager]] | [[Quality Manager]] | — | [[Design Engineer]] |
| Execute FA (PVSOL, layout, yield) | [[Design Engineer]] | [[Quality Manager]] | [[Project Developer]] | — |
| Review & approve FA output | [[Quality Manager]] | [[Head of Project Development]] | — | [[Project Developer]] |
| Close ticket & notify PD | [[Design Engineer]] | [[Quality Manager]] | — | [[Project Developer]] |

### Process Steps
1. [[Project Developer]] loads a First Assessment request on the pre-engineering board (located on [[MS Teams]] > Engineering Support > Pre Engineering section), assigning to [[Quality Manager]].
2. [[Head of Project Development]] sets priority via the board priority field and gives final approval.
3. [[Quality Manager]] assigns to a [[Design Engineer]] during the daily stand-up and posts progress updates under Announcements in the Engineering Support team on [[MS Teams]].
4. [[Design Engineer]] executes the FA:
   - Run [[PVSOL]] simulation (module layout + yield estimate)
   - Populate the FA Template with high-level costed figures
   - Upload deliverables to the project [[SharePoint]] folder
5. [[Quality Manager]] reviews the output; if needed, requests revisions.
6. Once approved, [[Design Engineer]] ensures the [[Project Developer]] has the completed FA Template and marks the board ticket complete.

### Quality Gates
| Gate | Check | Owner |
|---|---|---|
| QG-1 | Site data pack complete (coordinates, aerial, client brief) | [[Project Developer]] |
| QG-2 | PVSOL simulation reviewed for accuracy | [[Quality Manager]] |
| QG-3 | FA Template all fields populated | [[Design Engineer]] |

### SLAs & KPIs
- **Turnaround**: 5 business days from assignment to completion
- **KPI**: % of FAs completed within SLA target (tracked on dashboard)

### Artefacts
- FA Template (Excel)
- [[PVSOL]] simulation file (.pvprj)
- Site visit report
- Aerial / satellite imagery

### Tools
- [[MS Teams]]
- [[MS Outlook]]
- [[Excel Templates]]
- [[SharePoint]]
- [[PVSOL]]

### Related Processes
- [[Cost Proposal Request - EPD2]]
- [[Final Offer Submission (PD5)]]
- [[Engineering Stage Gating]]`,
  },
  {
    slug: "cost-proposal-request-epd2",
    marker: "SOP-CP-v1",
    responsibleRole: "Head of Project Development",
    escalationRole: "COO",
    category: "process",
    contentMarkdown: `## Cost Proposal Request (EPD2)

### Purpose
Produce a detailed, client-ready cost proposal that covers system design, bill of materials, installation cost, and project timeline, enabling the [[Head of Project Development]] to submit a formal offer.

### Definition of Ready (DoR)
- First Assessment approved and filed ([[First Assessment Request - EPD1]])
- Client scope confirmed (kWp target, roof/ground, storage requirements)
- Up-to-date utility tariff schedule available

### Definition of Done (DoD)
- Cost Proposal Template fully populated (BOM, labour, margin, timeline)
- [[PVSOL]] design finalised with string layout
- SLD (Single Line Diagram) completed
- RQR (Resource & Quantity Register) reviewed
- Costing sheet approved by [[Head of Project Development]]
- Ticket closed on pre-engineering board; [[Project Developer]] notified

### RACI

| Activity | R | A | C | I |
|---|---|---|---|---|
| Load CP request on pre-engineering board | [[Project Developer]] | [[Head of Project Development]] | — | [[Quality Manager]] |
| Assign to engineer | [[Quality Manager]] | [[Quality Manager]] | [[Chief Operations Officer]] | [[Design Engineer]] |
| PVSOL finalisation & string layout | [[Design Engineer]] | [[Quality Manager]] | — | [[Project Developer]] |
| SLD completion | [[Design Engineer]] | [[Quality Manager]] | — | — |
| BOM & costing sheet | [[Design Engineer]] | [[Head of Project Development]] | [[Procurement Manager]] | — |
| RQR review | [[Quality Manager]] | [[Quality Manager]] | [[Design Engineer]] | — |
| Final approval | [[Head of Project Development]] | [[Head of Project Development]] | [[Chief Operations Officer]] | [[Project Developer]] |

### Process Steps
1. [[Project Developer]] loads a Cost Proposal request on the pre-engineering board ([[MS Teams]] > Engineering Support > Pre Engineering), assigning to [[Quality Manager]].
2. [[Head of Project Development]] sets priority; [[Chief Operations Officer]] confirms capacity in the daily stand-up.
3. [[Quality Manager]] assigns the request to a [[Design Engineer]] and tracks progress via [[MS Teams]] Announcements.
4. [[Design Engineer]] executes the cost proposal:
   - Finalise [[PVSOL]] design with string layout
   - Complete SLD (Single Line Diagram)
   - Compile BOM (Bill of Materials) with current pricing
   - Populate the Cost Proposal Template (costing sheet)
   - Compile RQR (Resource & Quantity Register)
5. [[Quality Manager]] reviews RQR and engineering deliverables.
6. [[Head of Project Development]] reviews and approves the final costing sheet.
7. [[Quality Manager]] ensures the [[Project Developer]] has the completed CP Template; ticket is marked complete.

### Standard Messages
- **Assignment notification**: Posted in MS Teams Engineering Support announcements
- **Completion notification**: Direct message to [[Project Developer]] with link to [[SharePoint]] folder

### ClickUp Mapping
When a project reaches Cost Proposal phase on the [[Engineering Stage Gating|Lifecycle Board]], the system auto-generates a "Cost Proposal" engineering stage with predefined tasks matching this SOP.

### Quality Gates
| Gate | Check | Owner |
|---|---|---|
| QG-1 | FA complete & approved before CP starts | [[Quality Manager]] |
| QG-2 | PVSOL design reviewed (string layout, yield) | [[Quality Manager]] |
| QG-3 | SLD technically compliant | [[Design Engineer]] |
| QG-4 | Costing sheet margin check (≥ target GP%) | [[Head of Project Development]] |
| QG-5 | RQR quantities reconciled with BOM | [[Quality Manager]] |

### Artefacts
- Cost Proposal Template (Excel)
- [[PVSOL]] finalised design file
- SLD (AutoCAD / PDF)
- BOM (Bill of Materials)
- RQR (Resource & Quantity Register)

### Tools
- [[MS Teams]]
- [[MS Outlook]]
- [[Excel Templates]]
- [[SharePoint]]
- [[PVSOL]]
- [[Autocad]]

### Related Processes
- [[First Assessment Request - EPD1]]
- [[Cost Proposal Review (EPD2)]]
- [[Final Offer Submission (PD5)]]
- [[Engineering Stage Gating]]`,
  },
  {
    slug: "cost-proposal-review-epd2",
    marker: "SOP-CPR-v1",
    responsibleRole: "Head of Engineering",
    escalationRole: "Head of Project Development",
    category: "process",
    contentMarkdown: `## Cost Proposal Review (EPD2)

### Purpose
Provide a structured peer-review and sign-off process for cost proposals before they are submitted to the client, ensuring technical accuracy and commercial viability.

### Review Process
1. [[Design Engineer]] submits the completed cost proposal package to the Engineering Support > Cost Proposal Reviews channel on [[MS Teams]].
2. [[Head of Engineering]] assigns a peer reviewer (a different engineer from the one who prepared the CP).
3. Peer reviewer checks:
   - PVSOL design accuracy (yield, layout, string sizing)
   - SLD compliance with NRS 097 and client specifications
   - BOM completeness and pricing currency
   - Costing sheet arithmetic and margin targets
   - RQR quantities match BOM line items
4. Reviewer posts findings in the Cost Proposal Reviews channel with pass/fail status.
5. If **fail**: [[Design Engineer]] addresses findings and resubmits for review.
6. If **pass**: [[Head of Engineering]] and [[Head of Project Development]] provide final sign-off.
7. Signed-off CP package is filed in [[SharePoint]] and the [[Project Developer]] is notified.

### RACI

| Activity | R | A | C | I |
|---|---|---|---|---|
| Submit CP for review | [[Design Engineer]] | [[Quality Manager]] | — | [[Head of Engineering]] |
| Assign peer reviewer | [[Head of Engineering]] | [[Head of Engineering]] | — | [[Design Engineer]] |
| Conduct peer review | Peer Reviewer | [[Head of Engineering]] | [[Design Engineer]] | — |
| Approve / reject | [[Head of Engineering]] | [[Head of Project Development]] | — | [[Project Developer]] |
| Final sign-off | [[Head of Project Development]] | [[Head of Project Development]] | [[Chief Operations Officer]] | — |

### Quality Gates
| Gate | Check | Owner |
|---|---|---|
| QG-1 | Peer review completed with documented findings | [[Head of Engineering]] |
| QG-2 | All review findings resolved | [[Design Engineer]] |
| QG-3 | Dual sign-off (Engineering + PD) recorded | [[Head of Project Development]] |

### Tools
- [[MS Teams]] (Engineering Support > Cost Proposal Reviews)
- [[Cost Proposal Template]]
- [[SharePoint]]

### Related Processes
- [[Cost Proposal Request - EPD2]]
- [[Final Offer Submission (PD5)]]`,
  },
  {
    slug: "engineering-pack-epm1",
    marker: "SOP-EP-v1",
    responsibleRole: "Head of Engineering",
    escalationRole: "COO",
    category: "process",
    contentMarkdown: `## Engineering Pack (EPM1)

### Purpose
Deliver a complete, construction-ready engineering documentation package through a structured 4-gate design process, ensuring all drawings, calculations, and specifications are reviewed and approved before Issued For Construction (IFC).

### Engineering Triage
At the [[Client Hand Over (PDPM2)]] meeting, the project is classified into one of two triage levels:

**Green Triage** (standard complexity):
- Standard rooftop or ground-mount within known parameters
- Engineering pack follows the standard template

**Red Triage** (high complexity):
- Client requirements outside regular process
- Complex structural, electrical, or regulatory conditions
- Requires in-depth site visit and additional engineering sections

### 4-Gate Design Process

#### Gate 1 — 30% Design
- Preliminary module layout (PVSOL)
- Site development plan (high-level)
- Initial SLD concept
- **Review**: [[Quality Manager]] confirms design intent aligns with client brief

#### Gate 2 — 60% Design
- Detailed module layout with string configuration
- PVSOL simulation finalised
- SLD drafted (not yet for construction)
- Preliminary cable schedule
- **Review**: [[Head of Engineering]] + [[Quality Manager]] joint review

#### Gate 3 — 90% Design
- All drawings at near-final quality
- Calculation pack complete (structural, electrical, yield)
- Equipment datasheets compiled
- Interface documents (grid connection, structural, fire)
- **Review**: Peer review by independent engineer; findings documented

#### Gate 4 — IFC (Issued For Construction)
- All review findings resolved
- Drawing set stamped "IFC" with revision number
- Final sign-off by [[Head of Engineering]] and [[Chief Operations Officer]]

### IFC Drawing Set Contents
1. Site Development Plan
2. Module Layout (roof plan / ground layout)
3. String Layout with string numbering
4. Single Line Diagram (SLD)
5. AC & DC Cable Schedule
6. Earthing Layout
7. Lightning Protection Layout (if applicable)
8. Mounting Structure Details
9. Trench / Cable Route Layout
10. Signage & Labelling Plan

### Calculations & Reports
- PVSOL Yield Report
- Structural assessment (wind/snow loading)
- Cable sizing calculations
- Protection coordination study
- Grid impact assessment (if required by utility)

### Interfaces
- **Grid connection**: Utility application and approval documents
- **Structural**: Roof/ground structural certification
- **Fire**: Fire compliance assessment (if applicable)
- **Client**: Client-specific requirements register

### Document Control
- All engineering documents stored in [[SharePoint]] under the project folder
- Drawing revision history tracked (Rev 0 → Rev A → Rev B → IFC)
- IFC package uploaded to both [[SharePoint]] and [[Click Up]] project

### Process Steps (Green Triage)
1. [[Client Hand Over (PDPM2)]] meeting confirms Green triage and assigns [[Project Engineer]] + [[Project Manager]].
2. [[Project Engineer]] creates the project template on [[Click Up]] and loads the Green Triage EP request on the Engineering board.
3. [[Project Engineer]] compiles the EP:
   - Site Development Plan
   - PVSOL Module Layout
   - String Layout
   - SLD
4. Output sent to Tanaka for technical review; [[Quality Manager]] does additional review if needed.
5. [[Project Engineer]] uploads the EP to the applicable [[SharePoint]] folder.
6. [[Chief Operations Officer]] moves the ticket to complete and closes with a comment confirming upload.

### Process Steps (Red Triage)
1. [[Project Engineer]] conducts an in-depth site visit to identify and document complex requirements.
2. [[Project Engineer]] builds a custom EP template on the Engineering board with additional sections addressing the red-flag items.
3. Engineering pack compiled with extended scope (additional calculations, specialist drawings).
4. Technical review by Tanaka + [[Quality Manager]].
5. Upload to [[SharePoint]]; ticket closed with completion comment.

### RACI

| Activity | R | A | C | I |
|---|---|---|---|---|
| Triage classification | [[Chief Operations Officer]] | [[Chief Operations Officer]] | [[Head of Engineering]], [[Quality Manager]] | [[Project Manager]] |
| Assign project engineer | [[Head of Engineering]] | [[Chief Operations Officer]] | — | [[Project Engineer]] |
| 30% design | [[Project Engineer]] | [[Head of Engineering]] | — | [[Quality Manager]] |
| 60% design review | [[Quality Manager]] | [[Head of Engineering]] | [[Project Engineer]] | — |
| 90% peer review | Peer Reviewer | [[Head of Engineering]] | [[Project Engineer]] | [[Quality Manager]] |
| IFC sign-off | [[Head of Engineering]] | [[Chief Operations Officer]] | [[Quality Manager]] | [[Project Manager]] |
| Upload to SharePoint | [[Project Engineer]] | [[Head of Engineering]] | — | [[Chief Operations Officer]] |

### Quality Gates
| Gate | Check | Owner |
|---|---|---|
| QG-1 (30%) | Design intent matches client brief | [[Quality Manager]] |
| QG-2 (60%) | Layout + SLD technically sound | [[Head of Engineering]] |
| QG-3 (90%) | Peer review findings documented & resolved | [[Head of Engineering]] |
| QG-4 (IFC) | All drawings stamped, calcs complete, sign-off recorded | [[Chief Operations Officer]] |

### Tools
- [[Click Up]]
- [[MS Outlook]]
- [[MS Teams]]
- [[PVSOL]]
- [[Autocad]]
- [[Revert]]
- [[SharePoint]]

### Related Processes
- [[Client Hand Over (PDPM2)]]
- [[Engineering Stage Gating]]
- [[Commissioning (EPM2)]]
- [[Construction QA]]`,
  },
  {
    slug: "commissioning-epm2",
    marker: "SOP-COMM-v1",
    responsibleRole: "Compliance Officer",
    escalationRole: "COO",
    category: "process",
    contentMarkdown: `## Commissioning (EPM2)

### Purpose
Ensure every completed solar installation undergoes a structured commissioning and testing process before handover to the client, verifying that the system performs safely and to specification.

### Definition of Ready (DoR)
- Construction substantially complete (all modules mounted, cabling done, inverters installed)
- Snag list from construction walkthrough completed and critical items resolved
- All IFC drawings available on site
- Grid connection approval obtained (if applicable)

### Definition of Done (DoD)
- Simulation Test passed (system producing expected yield)
- All commissioning checklists signed off
- Snag list fully resolved (zero critical, zero major open items)
- COC (Certificate of Compliance) issued
- Commissioning report uploaded to [[SharePoint]]
- [[Click Up]] task marked complete

### Commissioning Procedure

#### Phase 1 — Pre-Commissioning Checks
1. Visual inspection of all installed equipment against IFC drawings
2. Torque checks on all electrical connections
3. Earth continuity and insulation resistance testing
4. String open-circuit voltage (Voc) and short-circuit current (Isc) measurements
5. Inverter pre-commissioning checklist per manufacturer specs

#### Phase 2 — Simulation Test
1. System energised under controlled conditions
2. CT (Compliance Officer) monitors real-time output vs PVSOL predicted yield
3. Each string verified individually against expected performance
4. Any string performing < 95% of expected output is flagged for investigation
5. Test results documented in commissioning report

#### Phase 3 — Snag List Management
Snags are classified into three severity levels:

| Severity | Definition | Resolution SLA |
|---|---|---|
| **Critical** | Safety hazard or system cannot operate | Must resolve before energisation |
| **Major** | Performance impact or code non-compliance | Resolve within 5 business days |
| **Minor** | Cosmetic or documentation gap | Resolve within 10 business days |

- Snag list maintained in [[Click Up]] as sub-tasks under the commissioning ticket
- Each snag assigned to responsible party with due date
- [[Project Manager]] tracks resolution daily; [[Compliance Officer]] verifies closure

#### Phase 4 — Acceptance & Handover
1. All critical and major snags resolved
2. [[Compliance Officer]] issues COC (Certificate of Compliance)
3. Final commissioning report compiled and signed
4. Client acceptance meeting scheduled
5. Documentation package handed to client:
   - COC
   - As-built drawings
   - O&M manual
   - Warranty certificates
   - Commissioning test results

### RACI

| Activity | R | A | C | I |
|---|---|---|---|---|
| Schedule commissioning | [[Compliance Officer]] | [[Project Manager]] | [[Chief Operations Officer]] | — |
| Pre-commissioning checks | [[Compliance Officer]] | [[Compliance Officer]] | [[Project Engineer]] | [[Project Manager]] |
| Simulation test | [[Compliance Officer]] | [[Compliance Officer]] | [[Design Engineer]] | [[Project Manager]] |
| Snag list management | [[Project Manager]] | [[Project Manager]] | [[Compliance Officer]] | [[Chief Operations Officer]] |
| COC issuance | [[Compliance Officer]] | [[Compliance Officer]] | — | [[Project Manager]], Client |
| Client acceptance | [[Project Manager]] | [[Program Manager]] | [[Compliance Officer]] | [[Chief Operations Officer]] |

### Process Steps
1. When a project is created on [[Click Up]], a Commissioning ticket is auto-created and assigned to the [[Project Manager]].
2. Once construction is substantially complete, [[Project Manager]] assigns the ticket to the [[Compliance Officer]] and captures the start date.
3. [[Compliance Officer]] receives notification and schedules:
   - In-house commissioning date (posted on [[MS Teams]] > Engineering Support)
   - MAM (external authority) commissioning date if required — sends MAM template mail
4. [[Compliance Officer]] updates [[Click Up]] task with the scheduled Due Date.
5. [[Compliance Officer]] executes the commissioning procedure (Phases 1-4).
6. Once Due Date is captured, [[Compliance Officer]] assigns the task back to [[Project Manager]] to drive to completion.

### Quality Gates
| Gate | Check | Owner |
|---|---|---|
| QG-1 | Pre-commissioning checklist 100% complete | [[Compliance Officer]] |
| QG-2 | Simulation test — all strings within 95% of expected | [[Compliance Officer]] |
| QG-3 | Zero critical snags, zero major snags open | [[Project Manager]] |
| QG-4 | COC issued and filed | [[Compliance Officer]] |

### Tools
- [[Click Up]]
- [[MS Outlook]]
- [[MS Teams]]
- [[SharePoint]]

### Related Processes
- [[Construction (PM3)]]
- [[Engineering Pack (EPM1)]]
- [[Construction QA]]
- [[Hand Over (PM4)]]`,
  },
  {
    slug: "project-initiation-setup-pdpm1",
    marker: "SOP-PDPM-v1",
    responsibleRole: "Program Manager",
    escalationRole: "COO",
    category: "process",
    contentMarkdown: `## Project Initiation & Setup (PDPM1)

### Purpose
Formally transition a won deal from Project Development to Project Management through a structured handover meeting, ensuring the PM team has all information needed to plan and execute the project.

### Definition of Ready (DoR)
- Deal confirmed won (client PO or signed contract received)
- [[Hand over charter]] completed by [[Project Developer]]
- [[Site visit report]] uploaded to [[SharePoint]]
- Cost Proposal approved and filed ([[Cost Proposal Request - EPD2]])
- Meeting request sent with minimum 3 business days lead time

### Definition of Done (DoD)
- Handover meeting held with all required attendees
- [[Project Manager]] assigned and confirmed
- Engineering triage classification completed
- [[Click Up]] project structure created
- Compliance starter pack initiated
- Post-meeting outputs distributed to all stakeholders

### Meeting Agenda
1. **Project Overview** — [[Project Developer]] presents the client, site, scope, and contract terms
2. **Technical Brief** — Review FA/CP outputs, engineering classification, site-specific challenges
3. **Commercial Terms** — Contract value, payment milestones, penalties/LDs, warranty terms
4. **Risk Register** — Known risks from PD phase, client-specific risks, site access constraints
5. **PM Assignment** — [[Chief Operations Officer]], [[Program Manager]], and [[Construction Manager]] align on [[Project Manager]] assignment
6. **Engineering Classification** — [[Program Manager]] and [[Head of Engineering]] determine triage level (Green/Red)
7. **Timeline** — Target start date, key milestones, client deadlines
8. **Procurement** — Long-lead items, preferred suppliers, client-nominated subcontractors
9. **Compliance** — Regulatory requirements, permits, HSE considerations
10. **Actions** — Clear next steps with owners and due dates

### RACI

| Activity | R | A | C | I |
|---|---|---|---|---|
| Send handover meeting request | [[Project Developer]] | [[Head of Project Development]] | — | PM team |
| Prepare [[Hand over charter]] | [[Project Developer]] | [[Head of Project Development]] | — | — |
| Attend & present project | [[Project Developer]] | [[Project Developer]] | — | All attendees |
| Assign [[Project Manager]] | [[Chief Operations Officer]] | [[Chief Operations Officer]] | [[Program Manager]], [[Construction Manager]] | [[Project Developer]] |
| Engineering classification | [[Program Manager]] | [[Program Manager]] | [[Head of Engineering]] | [[Project Manager]] |
| Create [[Click Up]] project | [[Program Manager]] | [[Program Manager]] | — | [[Project Manager]] |
| Initiate compliance starter pack | [[Compliance Officer]] | [[Compliance Officer]] | [[HSE Officer]] | [[Project Manager]] |
| Distribute meeting outputs | [[Program Manager]] | [[Program Manager]] | — | All stakeholders |

### Required Attendees (10 Roles)
1. [[Project Developer]] — Presents the project
2. [[Head of Project Development]] — PD oversight
3. [[Chief Operations Officer]] — PM assignment authority
4. [[Program Manager]] — Programme planning & [[Click Up]] setup
5. [[Construction Manager]] — Construction feasibility input
6. [[Procurement Manager]] — Long-lead item identification
7. [[Quality Manager]] — Quality requirements
8. [[Head of Finance]] — Payment milestones & invoicing setup
9. [[Compliance Officer]] — Regulatory & HSE requirements
10. [[HSE Officer]] — Safety file requirements

### Post-Meeting Outputs
1. **Signed Hand Over Charter** — Filed in [[SharePoint]] project folder
2. **[[Click Up]] Project Structure**:
   - Project board created with standard template
   - PM assigned as project lead
   - Engineering ticket created (FA/CP/EP as applicable)
   - Commissioning ticket created
   - Procurement tasks created for long-lead items
3. **Compliance Starter Pack**:
   - HSE file initiated
   - Permit register created
   - Regulatory checklist populated
4. **Meeting Minutes** — Distributed via [[MS Outlook]] within 24 hours
5. **Risk Register** — Initial entries from handover discussion loaded into system

### Process Steps
1. [[Project Developer]] sends a [[Client Hand Over (PDPM2)]] meeting request to the PM team with [[Hand over charter]] and [[Site visit report]] attached (minimum 3 days lead time).
2. PM team reviews documents for preliminary planning.
3. [[Chief Operations Officer]], [[Program Manager]], and [[Construction Manager]] align on [[Project Manager]] assignment.
4. [[Program Manager]] and [[Head of Engineering]] determine engineering classification.
5. [[Program Manager]] forwards the meeting request to the assigned [[Project Manager]].
6. Handover meeting is held following the 10-point agenda.
7. Post-meeting: [[Program Manager]] creates the [[Click Up]] project structure and distributes outputs.
8. [[Compliance Officer]] initiates the compliance starter pack.

### Quality Gates
| Gate | Check | Owner |
|---|---|---|
| QG-1 | Hand Over Charter complete and signed | [[Head of Project Development]] |
| QG-2 | All 10 required roles attended or delegated | [[Program Manager]] |
| QG-3 | [[Click Up]] project structure created within 2 business days | [[Program Manager]] |
| QG-4 | Compliance starter pack initiated within 3 business days | [[Compliance Officer]] |

### Tools
- [[MS Outlook]]
- [[MS Teams]]
- [[Hand over charter]]
- [[Site visit report]]
- [[Click Up]]
- [[SharePoint]]

### Related Processes
- [[Final Offer Submission (PD5)]]
- [[Client Hand Over (PDPM2)]]
- [[Engineering Pack (EPM1)]]
- [[Construction (PM3)]]`,
  },
  {
    slug: "cos-tracking",
    marker: "SOP-COS-v1",
    category: "governance",
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

### COS Recognition Criteria

A cost line is recognised (moves from Planned to COS Realised) when ALL of the following are true:
1. Invoice Number field is populated (non-empty)
2. Invoice Date field is populated
3. Invoice Date font colour is **black** (confirmed)

If any condition is missing, the line remains in a non-realised state (Deferred, Flagged, or Planned).

### COS Triggers by Category

| Category | Typical Trigger | Notes |
|---|---|---|
| **Materials** | Supplier invoice received + goods delivered | PO must exist; delivery note matched |
| **Labour (Subcontractor)** | Milestone claim approved + invoice received | Payment cert signed by PM |
| **Labour (Internal)** | Timesheet approved + cost allocated | Monthly payroll allocation |
| **Plant & Equipment** | Rental invoice + usage confirmed | Delivery/collection notes required |
| **Professional Fees** | Fee note received + work accepted | Scope completion verified |
| **Travel & Accommodation** | Expense claim approved | Receipt attached |
| **Permits & Fees** | Payment confirmation from authority | Municipal receipt or proof |
| **Contingency** | Contingency drawn down + approved | Requires PM + Program Manager approval |

### Responsibility Matrix

| Role | COS Responsibility |
|---|---|
| [[Project Manager]] | Ensures invoices are collected and submitted on time |
| [[Head of Finance]] | Verifies invoice validity, captures in system |
| [[Program Manager]] | Monitors COS realisation % across portfolio |
| [[Chief Operations Officer]] | Reviews COS dashboard, escalates delays |
| [[Procurement Manager]] | Tracks PO-to-invoice matching for materials |

### COS Lock-In Protocol
Once a cost line reaches **COS Realised** status:
- The status is **locked** — it cannot revert to a lower status via re-import
- Font colour overrides persist across Smart Import re-runs
- Only a manual override (with documented reason) can change the status
- This prevents accidental data loss from Excel re-imports

### Common Errors & How to Avoid Them

| Error | Cause | Prevention |
|---|---|---|
| Line stuck on "Planned" | Invoice number missing from Excel | Ensure all paid items have invoice numbers entered |
| Line shows "Deferred" instead of "Realised" | Font colour is red (forecast) not black (confirmed) | Change font to black once payment is confirmed |
| Line shows "Flagged" | Invoice date confirmed (black) but no invoice number | Enter the invoice number in the Excel tracker |
| COS % drops after re-import | New lines added to Excel without invoice data | Add invoice data before re-importing |
| Duplicate lines inflating COS | Same invoice entered on multiple lines | Use unique description + invoice number combinations |

### COS Flagged Override

Users can override the Flagged status by clicking the badge in the COS Tracker. An override dialog lets you provide a new status and reason. Overrides are stored in the database and persist across re-imports. The override reason is shown on hover.

### Where to See COS Data

- **Company-wide**: Money > COS Tracker (monthly grid with drill-down)
- **Project-level**: Project Detail > Money > COS Tracker sub-tab (grouped by expense category)

### Related Processes
- [[Cashflow Management]]
- [[Revenue Recognition]]
- [[Payment Requests (PMA2)]]
- [[Smart Import Process]]`,
  },
];

const NEW_SOP_NODES: NodeUpdate[] = [
  {
    slug: "sop-construction-qa",
    title: "Construction QA",
    category: "governance",
    status: "published",
    responsibleRole: "Quality Manager",
    escalationRole: "COO",
    contentMarkdown: `## Construction QA

### Purpose
Ensure every solar installation meets Emergent Energy's quality and safety standards through a structured 3-gate inspection procedure conducted at defined construction milestones.

### Scope
This procedure applies to all projects from construction start through to commissioning readiness. It covers structural, electrical, and safety inspections at three defined gates.

### QA Gate Overview

| Gate | Milestone | Focus Area | Inspector |
|---|---|---|---|
| **QA Gate 1** | Mounting structure complete | Structural integrity, roof penetrations, waterproofing | [[Quality Manager]] or delegate |
| **QA Gate 2** | DC installation complete | Module installation, string wiring, DC cabling | [[Quality Manager]] or delegate |
| **QA Gate 3** | AC installation & pre-commissioning | AC wiring, protection devices, earthing, labelling | [[Quality Manager]] + [[Compliance Officer]] |

### QA Gate 1 — Structural & Mounting

**When**: After mounting structure installation, before module placement

**Checklist Items**:
1. Mounting rails aligned and level (within tolerance)
2. Roof penetrations sealed and waterproofed
3. Structural fixings torqued to specification
4. Rail spacing matches module dimensions
5. Flashing and weatherproofing verified
6. Roof membrane integrity confirmed (for flat roofs)
7. Ground screws / foundations verified (for ground mount)
8. Photo evidence uploaded to [[SharePoint]]

**Pass Criteria**: All items checked and signed off; no critical findings

### QA Gate 2 — DC Installation

**When**: After all modules mounted and DC wiring complete, before AC connection

**Checklist Items**:
1. Modules correctly oriented and secured
2. Module serial numbers recorded
3. String wiring correct per string layout drawing
4. DC cable sizing matches design specification
5. Cable management (clips, trays, conduit) tidy and compliant
6. String Voc measurements within expected range (±5% of nameplate)
7. String Isc measurements within expected range
8. DC isolator installed and accessible
9. Polarity checks completed — no reverse polarity
10. Earth continuity of module frames verified
11. Photo evidence uploaded to [[SharePoint]]

**Pass Criteria**: All electrical measurements within tolerance; no safety findings

### QA Gate 3 — AC Installation & Pre-Commissioning

**When**: After AC installation complete, before system energisation

**Checklist Items**:
1. AC cable sizing matches SLD specification
2. Protection devices (MCBs, RCDs, surge protection) installed per design
3. Earthing system complete and tested
4. Earth fault loop impedance within limits
5. Insulation resistance test passed (DC and AC sides)
6. Inverter mounting secure, ventilation adequate
7. AC isolator and main switch installed and labelled
8. All labels and signage in place per regulations
9. Lightning protection connected (if applicable)
10. Meter / CT installation correct (for export limiting)
11. Pre-commissioning checklist completed
12. Photo evidence uploaded to [[SharePoint]]

**Pass Criteria**: All tests passed; system ready for commissioning

### Inspection Process
1. [[Project Manager]] notifies [[Quality Manager]] that a gate milestone has been reached.
2. [[Quality Manager]] (or delegated inspector) schedules site visit within 2 business days.
3. Inspector conducts the gate-specific checklist on site.
4. Findings recorded in the Quality Dashboard:
   - **Pass** — All items satisfactory; gate approved
   - **Conditional Pass** — Minor items to resolve; gate approved with conditions (tracked as action items)
   - **Fail** — Critical or major findings; gate not approved; rework required
5. Failed gates require rework by the contractor followed by re-inspection.
6. All gate approvals recorded in the system with inspector signature and timestamp.

### RACI

| Activity | R | A | C | I |
|---|---|---|---|---|
| Notify gate readiness | [[Project Manager]] | [[Project Manager]] | [[Construction Manager]] | [[Quality Manager]] |
| Schedule inspection | [[Quality Manager]] | [[Quality Manager]] | — | [[Project Manager]] |
| Conduct inspection | [[Quality Manager]] | [[Quality Manager]] | [[Compliance Officer]] (Gate 3) | — |
| Record findings | [[Quality Manager]] | [[Quality Manager]] | — | [[Project Manager]], [[Chief Operations Officer]] |
| Manage rework | [[Project Manager]] | [[Construction Manager]] | [[Quality Manager]] | — |
| Approve gate | [[Quality Manager]] | [[Quality Manager]] | — | [[Chief Operations Officer]] |

### Escalation
- Failed Gate 3: Escalate to [[Chief Operations Officer]] — system cannot be energised until resolved
- Repeated gate failures (same item fails twice): Escalate to [[Construction Manager]] for contractor performance review
- Safety findings at any gate: Immediate stop-work; escalate to [[HSE Officer]]

### Documentation
- QA inspection reports filed in [[SharePoint]] > Project > Quality
- Photo evidence required for every gate (minimum 10 photos per gate)
- All findings tracked in the Quality Dashboard with resolution status

### Tools
- Quality Dashboard (Governance section in the Emergent Dashboard)
- [[SharePoint]]
- [[Click Up]]
- [[MS Teams]]

### Related Processes
- [[Engineering Pack (EPM1)]]
- [[Commissioning (EPM2)]]
- [[Construction (PM3)]]
- [[Hand Over (PM4)]]`,
  },
  {
    slug: "platform-process-alignment",
    title: "Platform Process Alignment",
    category: "process",
    status: "published",
    responsibleRole: "Program Manager",
    escalationRole: "COO",
    contentMarkdown: `## Platform Process Alignment

### Purpose
Align the processes and workflows of Future Green (FG), Emergent Energy (EE), and MAM across the shared Emergent Dashboard platform, ensuring consistent data standards, naming conventions, and operational procedures.

### Background
Emergent Energy operates within a group structure alongside Future Green and MAM. While each entity has its own client base and operational focus, they share:
- The Emergent Dashboard platform for project management
- Engineering resources and quality standards
- Financial reporting structures
- Common suppliers and subcontractor pools

### Workshop Process

#### Phase 1 — Process Mapping
1. Each entity documents its current processes end-to-end:
   - Project acquisition and handover
   - Engineering and design workflow
   - Construction management
   - Quality and commissioning
   - Financial tracking and invoicing
2. Process maps uploaded to shared [[SharePoint]] folder
3. Gaps and overlaps identified between entities

#### Phase 2 — Alignment Sessions
1. Cross-entity workshops held to align on:
   - **Naming Conventions**: Standard project naming, phase terminology, document naming
   - **Data Standards**: Excel tracker format, required fields, font colour rules
   - **Role Mapping**: How roles map across entities (e.g., FG Project Manager = EE Project Manager)
   - **Tool Usage**: Consistent use of [[Click Up]], [[SharePoint]], and the Dashboard
   - **Financial Standards**: COS recognition rules, revenue milestones, invoicing process
2. Alignment decisions documented and approved by entity heads

#### Phase 3 — Platform Configuration
1. Dashboard configured to support multi-entity operation:
   - Entity-specific project prefixes or tags
   - Shared vs entity-specific permission roles
   - Consolidated portfolio views with entity filtering
   - Common engineering stage templates
2. Training sessions for each entity on aligned processes

#### Phase 4 — Ongoing Governance
1. Monthly alignment review meetings
2. Process change requests managed through a shared register
3. Dashboard updates coordinated across entities
4. KPIs tracked per entity and consolidated

### Key Alignment Areas

| Area | Standard | Notes |
|---|---|---|
| **Project Naming** | \`[Entity]-[Client]-[Site]-[Phase]\` | e.g., EE-Coega-Steels-Ph2 |
| **Excel Tracker** | Unified template with standard columns | Costed left, Actual right |
| **COS Rules** | Same 4-status model across all entities | Font colour rules identical |
| **Engineering Stages** | Shared 5-stage template | Entity-specific tasks allowed within stages |
| **Quality Gates** | Common QA Gate 1/2/3 procedure | Same pass/fail criteria |
| **Weekly Reviews** | Same 6-step wizard for all PMs | Entity tag on each review |

### RACI

| Activity | R | A | C | I |
|---|---|---|---|---|
| Process mapping (per entity) | Entity Head | Entity Head | [[Program Manager]] | [[Chief Operations Officer]] |
| Alignment workshops | [[Program Manager]] | [[Chief Operations Officer]] | All entity heads | All PMs |
| Platform configuration | [[Program Manager]] | [[Chief Operations Officer]] | Entity heads | Engineering team |
| Training delivery | [[Program Manager]] | [[Program Manager]] | Entity heads | All users |
| Ongoing governance | [[Program Manager]] | [[Chief Operations Officer]] | Entity heads | — |

### Tools
- [[Emergent Dashboard]]
- [[SharePoint]]
- [[Click Up]]
- [[MS Teams]]

### Related Processes
- [[Smart Import Process]]
- [[COS Tracking]]
- [[Engineering Stage Gating]]
- [[Weekly Review Process]]`,
  },
];

export async function seedEeInfoUpdates() {
  try {
    const allNewNodes = [...NEW_NODES, ...NEW_SOP_NODES];
    for (const node of allNewNodes) {
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

    for (const sop of SOP_ENRICHMENTS) {
      const existing = await db.select().from(eeInfoNodes).where(eq(eeInfoNodes.slug, sop.slug));
      if (existing.length === 0) continue;
      const node = existing[0];
      if (node.contentMarkdown && node.contentMarkdown.includes(sop.marker)) {
        continue;
      }
      await db.update(eeInfoNodes)
        .set({
          contentMarkdown: sop.contentMarkdown + `\n\n<!-- ${sop.marker} -->`,
          status: "published",
          ...(sop.category ? { category: sop.category } : {}),
          responsibleRole: sop.responsibleRole || node.responsibleRole,
          escalationRole: sop.escalationRole || node.escalationRole,
        })
        .where(eq(eeInfoNodes.slug, sop.slug));
      console.log(`[EE-Info-Update] SOP enriched: ${node.title}`);
    }

    await seedNodeDetailsAndMetrics();

    console.log("[EE-Info-Update] Seed updates complete.");
  } catch (err) {
    console.error("[EE-Info-Update] Error:", err);
  }
}

interface NodeDetailSeed {
  slug: string;
  purpose: string;
  inputs: string;
  steps: string;
  outputs: string;
  raci: { role: string; responsible?: boolean; accountable?: boolean; consulted?: boolean; informed?: boolean }[];
  toolsDocs: { name: string; url?: string; type?: string }[];
  risksFailureModes: string;
}

interface NodeMetricSeed {
  slug: string;
  metrics: {
    metricKey: string;
    metricQueryType: string;
    config: Record<string, any>;
    displayFormat: string;
    sortOrder: number;
  }[];
}

const LIFECYCLE_STAGE_DETAILS: NodeDetailSeed[] = [
  {
    slug: "first-assessment-request-epd1",
    purpose: "Provide a high-level technical and financial feasibility analysis for a prospective project so the Head of Project Development can decide whether to proceed to Cost Proposal.",
    inputs: "Site visit report, Client brief / RFI, Hand over charter, Geo-coordinates and aerial imagery",
    steps: "1. Project Developer loads FA request on pre-engineering board\n2. Head of PD sets priority\n3. Quality Manager assigns to Design Engineer\n4. Design Engineer executes FA (PVSOL simulation, layout, yield)\n5. Quality Manager reviews output\n6. Design Engineer closes ticket and notifies PD",
    outputs: "FA Template (yield, layout, high-level costed estimate), PVSOL simulation file, Pre-engineering board ticket marked complete",
    raci: [
      { role: "Project Developer", responsible: true },
      { role: "Head of Project Development", accountable: true },
      { role: "Quality Manager", consulted: true },
      { role: "Design Engineer", responsible: true },
      { role: "COO", informed: true },
    ],
    toolsDocs: [
      { name: "PVSOL", type: "tool" },
      { name: "SharePoint", type: "tool" },
      { name: "MS Teams", type: "tool" },
      { name: "FA Template", type: "template" },
    ],
    risksFailureModes: "Incomplete site data leads to inaccurate yield estimates. Missing aerial imagery delays FA execution. PVSOL simulation not reviewed can propagate errors to Cost Proposal stage.",
  },
  {
    slug: "cost-proposal-request-epd2",
    purpose: "Produce a detailed, client-ready cost proposal covering system design, bill of materials, installation cost, and project timeline for formal offer submission.",
    inputs: "Approved First Assessment, Client scope confirmation (kWp target, roof/ground, storage), Up-to-date utility tariff schedule",
    steps: "1. PD loads Cost Proposal request on pre-engineering board\n2. Head of PD sets priority\n3. Quality Manager assigns to Design Engineer\n4. Engineer executes detailed design (PVsyst, SLD, BOM)\n5. Quality Manager reviews output\n6. Engineer compiles Cost Proposal document\n7. Ticket closed and PD notified",
    outputs: "Cost Proposal document, Detailed BOM, Single Line Diagram (SLD), PVsyst report, Project timeline estimate",
    raci: [
      { role: "Design Engineer", responsible: true },
      { role: "Head of Project Development", accountable: true },
      { role: "Quality Manager", consulted: true },
      { role: "Project Developer", informed: true },
    ],
    toolsDocs: [
      { name: "PVsyst", type: "tool" },
      { name: "SharePoint", type: "tool" },
      { name: "Cost Proposal Template", type: "template" },
    ],
    risksFailureModes: "Inaccurate BOM pricing leads to margin erosion. Outdated tariff schedules affect financial viability. Incomplete SLD delays engineering approval.",
  },
  {
    slug: "engineering-pack-epm1",
    purpose: "Deliver a complete Issued For Construction (IFC) engineering package including all drawings, calculations, and specifications required for safe and compliant installation.",
    inputs: "Approved Cost Proposal, Confirmed project scope, Site survey data, Client approval to proceed",
    steps: "1. Engineering pack request created from lifecycle board\n2. Engineer assigned and scope confirmed\n3. Detailed design and calculations completed\n4. Drawings produced (layout, SLD, mounting details)\n5. Internal design review conducted\n6. IFC pack compiled and approved\n7. Pack issued to construction team",
    outputs: "IFC Drawing Package, Structural calculations, Electrical calculations, Equipment specifications, Construction method statement",
    raci: [
      { role: "Design Engineer", responsible: true },
      { role: "Head of Engineering", accountable: true },
      { role: "Quality Manager", consulted: true },
      { role: "Project Manager", informed: true },
      { role: "Construction Manager", informed: true },
    ],
    toolsDocs: [
      { name: "AutoCAD", type: "tool" },
      { name: "SharePoint", type: "tool" },
      { name: "Engineering Stage Templates", type: "template" },
    ],
    risksFailureModes: "Design errors lead to rework on site. Missing structural calculations risk safety incidents. Incomplete specifications cause procurement delays.",
  },
  {
    slug: "commissioning-epm2",
    purpose: "Formally commission the solar installation, verify system performance, and prepare all documentation required for handover to Operations & Maintenance.",
    inputs: "Completed construction (QA Gate 3 passed), All test equipment calibrated, Grid connection approval (if applicable), Client availability for witness testing",
    steps: "1. Pre-commissioning checks completed\n2. System energisation under controlled conditions\n3. Performance tests (IV curve, thermal imaging)\n4. Grid compliance testing (if applicable)\n5. SSEG registration submitted\n6. Commissioning report compiled\n7. System handed over to O&M",
    outputs: "Commissioning report, Performance test results, SSEG registration confirmation, O&M handover documentation, As-built drawings",
    raci: [
      { role: "Design Engineer", responsible: true },
      { role: "Head of Engineering", accountable: true },
      { role: "Quality Manager", consulted: true },
      { role: "Project Manager", informed: true },
      { role: "COO", informed: true },
    ],
    toolsDocs: [
      { name: "IV Curve Tracer", type: "tool" },
      { name: "Thermal Camera", type: "tool" },
      { name: "Commissioning Template", type: "template" },
    ],
    risksFailureModes: "Incomplete pre-commissioning checks risk equipment damage. Missing SSEG registration delays grid connection. Insufficient performance documentation affects warranty claims.",
  },
  {
    slug: "sop-construction-qa",
    purpose: "Ensure every solar installation meets quality and safety standards through a structured 3-gate inspection procedure conducted at defined construction milestones.",
    inputs: "IFC engineering pack, Construction schedule, Quality checklists (Gate 1/2/3), Site access arrangements",
    steps: "1. PM notifies QM that gate milestone reached\n2. QM schedules site visit within 2 business days\n3. Inspector conducts gate-specific checklist\n4. Findings recorded in Quality Dashboard\n5. Failed gates require rework and re-inspection\n6. All gate approvals recorded with signature and timestamp",
    outputs: "QA inspection reports, Photo evidence, Gate approval records, Rework action items (if any)",
    raci: [
      { role: "Quality Manager", responsible: true, accountable: true },
      { role: "Project Manager", consulted: true },
      { role: "Construction Manager", consulted: true },
      { role: "COO", informed: true },
    ],
    toolsDocs: [
      { name: "Quality Dashboard", type: "tool" },
      { name: "SharePoint", type: "tool" },
      { name: "QA Gate Checklists", type: "template" },
    ],
    risksFailureModes: "Skipping gate inspections leads to latent defects. Insufficient photo evidence weakens warranty claims. Delayed inspections stall construction progress.",
  },
  {
    slug: "engineering-stage-gating",
    purpose: "Control when engineering stages can be marked complete through defined gate rules that must be satisfied before progression.",
    inputs: "Engineering task checklist, Required deliverables, QA approval status, Technical signoff status",
    steps: "1. All required tasks marked complete\n2. Required deliverables uploaded\n3. QA Review approval obtained (for Handover Pack)\n4. Technical Signoff obtained (for Handover Pack)\n5. Stage gate validated by system\n6. Stage marked complete",
    outputs: "Stage completion record, Audit trail of gate satisfaction, COO override log (if applicable)",
    raci: [
      { role: "Design Engineer", responsible: true },
      { role: "Head of Engineering", accountable: true },
      { role: "Quality Manager", consulted: true },
      { role: "COO", informed: true },
    ],
    toolsDocs: [
      { name: "Engineering Dashboard", type: "tool" },
      { name: "Lifecycle Board", type: "tool" },
    ],
    risksFailureModes: "Bypassing gates without COO override creates compliance gaps. Missing deliverables at handover delays project close-out. Unsigned technical signoffs expose liability.",
  },
  {
    slug: "weekly-review-process",
    purpose: "Provide structured weekly project status reporting by Project Managers to enable program oversight and early risk identification.",
    inputs: "Current project schedule status, Financial data (COS, cashflow), Risk register updates, Quality inspection status, Site progress photos",
    steps: "1. Schedule — Is the project on track?\n2. Costed — Any financial variances?\n3. Risks — Active risk assessment\n4. Quality — Inspection and QA status\n5. Actions — Next week's deliverables\n6. Summary — Overall status for management",
    outputs: "Weekly review report, Updated risk register, Action item list, Status summary for program dashboard",
    raci: [
      { role: "Project Manager", responsible: true },
      { role: "Program Manager", accountable: true },
      { role: "Construction Manager", consulted: true },
      { role: "COO", informed: true },
    ],
    toolsDocs: [
      { name: "Weekly Review Wizard", type: "tool" },
      { name: "PM Dashboard", type: "tool" },
    ],
    risksFailureModes: "Incomplete weekly reviews mask project issues. Late submissions delay management decisions. Inaccurate status reporting creates false confidence.",
  },
];

const DEPARTMENT_DETAILS: NodeDetailSeed[] = [
  {
    slug: "quality-manager",
    purpose: "Manage quality assurance across all projects, conduct inspections, and ensure compliance with safety and quality standards.",
    inputs: "Construction milestone notifications, Engineering deliverables for review, Quality checklists, Site inspection reports",
    steps: "Needs definition",
    outputs: "QA Gate approvals, Inspection reports, Quality dashboard updates, Handover Pack QA Review approval",
    raci: [
      { role: "Quality Manager", responsible: true, accountable: true },
      { role: "Head of Engineering", consulted: true },
      { role: "COO", informed: true },
    ],
    toolsDocs: [
      { name: "Quality Dashboard", type: "tool", url: "/qm-dashboard" },
      { name: "Engineering Stage Approvals", type: "tool" },
    ],
    risksFailureModes: "Needs definition",
  },
  {
    slug: "head-of-engineering",
    purpose: "Oversee the Engineering Department, manage engineering team workload, and ensure stage gate requirements are met across all projects.",
    inputs: "Project pipeline from lifecycle board, Engineering task assignments, Stage gate status reports, Resource availability",
    steps: "Needs definition",
    outputs: "Engineering dashboard reports, Task assignments, Stage template configurations, Engineering resource plans",
    raci: [
      { role: "Head of Engineering", responsible: true, accountable: true },
      { role: "Quality Manager", consulted: true },
      { role: "COO", informed: true },
    ],
    toolsDocs: [
      { name: "Engineering Dashboard", type: "tool", url: "/engineering-dashboard" },
      { name: "Engineering Task Board", type: "tool", url: "/engineering-tasks" },
      { name: "Stage Templates Admin", type: "tool", url: "/eng-template-admin" },
    ],
    risksFailureModes: "Needs definition",
  },
  {
    slug: "project-manager",
    purpose: "Day-to-day management of assigned projects on site, including schedule tracking, subcontractor coordination, and weekly reporting.",
    inputs: "Project brief and scope, IFC engineering pack, Construction schedule, Subcontractor contracts",
    steps: "Needs definition",
    outputs: "Weekly review reports, Project status updates, Subcontractor progress reports, Payment certificate approvals",
    raci: [
      { role: "Project Manager", responsible: true },
      { role: "Program Manager", accountable: true },
      { role: "Construction Manager", consulted: true },
      { role: "COO", informed: true },
    ],
    toolsDocs: [
      { name: "PM Dashboard", type: "tool", url: "/pm-dashboard" },
      { name: "Weekly Review Wizard", type: "tool", url: "/weekly-reviews" },
      { name: "Project Detail", type: "tool", url: "/projects" },
    ],
    risksFailureModes: "Needs definition",
  },
  {
    slug: "project-engineer",
    purpose: "Execute engineering tasks, complete stage checklist items, upload deliverables, and provide technical signoff for Handover Pack.",
    inputs: "Engineering task assignments, Design specifications, Site survey data, Previous stage outputs",
    steps: "Needs definition",
    outputs: "Design drawings, Calculations, Engineering deliverables, Technical signoff",
    raci: [
      { role: "Design Engineer", responsible: true },
      { role: "Head of Engineering", accountable: true },
      { role: "Quality Manager", consulted: true },
    ],
    toolsDocs: [
      { name: "Engineering Task Board", type: "tool", url: "/engineering-tasks" },
      { name: "Engineering Stages", type: "tool" },
    ],
    risksFailureModes: "Needs definition",
  },
];

const LIFECYCLE_STAGE_METRICS: NodeMetricSeed[] = [
  {
    slug: "first-assessment-request-epd1",
    metrics: [
      { metricKey: "active_projects", metricQueryType: "project_stage", config: { phase: "First Assessment" }, displayFormat: "number", sortOrder: 0 },
      { metricKey: "overdue_projects", metricQueryType: "project_count", config: { phase: "First Assessment", condition: "overdue" }, displayFormat: "number", sortOrder: 1 },
    ],
  },
  {
    slug: "cost-proposal-request-epd2",
    metrics: [
      { metricKey: "active_projects", metricQueryType: "project_stage", config: { phase: "Cost Proposal" }, displayFormat: "number", sortOrder: 0 },
      { metricKey: "overdue_projects", metricQueryType: "project_count", config: { phase: "Cost Proposal", condition: "overdue" }, displayFormat: "number", sortOrder: 1 },
    ],
  },
  {
    slug: "engineering-pack-epm1",
    metrics: [
      { metricKey: "active_projects", metricQueryType: "project_stage", config: { phase: "Engineering" }, displayFormat: "number", sortOrder: 0 },
      { metricKey: "overdue_projects", metricQueryType: "project_count", config: { phase: "Engineering", condition: "overdue" }, displayFormat: "number", sortOrder: 1 },
    ],
  },
  {
    slug: "sop-construction-qa",
    metrics: [
      { metricKey: "active_projects", metricQueryType: "project_stage", config: { phase: "Construction" }, displayFormat: "number", sortOrder: 0 },
      { metricKey: "overdue_projects", metricQueryType: "project_count", config: { phase: "Construction", condition: "overdue" }, displayFormat: "number", sortOrder: 1 },
    ],
  },
  {
    slug: "commissioning-epm2",
    metrics: [
      { metricKey: "active_projects", metricQueryType: "project_stage", config: { phase: "Commissioning" }, displayFormat: "number", sortOrder: 0 },
      { metricKey: "overdue_projects", metricQueryType: "project_count", config: { phase: "Commissioning", condition: "overdue" }, displayFormat: "number", sortOrder: 1 },
    ],
  },
  {
    slug: "engineering-stage-gating",
    metrics: [
      { metricKey: "active_projects", metricQueryType: "project_stage", config: { phase: "QA/Handover" }, displayFormat: "number", sortOrder: 0 },
      { metricKey: "overdue_projects", metricQueryType: "project_count", config: { phase: "QA/Handover", condition: "overdue" }, displayFormat: "number", sortOrder: 1 },
    ],
  },
  {
    slug: "weekly-review-process",
    metrics: [
      { metricKey: "active_projects", metricQueryType: "project_count", config: { condition: "active" }, displayFormat: "number", sortOrder: 0 },
    ],
  },
];

const DEPARTMENT_METRICS: NodeMetricSeed[] = [
  {
    slug: "quality-manager",
    metrics: [
      { metricKey: "projects_touching_dept", metricQueryType: "project_count", config: { department: "quality" }, displayFormat: "number", sortOrder: 0 },
    ],
  },
  {
    slug: "head-of-engineering",
    metrics: [
      { metricKey: "projects_touching_dept", metricQueryType: "project_count", config: { department: "engineering" }, displayFormat: "number", sortOrder: 0 },
    ],
  },
  {
    slug: "project-manager",
    metrics: [
      { metricKey: "projects_touching_dept", metricQueryType: "project_count", config: { department: "project_management" }, displayFormat: "number", sortOrder: 0 },
    ],
  },
  {
    slug: "project-engineer",
    metrics: [
      { metricKey: "projects_touching_dept", metricQueryType: "project_count", config: { department: "engineering" }, displayFormat: "number", sortOrder: 0 },
    ],
  },
];

async function seedNodeDetailsAndMetrics() {
  const allDetails = [...LIFECYCLE_STAGE_DETAILS, ...DEPARTMENT_DETAILS];

  for (const detail of allDetails) {
    const nodes = await db.select().from(eeInfoNodes).where(eq(eeInfoNodes.slug, detail.slug));
    if (nodes.length === 0) continue;
    const node = nodes[0];

    const existing = await db.select().from(eeInfoNodeDetails).where(eq(eeInfoNodeDetails.nodeId, node.id));
    if (existing.length > 0) continue;

    await db.insert(eeInfoNodeDetails).values({
      nodeId: node.id,
      purpose: detail.purpose,
      inputs: detail.inputs,
      steps: detail.steps,
      outputs: detail.outputs,
      raci: detail.raci,
      toolsDocs: detail.toolsDocs,
      risksFailureModes: detail.risksFailureModes,
      updatedAt: new Date(),
      updatedBy: "system",
    });
    console.log(`[EE-Info-Update] Created node details for: ${node.title}`);
  }

  const allMetrics = [...LIFECYCLE_STAGE_METRICS, ...DEPARTMENT_METRICS];

  for (const metricSeed of allMetrics) {
    const nodes = await db.select().from(eeInfoNodes).where(eq(eeInfoNodes.slug, metricSeed.slug));
    if (nodes.length === 0) continue;
    const node = nodes[0];

    const existing = await db.select().from(eeInfoNodeMetrics).where(eq(eeInfoNodeMetrics.nodeId, node.id));
    if (existing.length > 0) continue;

    for (const metric of metricSeed.metrics) {
      await db.insert(eeInfoNodeMetrics).values({
        nodeId: node.id,
        metricKey: metric.metricKey,
        metricQueryType: metric.metricQueryType,
        config: metric.config,
        displayFormat: metric.displayFormat,
        sortOrder: metric.sortOrder,
      });
    }
    console.log(`[EE-Info-Update] Created ${metricSeed.metrics.length} metrics for: ${node.title}`);
  }

  console.log("[EE-Info-Update] Node details and metrics seeding complete.");
}
