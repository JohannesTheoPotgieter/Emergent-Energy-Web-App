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
  category: "project-management" | "finance" | "engineering" | "governance" | "operations" | "productivity" | "admin";
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
        description: "Click 'Commit' to save all the mapped and validated data into the system. This writes expenditure lines, revenue data, and plan tasks to the database. Re-importing the same file will update existing data rather than creating duplicates — your PM assignments and task owners are preserved.",
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
    id: "lifecycle-and-engineering",
    title: "Lifecycle Board & Engineering Stages",
    description: "Learn how to move projects through lifecycle phases on the Company Board, and how the 5-stage engineering checklist system works — from auto-generated stages through tasks, deliverables, approvals, and stage completion.",
    category: "engineering",
    estimatedMinutes: 15,
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
        title: "Move a Project to a New Phase",
        description: "Drag a project card from one phase column to another, or use the phase change controls. When you move a project, the system records the change and may auto-generate engineering stages.",
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
        title: "Open the Project's Engineering Stages",
        description: "After moving a project, open its detail page and click the 'Engineering' tab, then the 'Stages' sub-tab. You'll see the newly generated stages in 'Not Started' status, ready for your team to work through.",
        targetPage: "/projects",
      },
      {
        stepNumber: 6,
        title: "Select a Stage and Review Details",
        description: "The left panel shows all stages with their status and progress bars (tasks completed out of total). Click a stage to see its purpose, required inputs, and RACI roles (Responsible, Accountable, Consulted, Informed) — this tells you who needs to do what.",
      },
      {
        stepNumber: 7,
        title: "Work Through the Task Checklist",
        description: "Check off tasks as you complete them. Each task can have notes and an assigned owner. Required tasks must be completed before the stage can be closed.",
      },
      {
        stepNumber: 8,
        title: "Upload Required Deliverables",
        description: "Each stage has required deliverables (documents, reports, plans). Upload files using the deliverable section. Files are stored with version tags so you can track revisions.",
      },
      {
        stepNumber: 9,
        title: "Get Approvals (Handover Pack)",
        description: "The Handover Pack stage requires two formal approvals before completion: QA Review from Dean (Quality Manager) and Technical Signoff from Tanaka (Engineer). Both must approve before the stage can be marked complete.",
        tip: "The COO can override stage completion if needed, but must provide a mandatory reason that gets logged to the audit trail.",
      },
      {
        stepNumber: 10,
        title: "Complete the Stage",
        description: "Once all required tasks are done, deliverables uploaded, and approvals obtained (where needed), click 'Complete Stage'. The system checks all gate rules — if anything is missing, it tells you exactly what's needed. Then move to the next stage or advance the project on the Lifecycle Board.",
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
  {
    id: "my-tool-productivity",
    title: "Using My Tool (Personal Productivity)",
    description: "Learn how to use the My Tool personal productivity hub to triage your inbox, manage daily tasks, plan your week, and track meetings.",
    category: "productivity",
    estimatedMinutes: 5,
    steps: [
      {
        stepNumber: 1,
        title: "Open My Tool — Today View",
        description: "Click 'My Tool' in the sidebar to open your personal productivity dashboard. The Today view shows your tasks and priorities for the current day.",
        targetPage: "/my-tool/today",
      },
      {
        stepNumber: 2,
        title: "Triage Your Inbox",
        description: "Open the Triage Inbox to review new items that need attention. Items can be action items from meetings, flagged issues, or tasks assigned to you. Decide on each: accept, defer, or dismiss.",
        targetPage: "/triage-inbox",
        tip: "Process your inbox first thing each morning to keep on top of new items.",
      },
      {
        stepNumber: 3,
        title: "Set Your Priorities",
        description: "Navigate to the Priorities view to rank your most important tasks. Drag and drop to reorder. Focus on the top 3 items — these are your must-do tasks for the day.",
        targetPage: "/my-tool/priorities",
      },
      {
        stepNumber: 4,
        title: "Plan Your Week",
        description: "Switch to the Week view to see your tasks and commitments across the full week. This helps you balance workload and spot upcoming deadlines before they arrive.",
        targetPage: "/my-tool/week",
        tip: "Use the Week view on Monday mornings to plan your week ahead.",
      },
      {
        stepNumber: 5,
        title: "Track Meetings & Action Items",
        description: "Open the Meetings section to see upcoming and past meetings. Meeting notes and action items from Read.ai integrations appear here automatically. Review action items and mark them complete as you go.",
        targetPage: "/my-tool/meetings",
      },
    ],
  },
  {
    id: "home-dashboard",
    title: "Home Dashboard & Company Priorities",
    description: "Understand the home screen, personalised greetings, and how to manage company-level strategic priorities.",
    category: "project-management",
    estimatedMinutes: 4,
    steps: [
      {
        stepNumber: 1,
        title: "View Your Home Dashboard",
        description: "When you log in, you land on the Home page. It shows a personalised greeting with your name and a daily message. You'll also see the current date and quick links to key areas.",
        targetPage: "/",
      },
      {
        stepNumber: 2,
        title: "Review Company Priorities",
        description: "The home page displays company-level priorities — strategic items that drive focus across teams. Each priority card shows a title, department, horizon (short/medium/long term), and linked project if any.",
      },
      {
        stepNumber: 3,
        title: "Manage Priorities (Admin Only)",
        description: "If you have COO, CEO, or CFO access, you'll see a 'Manage' button. Click it to add, edit, reorder, or remove priorities. These are visible to everyone on the home page.",
        tip: "Keep priorities focused — aim for 3-5 active items that represent the company's current strategic focus.",
      },
    ],
  },
  {
    id: "project-summary",
    title: "Project Summary & Filtering",
    description: "Learn how to browse, search, and filter all projects in the system, and how to access project details.",
    category: "project-management",
    estimatedMinutes: 5,
    steps: [
      {
        stepNumber: 1,
        title: "Open the Project Summary Page",
        description: "Click 'Project Summary' in the sidebar under PROJECT MANAGEMENT. This shows all projects in a sortable table with key metrics at a glance.",
        targetPage: "/projects",
      },
      {
        stepNumber: 2,
        title: "Search and Filter Projects",
        description: "Use the search bar to find projects by name. Use the PM filter dropdown to see only projects managed by a specific person. You can also filter by phase or status.",
      },
      {
        stepNumber: 3,
        title: "Understand the Summary Columns",
        description: "Each row shows: project name, PM, phase, size (kWp), contract value, COS realisation %, schedule status, and RAG indicators. Click column headers to sort.",
      },
      {
        stepNumber: 4,
        title: "Edit Project Details Inline",
        description: "Click the edit icon on any project row to update PM, PD, or other project-level fields directly from the summary table without opening the full detail page.",
      },
      {
        stepNumber: 5,
        title: "Open a Project Detail Page",
        description: "Click on any project name to open its full detail view with all tabs (Overview, Plan, Engineering, Money, Quality, History).",
      },
    ],
  },
  {
    id: "pm-dashboard",
    title: "PM Dashboard (Site Managers)",
    description: "Learn how the PM Dashboard works for site-level project managers who need a focused view of their assigned projects.",
    category: "project-management",
    estimatedMinutes: 4,
    steps: [
      {
        stepNumber: 1,
        title: "Access the PM Dashboard",
        description: "If you have a PROJECT_MANAGER_SITE role, you're automatically redirected here on login. Otherwise, navigate to 'PM Dashboard' in the sidebar.",
        targetPage: "/pm-dashboard",
      },
      {
        stepNumber: 2,
        title: "View Your Assigned Projects",
        description: "The dashboard shows only projects assigned to you as PM. Each project card displays key metrics: phase, schedule status, budget health, and upcoming deadlines.",
      },
      {
        stepNumber: 3,
        title: "Quick Access to Project Details",
        description: "Click any project card to jump directly into the project detail page. From there you can run weekly reviews, update tasks, and check financials.",
      },
      {
        stepNumber: 4,
        title: "Filter by PM (Admin View)",
        description: "Admin users can filter the PM Dashboard by any PM to see their project portfolio. Use the user filter at the top to switch between PMs.",
      },
    ],
  },
  {
    id: "tr-register",
    title: "TR Register (Technical Requests)",
    description: "Track cross-project action items, technical requests, and follow-ups using the TR Register.",
    category: "governance",
    estimatedMinutes: 5,
    steps: [
      {
        stepNumber: 1,
        title: "Open the TR Register",
        description: "Navigate to 'TR Register' in the sidebar. This shows all tracked technical requests and action items across projects.",
        targetPage: "/tr-register",
      },
      {
        stepNumber: 2,
        title: "Create a New TR Item",
        description: "Click 'New TR' to create a new tracking item. Fill in the title, description, assign owners, link to a project, and set the priority and due date.",
      },
      {
        stepNumber: 3,
        title: "Track and Update Items",
        description: "Update status as items progress. Add comments and notes. The register tracks who created the item, when it was last updated, and its current state.",
      },
      {
        stepNumber: 4,
        title: "Filter and Search",
        description: "Use the filter options to find items by status (open, closed, overdue), owner, project, or search by keywords.",
      },
      {
        stepNumber: 5,
        title: "Close Completed Items",
        description: "When an action item is fully resolved, mark it as closed. Closed items remain visible for historical reference and audit purposes.",
      },
    ],
  },
  {
    id: "project-overview-tab",
    title: "Project Detail — Overview Tab",
    description: "Learn about the project overview tab including the task grid, board view, calendar view, and project awareness bar.",
    category: "project-management",
    estimatedMinutes: 6,
    steps: [
      {
        stepNumber: 1,
        title: "Open a Project Detail Page",
        description: "From Project Summary or PM Dashboard, click a project name to open its detail page. You'll land on the Overview tab by default.",
        targetPage: "/projects",
      },
      {
        stepNumber: 2,
        title: "Review the Project Awareness Bar",
        description: "At the top of the page, the awareness bar shows key project info: PM, PD, phase, size, contract value, and key dates. This gives you instant context about the project.",
      },
      {
        stepNumber: 3,
        title: "Use the Task Grid View",
        description: "The task grid shows all imported plan tasks in a table format. You can see task names, dates, duration, percentage complete, and assigned owners. Click to edit inline.",
      },
      {
        stepNumber: 4,
        title: "Switch to Board View",
        description: "Toggle to Board View for a kanban-style layout. Tasks are organized by status columns, making it easy to see what's in progress, completed, or blocked.",
      },
      {
        stepNumber: 5,
        title: "Use Calendar View",
        description: "Switch to Calendar View to see tasks plotted on a calendar. This helps visualize task timing and identify scheduling conflicts.",
      },
      {
        stepNumber: 6,
        title: "Assign Task Owners",
        description: "Click on any task to assign an owner. These assignments are preserved even when you re-import the project — the system remembers who was assigned to each task.",
        tip: "Task owners set here are protected during Smart Import re-runs. The Excel value only fills in tasks that don't already have an owner.",
      },
    ],
  },
  {
    id: "project-plan-tab",
    title: "Project Detail — Plan Tab (Gantt & Schedule)",
    description: "Learn how to use the Gantt chart, critical path analysis, and schedule change notices in the Plan tab.",
    category: "project-management",
    estimatedMinutes: 7,
    steps: [
      {
        stepNumber: 1,
        title: "Open the Plan Tab",
        description: "On any project detail page, click the 'Plan' tab. This shows the project schedule in Gantt chart format with task dependencies and timelines.",
      },
      {
        stepNumber: 2,
        title: "Read the Gantt Chart",
        description: "Tasks are displayed as horizontal bars showing start date, end date, and duration. The bar color indicates completion percentage. Overdue tasks are highlighted.",
      },
      {
        stepNumber: 3,
        title: "Identify the Critical Path",
        description: "The system calculates and highlights the critical path — the longest sequence of dependent tasks that determines the project's minimum completion time. Any delay on a critical path task delays the whole project.",
        tip: "Focus management attention on critical path tasks. These are the ones where delays have the biggest impact.",
      },
      {
        stepNumber: 4,
        title: "Compare Planned vs Actual",
        description: "The Gantt shows both planned dates (from the original schedule) and actual dates (as work progresses). This makes it easy to see schedule slippage at a glance.",
      },
      {
        stepNumber: 5,
        title: "Review Schedule Change Notices",
        description: "When dates change significantly, Schedule Change Notices are generated. These provide a formal record of schedule adjustments, who approved them, and the reason.",
      },
      {
        stepNumber: 6,
        title: "Check Key Dates",
        description: "Key project milestones (PD Handover, Construction Start, Commissioning, OM Handover, Client Handover) are tracked separately. These are extracted from the Excel tracker and shown on the overview bar.",
      },
    ],
  },
  {
    id: "project-money-revenue",
    title: "Project Detail — Revenue Tracking",
    description: "Learn how revenue milestones, invoicing, and payment confirmation work in the Money tab's Revenue sub-tab.",
    category: "finance",
    estimatedMinutes: 5,
    steps: [
      {
        stepNumber: 1,
        title: "Open the Revenue Sub-Tab",
        description: "On a project detail page, click the 'Money' tab, then select the 'Revenue' sub-tab. This shows all revenue lines imported from the Excel tracker.",
      },
      {
        stepNumber: 2,
        title: "Understand Revenue Lines",
        description: "Each line represents a revenue milestone — a payment you expect to receive from the client. Lines show the milestone name, expected amount, invoice date, and payment status.",
      },
      {
        stepNumber: 3,
        title: "Track Revenue Recognition",
        description: "The Revenue Recognition Amount column shows how much revenue has been formally recognized for each expenditure line. This feeds into the portfolio-level revenue reports.",
        tip: "Revenue amounts are extracted from the 'REVENUE RECOGNITION AMOUNT' column in the Expenditure Breakdown sheet during import.",
      },
      {
        stepNumber: 4,
        title: "Confirm Payments (In Bank)",
        description: "When client payments arrive, the font color on the payment date indicates confirmation. Black = money received, Red = still expected.",
      },
      {
        stepNumber: 5,
        title: "Link Revenue to Tasks",
        description: "Revenue milestones can be linked to plan tasks. This helps forecast when revenue will be recognized based on task completion dates.",
      },
    ],
  },
  {
    id: "project-money-expenditure",
    title: "Project Detail — Expenditure Breakdown",
    description: "Learn how to read, edit, and manage expenditure lines including PO/invoice tracking and font color overrides.",
    category: "finance",
    estimatedMinutes: 8,
    steps: [
      {
        stepNumber: 1,
        title: "Open the Expenditure Sub-Tab",
        description: "On a project detail page, click 'Money' tab, then 'Expenditure'. This shows all cost lines imported from the Excel tracker, grouped by category.",
      },
      {
        stepNumber: 2,
        title: "Understand the Layout",
        description: "The expenditure breakdown has two sections mirroring the Excel: Budget columns on the left (quantity, rate, total) and Actual columns on the right (description, PO, invoice, payment info, COS).",
      },
      {
        stepNumber: 3,
        title: "Read Category Groupings",
        description: "Expenditure items are grouped into categories (e.g., Electrical, Structural, General Expenses). Categories are sorted by their original Excel row order. Each category shows subtotals.",
        tip: "Categories are preserved exactly as they appear in your Excel file. The system maintains the original sort order.",
      },
      {
        stepNumber: 4,
        title: "Check PO and Invoice Status",
        description: "PO numbers show as green badges, invoice numbers as blue badges. These are imported from the Excel tracker and indicate procurement progress.",
      },
      {
        stepNumber: 5,
        title: "Toggle Font Colors (Confirm/Forecast)",
        description: "Click the color dot next to any invoice date or payment date to toggle between black (confirmed) and red (forecast). This is how you update COS and cashflow status without re-importing.",
        tip: "Font color overrides persist across re-imports. They're stored in the expenditure_overrides table.",
      },
      {
        stepNumber: 6,
        title: "Edit Inline",
        description: "Click on any editable cell to update values directly. Changes are saved immediately and tracked in the audit history.",
      },
      {
        stepNumber: 7,
        title: "Link Expenditure to Tasks",
        description: "Expenditure lines can be linked to plan tasks. This creates a connection between cost items and schedule items for integrated project tracking.",
      },
    ],
  },
  {
    id: "project-money-cashflow",
    title: "Project Detail — Project Cashflow",
    description: "Learn how to read and plan cashflow at the individual project level.",
    category: "finance",
    estimatedMinutes: 5,
    steps: [
      {
        stepNumber: 1,
        title: "Open the Cashflow Sub-Tab",
        description: "On a project detail page, click 'Money' tab, then 'Cashflow'. This shows the project-specific cashflow view.",
      },
      {
        stepNumber: 2,
        title: "Read the Weekly Chart",
        description: "The chart displays weekly cash inflows and outflows for this project. Green bars = money in, red bars = money out. The net position line shows cumulative cash flow.",
      },
      {
        stepNumber: 3,
        title: "Use the Planning Grid",
        description: "Below the chart, the editable planning grid lets you forecast future payments. Each row represents an expenditure category with monthly columns for planned outflows.",
      },
      {
        stepNumber: 4,
        title: "Compare Planned vs Actual",
        description: "The grid shows both planned payments (from forecasts) and actual payments (confirmed by black font colors). This helps you see where reality differs from the plan.",
      },
      {
        stepNumber: 5,
        title: "Impact on Portfolio Cashflow",
        description: "Project-level cashflow data rolls up to the company-wide Cashflow page. Changes here automatically reflect in the portfolio view.",
        targetPage: "/cashflow",
      },
    ],
  },
  {
    id: "project-quality-tab",
    title: "Project Detail — Quality Tab",
    description: "Learn how to manage quality inspections, checklists, and QA evidence for individual projects.",
    category: "governance",
    estimatedMinutes: 5,
    steps: [
      {
        stepNumber: 1,
        title: "Open the Quality Tab",
        description: "On a project detail page, click the 'Quality' tab. This shows the project's quality inspection checklist and any active warnings.",
      },
      {
        stepNumber: 2,
        title: "Work Through the Checklist",
        description: "The quality checklist is organized by inspection phase. Go through each item, marking it as passed, failed, or not applicable. Add evidence notes where required.",
      },
      {
        stepNumber: 3,
        title: "Handle Warnings and Issues",
        description: "Failed items generate QA warnings. The Quality Manager can acknowledge warnings, request corrective action, or override them with a documented reason.",
        tip: "Only users with Quality Manager access can set items to 'Pass' or override warnings.",
      },
      {
        stepNumber: 4,
        title: "Upload Evidence",
        description: "Attach photos, documents, or other evidence to quality items. This creates a permanent record of inspections for compliance and audit purposes.",
      },
      {
        stepNumber: 5,
        title: "Track Overall Quality Score",
        description: "The quality tab shows an overall score based on completed vs outstanding items. This score feeds into the Quality Dashboard for portfolio-level reporting.",
        targetPage: "/quality",
      },
    ],
  },
  {
    id: "project-history-tab",
    title: "Project Detail — History & Audit Trail",
    description: "Understand how the project history tab tracks all changes made to project data.",
    category: "governance",
    estimatedMinutes: 3,
    steps: [
      {
        stepNumber: 1,
        title: "Open the History Tab",
        description: "On a project detail page, click the 'History' tab. This shows a chronological audit trail of every change made to this project's data.",
      },
      {
        stepNumber: 2,
        title: "Read Change Sets",
        description: "Each entry shows: who made the change, when, what field was changed, the old value, and the new value. Changes from Smart Import re-runs are also logged here.",
      },
      {
        stepNumber: 3,
        title: "Filter the Audit Trail",
        description: "Use the filters to narrow down changes by date range, user, or type of change. This is useful for investigating when and why specific data changed.",
        tip: "The audit trail is immutable — entries cannot be edited or deleted. This ensures a complete compliance record.",
      },
    ],
  },
  {
    id: "engineering-dashboard",
    title: "Engineering Dashboard & Standup",
    description: "Learn how the engineering standup dashboard works for managing team workload, blockers, and weekly planning.",
    category: "engineering",
    estimatedMinutes: 5,
    steps: [
      {
        stepNumber: 1,
        title: "Open the Engineering Dashboard",
        description: "Navigate to 'Engineering' in the sidebar. The main dashboard shows the engineering standup view with team metrics.",
        targetPage: "/engineering",
      },
      {
        stepNumber: 2,
        title: "Review KPI Strips",
        description: "The top section shows key engineering metrics: total active tasks, tasks by status, team utilization, and blockers count. These update in real-time as tasks are modified.",
      },
      {
        stepNumber: 3,
        title: "Check Team Workload",
        description: "The workload table shows each engineer's current task allocation. See who is overloaded, who has capacity, and what's at risk of slipping.",
      },
      {
        stepNumber: 4,
        title: "Review Blockers",
        description: "Blockers are highlighted prominently. Each blocker shows what's stuck, who owns it, and how long it's been blocked. Address blockers in your daily standup.",
      },
      {
        stepNumber: 5,
        title: "Navigate to Task Board",
        description: "Click 'Task Board' to switch to the detailed task management view where you can create, assign, and update individual tasks.",
        targetPage: "/engineering/tasks",
      },
    ],
  },
  {
    id: "engineering-pipeline-inbox",
    title: "Engineering Pipeline Inbox",
    description: "Learn how to manage incoming engineering requests and proposals through the pipeline inbox.",
    category: "engineering",
    estimatedMinutes: 4,
    steps: [
      {
        stepNumber: 1,
        title: "Open the Pipeline Inbox",
        description: "Navigate to 'Pipeline Inbox' under ENGINEERING in the sidebar. This shows incoming engineering requests and proposals that need attention.",
        targetPage: "/engineering/inbox",
      },
      {
        stepNumber: 2,
        title: "Review Incoming Requests",
        description: "Each item in the inbox represents a new engineering request or proposal. Review the details, scope, and priority of each request.",
      },
      {
        stepNumber: 3,
        title: "Triage and Assign",
        description: "Decide on each request: accept and assign to an engineer, defer for later, or reject with a reason. Accepted items become engineering tasks.",
      },
      {
        stepNumber: 4,
        title: "SharePoint Integration",
        description: "The inbox integrates with SharePoint for proposal documents. The SP Sync page manages the synchronization of proposal data between SharePoint and the app.",
        targetPage: "/engineering/sync",
      },
    ],
  },
  {
    id: "cos-control",
    title: "COS Control & Override Management",
    description: "Learn how to manage COS status overrides and use the COS Control page for fine-grained cost of sales management.",
    category: "finance",
    estimatedMinutes: 4,
    steps: [
      {
        stepNumber: 1,
        title: "Open COS Control",
        description: "Navigate to 'COS Control' under the MONEY section. This provides a detailed view of COS status management across projects.",
        targetPage: "/cos-control",
      },
      {
        stepNumber: 2,
        title: "Review Flagged Items",
        description: "The COS Control page highlights items that need attention — particularly 'Flagged' items where the invoice date is confirmed (black font) but the invoice number is missing.",
      },
      {
        stepNumber: 3,
        title: "Override COS Status",
        description: "Click on a Flagged badge to open the override dialog. You can change the COS status and provide a reason for the override. Overrides persist across re-imports.",
        tip: "Override reasons are shown on hover so other team members understand why the status was changed.",
      },
      {
        stepNumber: 4,
        title: "Track Overrides",
        description: "All COS overrides are stored in the cos_status_overrides table and are keyed by expense ID for re-import resilience. The audit trail captures who made each override and when.",
      },
    ],
  },
  {
    id: "revenue-page",
    title: "Portfolio Revenue Tracking",
    description: "Track revenue milestones and payment confirmations across all projects from the portfolio-level Revenue page.",
    category: "finance",
    estimatedMinutes: 4,
    steps: [
      {
        stepNumber: 1,
        title: "Open the Revenue Page",
        description: "Navigate to 'Revenue' under the MONEY section. This shows a company-wide view of all revenue milestones across projects.",
        targetPage: "/revenue",
      },
      {
        stepNumber: 2,
        title: "Review Revenue by Project",
        description: "See total expected revenue, invoiced amounts, and received payments for each project. The summary gives a quick picture of where money is expected and where it's been confirmed.",
      },
      {
        stepNumber: 3,
        title: "Track Payment Confirmation",
        description: "Revenue items show their payment status: Invoiced (sent to client), In Bank (payment received), or Planned (not yet invoiced). This helps forecast cash inflows.",
      },
      {
        stepNumber: 4,
        title: "Link to Project Detail",
        description: "Click any project to drill into its detailed revenue tab where you can see individual milestones and manage invoicing.",
      },
    ],
  },
  {
    id: "admin-roles-permissions",
    title: "Admin — Roles & Permissions",
    description: "Learn how to manage user roles and configure granular permissions for sections, entities, and project detail tabs.",
    category: "admin",
    estimatedMinutes: 7,
    steps: [
      {
        stepNumber: 1,
        title: "Open Roles & Permissions",
        description: "Navigate to 'Roles & Permissions' under the ADMIN section. This shows all configured roles and their access settings.",
        targetPage: "/admin/roles",
      },
      {
        stepNumber: 2,
        title: "Understand the Permission Model",
        description: "The system has 33 permission entities: 7 original entities (users, projects, etc.), 11 section-level keys (Cockpit, Projects, Money, Delivery, Governance, Information, Admin), and 15 project detail tab permissions (pd_overview, pd_plan, pd_finance, etc.).",
        tip: "Section-level permissions control sidebar navigation visibility. PD tab permissions control which tabs a role can see within a project detail page.",
      },
      {
        stepNumber: 3,
        title: "Create a New Role",
        description: "Click 'Create Role' to define a new role. Give it a label (display name) and a key (system identifier). The role starts with default permissions that you can then customize.",
      },
      {
        stepNumber: 4,
        title: "Toggle Section Access",
        description: "For each role, toggle which main sections they can access using the section badges (Cockpit, Projects, Money, Delivery, Governance, Information, Admin). Disabling a section hides it from the sidebar for users with that role.",
      },
      {
        stepNumber: 5,
        title: "Configure Entity Permissions",
        description: "Expand a role to see detailed entity permissions. Each entity has 4 actions: View, Create, Edit, Delete. Toggle each one to control what users with this role can do.",
      },
      {
        stepNumber: 6,
        title: "Set Project Detail Tab Visibility",
        description: "The 'Project Detail Tabs' section controls which tabs (Overview, Plan, Finance, Engineering, Quality, History, and sub-tabs) are visible for each role. Disable tabs to restrict what information role holders can see.",
      },
      {
        stepNumber: 7,
        title: "Assign Roles to Users",
        description: "In the User Management section at the bottom, assign roles to individual users. Each user gets one role that determines all their permissions. Role changes take effect on their next login.",
      },
    ],
  },
  {
    id: "admin-phase-templates",
    title: "Admin — Phase Templates (Engineering Stages)",
    description: "Learn how to configure the 5-stage engineering checklist templates including tasks, deliverables, and gate rules.",
    category: "admin",
    estimatedMinutes: 6,
    steps: [
      {
        stepNumber: 1,
        title: "Open Phase Templates",
        description: "Navigate to 'Phase Templates' under ADMIN. This shows the 5 engineering stage templates that define the checklist structure for all projects.",
        targetPage: "/admin/phase-templates",
      },
      {
        stepNumber: 2,
        title: "Understand the 5 Stages",
        description: "The system has 5 standard stages: First Assessment, Cost Proposal, IFC Planning, Construction Support, and Handover Pack. Each maps to specific lifecycle phases.",
      },
      {
        stepNumber: 3,
        title: "Edit Template Tasks",
        description: "Click on a stage template to see its tasks. Add, edit, or remove tasks. Each task has: name, description, whether it's required, sort order, and RACI assignments (who is Responsible, Accountable, Consulted, Informed).",
      },
      {
        stepNumber: 4,
        title: "Manage Deliverables",
        description: "Each stage has required deliverables — documents that must be uploaded before the stage can be completed. Configure the deliverable name, description, and required flag.",
      },
      {
        stepNumber: 5,
        title: "Configure Gate Rules",
        description: "Gate rules determine what's needed to complete a stage: requireAllTasks (all tasks must be checked), requireQaApproval (QA Review must approve), requireTechSignoff (Technical Signoff needed). Set these per template.",
        tip: "Gate rules can be overridden by the COO with a mandatory reason, which is logged to the audit trail.",
      },
      {
        stepNumber: 6,
        title: "Phase-to-Stage Mapping",
        description: "Review which lifecycle phases trigger which engineering stages. Moving a project to 'Construction' auto-creates 'IFC Planning' + 'Construction Support' stages, for example.",
      },
    ],
  },
  {
    id: "admin-data-import",
    title: "Admin — Legacy Data Import & Maintenance",
    description: "Learn about the legacy data import tools, system smoke tests, and maintenance utilities.",
    category: "admin",
    estimatedMinutes: 4,
    steps: [
      {
        stepNumber: 1,
        title: "Open the Admin Page",
        description: "Navigate to 'Data Import' under ADMIN. This shows legacy import tools and system maintenance options.",
        targetPage: "/admin",
      },
      {
        stepNumber: 2,
        title: "Folder-Based Import (Legacy)",
        description: "The folder import tool processes multiple Excel tracker files from a server directory. This was the original import method before Smart Import — it's still available for bulk initial loads.",
        tip: "For regular project updates, use Smart Import instead. It gives you more control over column mapping and issue resolution.",
      },
      {
        stepNumber: 3,
        title: "Run a System Smoke Test",
        description: "The smoke test verifies that all major system components are working: database connections, API endpoints, data integrity checks, and calculation engines.",
      },
      {
        stepNumber: 4,
        title: "Maintenance — Clear Data",
        description: "The maintenance section allows admins to clear all project data for a fresh start. This is destructive and irreversible — use with extreme caution.",
        tip: "Data clearing requires admin or COO access and includes a confirmation step to prevent accidental deletion.",
      },
    ],
  },
  {
    id: "invoice-patterns",
    title: "Invoice Pattern Recognition",
    description: "Learn how the system automatically learns and maps supplier invoice formats for faster data entry.",
    category: "operations",
    estimatedMinutes: 3,
    steps: [
      {
        stepNumber: 1,
        title: "Open Invoice Patterns",
        description: "Navigate to 'Invoice Patterns' in the sidebar. This shows the system's learned patterns for recognizing supplier invoice formats.",
        targetPage: "/invoice-patterns",
      },
      {
        stepNumber: 2,
        title: "Review Learned Patterns",
        description: "The system automatically detects patterns in invoice numbers, PO formats, and supplier naming conventions. Each pattern shows the supplier, format detected, and how many times it's been seen.",
      },
      {
        stepNumber: 3,
        title: "Manage Pattern Rules",
        description: "You can edit, disable, or delete patterns. If a pattern is incorrectly matching, disable it to prevent wrong auto-fills.",
      },
    ],
  },
  {
    id: "change-audit-log",
    title: "Change Audit Log",
    description: "View the system-wide audit log of all manual and automated changes across the entire platform.",
    category: "admin",
    estimatedMinutes: 3,
    steps: [
      {
        stepNumber: 1,
        title: "Open the Activity Log",
        description: "Navigate to 'Change Audit' under ADMIN. This shows a system-wide chronological log of every data change.",
        targetPage: "/admin/activity-log",
      },
      {
        stepNumber: 2,
        title: "Filter Changes",
        description: "Filter by project, user, date range, or change type. This helps you quickly find specific modifications when investigating data issues.",
      },
      {
        stepNumber: 3,
        title: "Read Change Details",
        description: "Each entry shows: timestamp, user, project affected, what changed (field name), old value, new value, and the source (manual edit, import, system calculation). All entries are immutable.",
      },
    ],
  },
  {
    id: "project-subcontractors-tab",
    title: "Project Detail — Subcontractors Tab",
    description: "Track supplier-specific spend, turnaround times, and performance for individual project subcontractors.",
    category: "operations",
    estimatedMinutes: 4,
    steps: [
      {
        stepNumber: 1,
        title: "Open the Subcontractors Sub-Tab",
        description: "On a project detail page, click 'Money' tab, then 'Subcontractors'. This shows supplier-level cost analysis for this project.",
      },
      {
        stepNumber: 2,
        title: "Review Supplier Spend",
        description: "Each subcontractor row shows: total awarded amount, invoiced to date, paid to date, and outstanding balance. This gives a quick picture of supplier financial status.",
      },
      {
        stepNumber: 3,
        title: "Check Turnaround Analysis",
        description: "The turnaround analysis shows how long each supplier takes from invoice submission to payment confirmation. This helps identify slow-paying relationships.",
      },
      {
        stepNumber: 4,
        title: "Link to Portfolio View",
        description: "Click through to the Procurement Dashboard to see this supplier's performance across all projects, not just this one.",
        targetPage: "/subcontractor-dashboard",
      },
    ],
  },
  {
    id: "project-engineering-tasks-tab",
    title: "Project Detail — Engineering Tasks Tab",
    description: "View and manage engineering tasks that are auto-generated when a project moves past Phase 1.",
    category: "engineering",
    estimatedMinutes: 4,
    steps: [
      {
        stepNumber: 1,
        title: "Open the Engineering Tasks Tab",
        description: "On a project detail page, click 'Engineering' tab, then 'Eng Tasks'. This shows engineering tasks specific to this project.",
      },
      {
        stepNumber: 2,
        title: "Auto-Generated Tasks",
        description: "When a project moves past Phase 1 (Cost Proposal) on the Lifecycle Board, engineering tasks are automatically created based on the standard task templates.",
        tip: "If no tasks exist yet, you'll see a 'Generate Engineering Tasks' button to create them manually.",
      },
      {
        stepNumber: 3,
        title: "Track Task Progress",
        description: "Each task shows its status, assigned engineer, priority, and due date. Update progress directly from this tab or from the main Engineering Task Board.",
      },
      {
        stepNumber: 4,
        title: "Navigate to Full Task Board",
        description: "Click any task to open it in the full Engineering Task Board where you have more editing options and can see cross-project context.",
        targetPage: "/engineering/tasks",
      },
    ],
  },
  {
    id: "project-gantt-chart",
    title: "Project Detail — Gantt Chart",
    description: "Use the interactive Gantt chart to visualize project schedules, dependencies, and critical path.",
    category: "project-management",
    estimatedMinutes: 5,
    steps: [
      {
        stepNumber: 1,
        title: "Open the Gantt Sub-Tab",
        description: "On a project detail page, click 'Plan' tab, then 'Gantt'. The interactive Gantt chart loads showing all plan tasks on a timeline.",
      },
      {
        stepNumber: 2,
        title: "Zoom and Navigate",
        description: "Use the zoom controls to switch between day, week, and month views. Scroll horizontally to navigate through the project timeline. The today line shows the current date.",
      },
      {
        stepNumber: 3,
        title: "View Task Dependencies",
        description: "Lines between task bars show dependencies. These help visualize which tasks must finish before others can start, forming the logical sequence of work.",
      },
      {
        stepNumber: 4,
        title: "Identify Critical Path",
        description: "Critical path tasks are highlighted in a distinct color. Any delay to these tasks directly delays the project completion date. Focus attention on keeping these on schedule.",
      },
      {
        stepNumber: 5,
        title: "Check Progress",
        description: "Each task bar shows completion percentage with a filled portion. Compare actual progress against the planned timeline to identify tasks falling behind.",
      },
    ],
  },
  {
    id: "project-key-dates",
    title: "Project Detail — Key Dates",
    description: "Track and manage critical project milestones and handover dates.",
    category: "project-management",
    estimatedMinutes: 3,
    steps: [
      {
        stepNumber: 1,
        title: "Find Key Dates",
        description: "Key dates appear on the project awareness bar at the top of the project detail page and in the Overview tab. These are the critical milestones that define project timeline.",
      },
      {
        stepNumber: 2,
        title: "Understand the Key Dates",
        description: "Five key dates are tracked: PD Handover Date, Construction Start Date, Commissioning Date, OM Handover Date, and Client Handover Date. These are extracted from the Excel tracker during import.",
      },
      {
        stepNumber: 3,
        title: "Impact on Lifecycle",
        description: "Key dates influence lifecycle phase transitions. For example, Construction Start Date should align with when the project moves to the Construction phase on the Lifecycle Board.",
      },
    ],
  },
  {
    id: "weekly-reviews-page",
    title: "Weekly Reviews Management Page",
    description: "Learn how to view, track, and manage weekly project reviews from the dedicated management page.",
    category: "governance",
    estimatedMinutes: 4,
    steps: [
      {
        stepNumber: 1,
        title: "Open the Weekly Reviews Page",
        description: "Navigate to 'Weekly Reviews' in the sidebar. This shows all submitted weekly reviews across projects with their status.",
        targetPage: "/weekly-reviews",
      },
      {
        stepNumber: 2,
        title: "Track Submission Status",
        description: "See which projects have submitted their weekly review and which are overdue. Projects highlighted in red haven't reported this week.",
      },
      {
        stepNumber: 3,
        title: "Read Review Summaries",
        description: "Click on any review to read the full report including schedule status, budget assessment, risks, quality notes, and the PM's summary message.",
      },
      {
        stepNumber: 4,
        title: "Historical Review Archive",
        description: "Browse past weeks' reviews to track how project health has evolved over time. This provides a compliance record of regular project oversight.",
      },
    ],
  },
  {
    id: "ee-info-knowledge-base",
    title: "EE Info — Knowledge Base & Walkthroughs",
    description: "Explore the company knowledge base with interactive graphs, detailed articles, process flows, and step-by-step walkthroughs.",
    category: "productivity",
    estimatedMinutes: 5,
    steps: [
      {
        stepNumber: 1,
        title: "Open EE Info",
        description: "Navigate to 'EE Info' in the sidebar. This opens the company knowledge base — a wiki-style system covering all processes, roles, and tools.",
        targetPage: "/ee-info",
      },
      {
        stepNumber: 2,
        title: "Browse the Graph View",
        description: "The Graph tab shows an interactive network diagram of all knowledge nodes and their connections. Click nodes to explore relationships between processes, roles, and tools.",
      },
      {
        stepNumber: 3,
        title: "Read Detailed Articles",
        description: "Switch to the Detail tab to browse articles in list form. Each article covers a specific topic: a role, process, tool, or governance rule. Use search to find specific topics.",
      },
      {
        stepNumber: 4,
        title: "View Process Flows",
        description: "The Flow tab shows visual process flows — step-by-step diagrams of how key business processes work. These are useful for understanding how things connect.",
      },
      {
        stepNumber: 5,
        title: "Use Interactive Walkthroughs",
        description: "The Walkthroughs tab contains step-by-step guides for every feature in the app. Pick a walkthrough, follow the numbered steps, and track your progress with checkboxes. 'Go to page' buttons take you directly to the relevant screen.",
      },
    ],
  },
  {
    id: "email-to-task",
    title: "Converting Emails to Tasks (Outlook Integration)",
    description: "Learn how to convert Outlook emails into actionable tasks using drag-and-drop in My Tool.",
    category: "productivity",
    estimatedMinutes: 4,
    steps: [
      {
        stepNumber: 1,
        title: "Open My Tool — Today View",
        description: "Navigate to 'My Tool' in the sidebar. The Today view shows your daily tasks and has the Outlook email integration panel.",
        targetPage: "/my-tool/today",
      },
      {
        stepNumber: 2,
        title: "View Your Outlook Emails",
        description: "The email panel shows your recent Outlook emails synced via the Microsoft Graph API integration. Emails appear with subject, sender, and preview.",
      },
      {
        stepNumber: 3,
        title: "Drag Email to Create Task",
        description: "Drag any email from the email panel onto your task list. The system creates a new task with the email subject as the title and the email content as the description.",
      },
      {
        stepNumber: 4,
        title: "Edit and Prioritize",
        description: "After creating the task, edit it to set the right priority, assign it to a project, set a due date, and add any additional notes.",
        tip: "Use Quick Add (the text input at the top) for even faster task creation — just type a description and it parses key details automatically.",
      },
    ],
  },
  {
    id: "execution-cockpit",
    title: "Execution Board & KPI Dashboard",
    description: "Use the execution dashboard to see high-level KPIs, project health indicators, and portfolio-level metrics.",
    category: "project-management",
    estimatedMinutes: 4,
    steps: [
      {
        stepNumber: 1,
        title: "Open the Execution Board",
        description: "Navigate to 'Execution Board' under PROJECT MANAGEMENT. This shows the high-level executive dashboard with portfolio KPIs.",
        targetPage: "/dashboard",
      },
      {
        stepNumber: 2,
        title: "Review Portfolio KPIs",
        description: "The top section shows aggregated KPIs across all projects: total contract value, total COS, budget variance, schedule performance, and project count by phase.",
      },
      {
        stepNumber: 3,
        title: "Identify At-Risk Projects",
        description: "The dashboard highlights projects with red RAG status, budget overruns, or schedule delays. These need immediate management attention.",
      },
      {
        stepNumber: 4,
        title: "Drill Down to Project Details",
        description: "Click any project in the dashboard to open its full detail page for deeper investigation and action.",
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
  "productivity": { label: "Productivity", color: "bg-teal-100 text-teal-700 border-teal-200" },
  "admin": { label: "Admin", color: "bg-gray-100 text-gray-700 border-gray-200" },
};
