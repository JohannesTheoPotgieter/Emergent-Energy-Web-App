export interface WalkthroughStep {
  stepNumber: number;
  title: string;
  description: string;
  targetPage?: string;
  tip?: string;
}

export interface Walkthrough {
  id: string;
  title: string;
  description: string;
  category: "project-management" | "finance" | "engineering" | "governance" | "operations";
  estimatedMinutes: number;
  steps: WalkthroughStep[];
}

export const WALKTHROUGHS: Walkthrough[] = [
  {
    id: "smart-import",
    title: "Importing a Project (Smart Import)",
    description: "Learn how to upload an Excel tracker file and import project data into the system using the 5-step Smart Import wizard.",
    category: "project-management",
    estimatedMinutes: 10,
    steps: [
      {
        stepNumber: 1,
        title: "Navigate to Smart Import",
        description: "Open the sidebar and click 'Smart Import' under the PROJECT MANAGEMENT section. This opens the import wizard.",
        targetPage: "/smart-import",
        tip: "Smart Import is the only way to create or update project data. You cannot manually add projects — they come from Excel tracker files.",
      },
      {
        stepNumber: 2,
        title: "Upload Your Excel File",
        description: "Drag and drop your Excel tracker file onto the upload area, or click to browse. You can upload multiple files at once. The project name is automatically derived from the filename — everything before '_Tracker' becomes the project name (underscores become spaces).",
        tip: "Example: 'Coega_Steels_Phase_2_Tracker.xlsx' creates a project called 'Coega Steels Phase 2'.",
      },
      {
        stepNumber: 3,
        title: "Review Detected Sections",
        description: "The system automatically detects sections in your spreadsheet: Plan, Revenue, and Expenditure Breakdown. Review the detected sections and confirm they look correct. The detector scans up to 50 rows ahead past empty gaps to avoid missing data.",
        tip: "If a section wasn't detected, check that your Excel file has the standard column headers the system expects.",
      },
      {
        stepNumber: 4,
        title: "Map Columns to System Fields",
        description: "The wizard maps your Excel columns to the system's standard fields. Budget columns (left side of Expenditure Breakdown) and Actual columns (right side) are mapped separately. Review and correct any mappings that look wrong.",
        tip: "The Expenditure Breakdown sheet has two sections: budget data on the left (columns 2-8) and actual/realised data on the right (columns 13-26).",
      },
      {
        stepNumber: 5,
        title: "Resolve Any Issues",
        description: "The system highlights any data issues found — things like missing values, format problems, or unexpected data. For each issue you can choose to: Accept the row as-is, Ignore/Skip the row, or fix it in your Excel and re-upload. Use 'Allow All' to import every row without filtering.",
        tip: "Non-blocker warnings are auto-resolved during bulk commit so data isn't silently dropped.",
      },
      {
        stepNumber: 6,
        title: "Commit the Data",
        description: "Click 'Commit' to save all the mapped and validated data into the system. This writes expenditure lines, revenue data, and plan tasks to the database. Re-importing the same file will update existing data rather than creating duplicates.",
        tip: "After committing, navigate to the project detail page to verify your data imported correctly — check the Expenditure, Revenue, and Plan tabs.",
      },
    ],
  },
  {
    id: "cos-tracking",
    title: "Tracking Cost of Sales (COS)",
    description: "Understand how COS status is determined, what the 4 statuses mean, and how to use the COS Tracker to monitor realisation across all projects.",
    category: "finance",
    estimatedMinutes: 8,
    steps: [
      {
        stepNumber: 1,
        title: "Open the COS Tracker",
        description: "Navigate to the sidebar and click 'COS Tracker' under the MONEY section. This shows the company-wide COS overview with monthly data.",
        targetPage: "/cos",
      },
      {
        stepNumber: 2,
        title: "Understand the 4 COS Statuses",
        description: "Every expenditure line gets one of 4 COS statuses based on invoice and font color data:\n\n• COS Realised — Has an invoice number AND the invoice date font is black (confirmed paid)\n• Deferred — Has an invoice and invoice date, but font is red (not yet confirmed)\n• Flagged — Invoice date font is black but the invoice number is missing (needs attention)\n• Planned — Default state for all other lines",
        tip: "The key rule: only explicit black font on the invoice date means confirmed. If the font color is empty or null, it is NOT treated as confirmed.",
      },
      {
        stepNumber: 3,
        title: "Read the KPI Cards",
        description: "The top row shows 6 summary cards: YTD COS, YTD Realised (Paid), YTD Unrealised, YTD Budget, YTD Variance, and YTD Variance %. Green variance means under budget, red means over.",
      },
      {
        stepNumber: 4,
        title: "Use the Monthly Grid",
        description: "The main table shows monthly and year-to-date rows. Click on 'COS (Finance)', 'Realised COS', or 'Unrealised COS' rows to expand them and see which projects are contributing to each number.",
      },
      {
        stepNumber: 5,
        title: "Drill Into a Month",
        description: "Click any value in the monthly grid to open the detail drawer. This shows every individual line item for that month with its status, invoice details, and amounts. You can filter by Realised/Unrealised and by specific project.",
      },
      {
        stepNumber: 6,
        title: "Toggle Font Colors",
        description: "In the Expenditure Breakdown tab on a project detail page, you can click the color dot next to invoice or payment dates to toggle between black (confirmed) and red (forecast). This override persists across re-imports.",
        tip: "Font color toggles affect both COS status and Cashflow status calculations immediately.",
      },
      {
        stepNumber: 7,
        title: "Check Project-Level COS",
        description: "Open any project's detail page, go to the Money tab, then the 'COS Tracker' sub-tab. This shows the same COS logic but filtered to just that project, with items grouped by expense category.",
        targetPage: "/projects",
      },
    ],
  },
  {
    id: "cashflow-management",
    title: "Managing Cashflow",
    description: "Learn how cashflow tracking works, what the payment statuses mean, and how to forecast cash in and out of bank.",
    category: "finance",
    estimatedMinutes: 6,
    steps: [
      {
        stepNumber: 1,
        title: "Open the Cashflow Page",
        description: "Navigate to 'Cashflow' under the MONEY section in the sidebar. This shows the company-wide cashflow overview.",
        targetPage: "/cashflow",
      },
      {
        stepNumber: 2,
        title: "Understand Cash Outflow Statuses",
        description: "Every payment gets one of 3 statuses:\n\n• Out of Bank — Payment date font is black AND has an invoice number (money has actually left the bank)\n• Payment Planned — Payment date exists but font is red (payment is scheduled but not yet made)\n• Planned — No payment date or no relevant data",
        tip: "This mirrors the COS logic: black font = confirmed/happened, red font = planned/forecast.",
      },
      {
        stepNumber: 3,
        title: "Review Inflows vs Outflows",
        description: "The cashflow page shows both money coming in (revenue/client payments) and money going out (expenditure/supplier payments). Compare these to understand the company's cash position.",
      },
      {
        stepNumber: 4,
        title: "Toggle Payment Font Colors",
        description: "Just like invoice dates, you can toggle payment date font colors on the project Expenditure Breakdown. Click the color dot next to a payment date to switch between black (paid) and red (planned).",
      },
      {
        stepNumber: 5,
        title: "Check the Forecast",
        description: "Use the cashflow forecast view to see projected cash position over coming months based on planned payments and expected revenue.",
        targetPage: "/cashflow-forecast",
      },
    ],
  },
  {
    id: "weekly-review",
    title: "Running a Weekly Review",
    description: "Walk through the structured weekly review process that Project Managers complete to report on project status.",
    category: "governance",
    estimatedMinutes: 8,
    steps: [
      {
        stepNumber: 1,
        title: "Open a Project Detail Page",
        description: "Navigate to a project you manage from the Project Summary page or PM Dashboard. Click on the project to open its detail page.",
        targetPage: "/projects",
      },
      {
        stepNumber: 2,
        title: "Start the Weekly Review Wizard",
        description: "Look for the Weekly Review button or section on the project detail page. This launches a guided 6-step wizard.",
      },
      {
        stepNumber: 3,
        title: "Step 1 — Schedule Status",
        description: "Report whether the project schedule is on track, delayed, or ahead. Note any scheduling concerns.",
      },
      {
        stepNumber: 4,
        title: "Step 2 — Budget Status",
        description: "Review budget variances and flag any financial concerns. The system shows current spend vs budget data from the imported tracker.",
      },
      {
        stepNumber: 5,
        title: "Step 3 — Risk Assessment",
        description: "Identify and assess active risks. Rate each risk and note mitigation actions being taken.",
      },
      {
        stepNumber: 6,
        title: "Steps 4-6 — Quality, Actions, Summary",
        description: "Report on inspection/quality status, list next week's action items, then write an overall summary with key messages for management.",
      },
      {
        stepNumber: 7,
        title: "View Submitted Reviews",
        description: "After submission, management can see all weekly reviews on the dedicated Weekly Reviews page. This shows which projects have completed their check-in and which are overdue.",
        targetPage: "/weekly-reviews",
      },
    ],
  },
  {
    id: "engineering-stages",
    title: "Engineering Stage Checklist",
    description: "Learn how to use the 5-stage engineering checklist system — from generating stages through completing tasks, uploading deliverables, and getting approvals.",
    category: "engineering",
    estimatedMinutes: 12,
    steps: [
      {
        stepNumber: 1,
        title: "Open a Project's Engineering Tab",
        description: "Navigate to any project detail page and click the 'Engineering' tab. Then select the 'Stages' sub-tab to see the engineering checklist.",
        targetPage: "/projects",
      },
      {
        stepNumber: 2,
        title: "Generate the Engineering Checklist",
        description: "If no stages exist yet, click 'Generate Engineering Checklist'. This creates all 5 engineering stages for the project: First Assessment, Cost Proposal, IFC Planning, Construction Support, and Handover Pack.",
        tip: "Stages can also be auto-generated when a project moves on the Company Lifecycle Board. For example, moving to 'Construction' auto-creates IFC Planning and Construction Support.",
      },
      {
        stepNumber: 3,
        title: "Select a Stage",
        description: "The left panel shows all 5 stages with their status and progress bars (tasks completed out of total). Click a stage to see its full details in the right panel.",
      },
      {
        stepNumber: 4,
        title: "Review Stage Details",
        description: "Each stage shows its purpose, required inputs, and RACI roles (Responsible, Accountable, Consulted, Informed). This tells you who needs to do what.",
      },
      {
        stepNumber: 5,
        title: "Work Through the Task Checklist",
        description: "Check off tasks as you complete them. Each task can have notes and an assigned owner. Required tasks must be completed before the stage can be closed.",
      },
      {
        stepNumber: 6,
        title: "Upload Required Deliverables",
        description: "Each stage has required deliverables (documents, reports, plans). Upload files using the deliverable section. Files are stored with version tags so you can track revisions.",
      },
      {
        stepNumber: 7,
        title: "Get Approvals (Handover Pack)",
        description: "The Handover Pack stage requires two formal approvals before completion: QA Review from Dean (Quality Manager) and Technical Signoff from Tanaka (Engineer). Both must approve before the stage can be marked complete.",
        tip: "The COO can override stage completion if needed, but must provide a mandatory reason that gets logged to the audit trail.",
      },
      {
        stepNumber: 8,
        title: "Complete the Stage",
        description: "Once all required tasks are done, deliverables uploaded, and approvals obtained (where needed), click 'Complete Stage'. The system checks all gate rules — if anything is missing, it tells you exactly what's needed.",
      },
    ],
  },
  {
    id: "lifecycle-board",
    title: "Moving Projects on the Lifecycle Board",
    description: "Learn how to use the Company Lifecycle Board to track project phases and trigger engineering stages automatically.",
    category: "project-management",
    estimatedMinutes: 5,
    steps: [
      {
        stepNumber: 1,
        title: "Open the Lifecycle Board",
        description: "Navigate to 'Company Lifecycle Dashboard' under the EXCO section in the sidebar. This shows all projects organized by their current lifecycle phase.",
        targetPage: "/lifecycle-board",
      },
      {
        stepNumber: 2,
        title: "Understand the Phases",
        description: "Projects move through phases: First Assessment → Cost Proposal → Planning → Construction → QA → Handover → Closeout. Additional phases include Hold, Closed, DLP, Financial Close, and TBC.",
      },
      {
        stepNumber: 3,
        title: "Move a Project",
        description: "Drag a project card from one phase column to another, or use the phase change controls. When you move a project, the system records the change.",
        tip: "Some phases have execution gates — the project must meet specific criteria (e.g., signed status, required documents) before it can be promoted.",
      },
      {
        stepNumber: 4,
        title: "Auto-Generated Engineering Stages",
        description: "When a project moves to certain phases, engineering stages are automatically created:\n\n• First Assessment → creates 'First Assessment' stage\n• Cost Proposal → creates 'Cost Proposal' stage\n• Planning → creates 'IFC Planning' stage\n• Construction → creates 'IFC Planning' + 'Construction Support'\n• QA/Handover → creates 'Handover Pack' stage",
        tip: "This is idempotent — if the stage already exists, it won't create a duplicate.",
      },
      {
        stepNumber: 5,
        title: "Check the Engineering Stages",
        description: "After moving a project, open its detail page and go to Engineering > Stages to see the newly generated checklist. The stages will be in 'Not Started' status, ready for your team to begin working through.",
      },
    ],
  },
  {
    id: "quality-management",
    title: "Quality Management Workflow",
    description: "Learn how to use the quality dashboard, manage checklists, and handle QA warnings and approvals.",
    category: "governance",
    estimatedMinutes: 7,
    steps: [
      {
        stepNumber: 1,
        title: "Open the Quality Dashboard",
        description: "Navigate to 'Quality Dashboard' under the GOVERNANCE section. This shows an overview of quality status across all projects.",
        targetPage: "/quality",
      },
      {
        stepNumber: 2,
        title: "Select a Project",
        description: "Click on a project to see its quality checklist. Each project has a multi-phase quality inspection checklist that tracks compliance and safety items.",
      },
      {
        stepNumber: 3,
        title: "Review Checklist Items",
        description: "Go through each checklist item. Mark items as complete, flag issues, or add notes. Required items must be addressed before the project can pass quality review.",
      },
      {
        stepNumber: 4,
        title: "Handle QA Warnings",
        description: "When issues are flagged, QA warnings appear. The Quality Manager (Dean) can acknowledge, override, or resolve warnings. Each action requires notes explaining the decision.",
      },
      {
        stepNumber: 5,
        title: "Handover Pack QA Approval",
        description: "For the Handover Pack engineering stage, Dean must provide a formal QA Review approval. This is separate from the quality checklist — it's a stage gate requirement.",
      },
      {
        stepNumber: 6,
        title: "Technical Signoff",
        description: "Tanaka (Engineer) provides the Technical Signoff for Handover Pack. Both QA Review and Technical Signoff must be approved before the Handover Pack stage can be completed.",
      },
    ],
  },
  {
    id: "engineering-tasks",
    title: "Creating & Managing Engineering Tasks",
    description: "Learn how to create, assign, and track engineering tasks using the task board.",
    category: "engineering",
    estimatedMinutes: 6,
    steps: [
      {
        stepNumber: 1,
        title: "Open the Engineering Section",
        description: "Navigate to 'Engineering' or 'Task Board' under the ENGINEERING section in the sidebar.",
        targetPage: "/engineering/tasks",
      },
      {
        stepNumber: 2,
        title: "View the Task Board",
        description: "The task board shows all engineering tasks organised by status. You can see who each task is assigned to, which project it belongs to, and its current RAG status.",
      },
      {
        stepNumber: 3,
        title: "Create a New Task",
        description: "Click the create button to add a new engineering task. Select the project (Hold and Closed projects are excluded from the picker), assign an engineer, set the priority and due date.",
        tip: "Engineering tasks are separate from engineering stage checklist items. Tasks are for day-to-day work; stages are for formal process milestones.",
      },
      {
        stepNumber: 4,
        title: "Track Progress",
        description: "Update task status as work progresses. Add notes, change RAG status, and track time spent. The Engineering Dashboard gives managers an overview of team workload.",
        targetPage: "/engineering",
      },
      {
        stepNumber: 5,
        title: "Complete the Task",
        description: "Mark the task as complete when the work is done. Completed tasks are tracked for historical reporting and team performance metrics.",
      },
    ],
  },
  {
    id: "subcontractor-management",
    title: "Subcontractor & Procurement Management",
    description: "Learn how to manage subcontractors, track procurement, and monitor supplier performance.",
    category: "operations",
    estimatedMinutes: 6,
    steps: [
      {
        stepNumber: 1,
        title: "Open the Procurement Dashboard",
        description: "Navigate to 'Procurement' under the MONEY section in the sidebar. This shows the subcontractor dashboard with an overview of all suppliers.",
        targetPage: "/subcontractor-dashboard",
      },
      {
        stepNumber: 2,
        title: "Review Subcontractor Status",
        description: "The dashboard shows each subcontractor's current status, including active projects, outstanding POs, and payment status.",
      },
      {
        stepNumber: 3,
        title: "Track Purchase Orders",
        description: "View PO numbers associated with each subcontractor. POs are imported from the Excel tracker and show in the Expenditure Breakdown as green badges.",
      },
      {
        stepNumber: 4,
        title: "Monitor Invoice Status",
        description: "Track which invoices have been received and their confirmation status. Invoice numbers show as blue badges in the expenditure breakdown. The font color on invoice dates indicates whether they're confirmed (black) or forecast (red).",
      },
      {
        stepNumber: 5,
        title: "Link to Financial Tracking",
        description: "Subcontractor payments feed into both the COS Tracker and Cashflow. Changes in payment or invoice status here automatically reflect in the company-wide financial views.",
        targetPage: "/cos",
      },
    ],
  },
];

export const WALKTHROUGH_CATEGORIES: Record<string, { label: string; color: string }> = {
  "project-management": { label: "Project Management", color: "bg-blue-100 text-blue-700 border-blue-200" },
  "finance": { label: "Finance", color: "bg-green-100 text-green-700 border-green-200" },
  "engineering": { label: "Engineering", color: "bg-purple-100 text-purple-700 border-purple-200" },
  "governance": { label: "Governance", color: "bg-red-100 text-red-700 border-red-200" },
  "operations": { label: "Operations", color: "bg-amber-100 text-amber-700 border-amber-200" },
};
