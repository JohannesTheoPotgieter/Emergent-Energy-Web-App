export interface ScreenTourStep {
  targetSelector?: string;
  title: string;
  description: string;
  position?: "top" | "bottom" | "left" | "right" | "center";
}

export interface ScreenTourDef {
  id: string;
  title: string;
  steps: ScreenTourStep[];
}

export const SCREEN_TOURS: Record<string, ScreenTourDef> = {
  "/": {
    id: "home",
    title: "Home Dashboard",
    steps: [],
  },

  "/execution-board": {
    id: "execution-dashboard",
    title: "Execution Dashboard",
    steps: [
      {
        title: "Execution Dashboard",
        description: "Your consolidated post-handover execution view. See KPIs, action queues, project portfolio, and financial health for the current financial year.",
        position: "center",
      },
      {
        targetSelector: '[data-testid="btn-methodology"]',
        title: "Data Methodology",
        description: "Click 'Show Methodology' to see exactly how each metric is calculated, which database tables are used, and what time ranges apply. Builds trust in the numbers.",
        position: "bottom",
      },
      {
        targetSelector: '[data-testid="filter-toggle-behindPlanOnly"]',
        title: "Quick Filters",
        description: "Use toggle filters to quickly isolate projects with specific issues — behind plan, inflow risk, engineering blockers, quality issues, or stale imports.",
        position: "bottom",
      },
      {
        targetSelector: '[data-testid="tab-view-coo"]',
        title: "Role-Based Views",
        description: "Switch between COO, Program, Finance, and Construction views. Each lens shows role-specific summary cards and filters the action center to relevant queues.",
        position: "bottom",
      },
    ],
  },

  "/projects": {
    id: "projects-summary",
    title: "Project Summary",
    steps: [
      {
        title: "Project Summary",
        description: "This page lists all projects with their key metrics. You can search, filter, and click into any project for full details.",
        position: "center",
      },
      {
        targetSelector: '[data-testid="input-search-tasks"]',
        title: "Search Projects",
        description: "Type a project name or keyword to quickly filter the list. Searches across project names, phases, and PM names.",
        position: "bottom",
      },
      {
        title: "Project Cards",
        description: "Each project card shows: progress (actual vs expected), current phase, assigned PM, financial summary, and a stale data warning if the last import was over 14 days ago. Click any card to open the full project detail page.",
        position: "center",
      },
    ],
  },

  "/engineering": {
    id: "engineering-dashboard",
    title: "Engineering Dashboard",
    steps: [
      {
        title: "Engineering Dashboard",
        description: "Your engineering command centre. See all project stages, task assignments, deliverables, and blockers in one place.",
        position: "center",
      },
      {
        targetSelector: '[data-testid="standup-kpi-strip"]',
        title: "KPI Strip",
        description: "Quick stats showing total tasks, completed tasks, overdue items, and pending deliverables. These numbers update in real-time as work progresses.",
        position: "bottom",
      },
      {
        targetSelector: '[data-testid="project-health-grid"]',
        title: "Project Health Grid",
        description: "Each card represents a project with its engineering health status. Green means on track, amber means at risk, red means blockers. Click any card to see its engineering stages.",
        position: "bottom",
      },
      {
        targetSelector: '[data-testid="section-workload"]',
        title: "Workload Table",
        description: "See task distribution across team members. Identifies who is overloaded and who has capacity. Helps balance engineering assignments.",
        position: "top",
      },
      {
        targetSelector: '[data-testid="toggle-standup-mode"]',
        title: "Standup Mode",
        description: "Toggle standup mode for daily standups. It focuses the view on today's priorities, blockers, and what was completed yesterday.",
        position: "bottom",
      },
      {
        targetSelector: '[data-testid="section-pipeline"]',
        title: "Engineering Pipeline",
        description: "Track projects through the 5 engineering stages: First Assessment, Cost Proposal, IFC Planning, Construction Support, and Handover Pack.",
        position: "top",
      },
    ],
  },

  "/quality": {
    id: "quality-dashboard",
    title: "Quality Management",
    steps: [
      {
        title: "Quality Management",
        description: "Monitor quality across all projects. Track checklists, gate approvals, warnings, and QM scores from this central dashboard.",
        position: "center",
      },
      {
        targetSelector: '[data-testid="stat-total-projects"]',
        title: "Quality Stats",
        description: "Key metrics at a glance: total projects with quality tracking, completed checklists, active warnings, and average QM score across the portfolio.",
        position: "bottom",
      },
      {
        targetSelector: '[data-testid="input-qm-search"]',
        title: "Search & Filter",
        description: "Search for specific projects or filter by quality status. Find projects with warnings or incomplete checklists quickly.",
        position: "bottom",
      },
      {
        targetSelector: '[data-testid="btn-start-quality-process"]',
        title: "Start Quality Process",
        description: "Initiate the quality management process for a project. This creates the QM checklist and begins tracking quality gates.",
        position: "bottom",
      },
    ],
  },

  "/cos": {
    id: "cos-tracker",
    title: "COS Control",
    steps: [
      {
        title: "Cost of Sales Control",
        description: "Track the Cost of Sales across all projects. Compare Costed (budget) vs Actual (spent) amounts to identify overruns and savings.",
        position: "center",
      },
      {
        targetSelector: '[data-testid="table-cos-grid"]',
        title: "COS Overview",
        description: "Each row shows a project with its contract value, costed total, actual total, variance, and COS percentage. Red variance means over-budget, green means under-budget.",
        position: "center",
      },
      {
        targetSelector: '[data-testid="select-fy-filter"]',
        title: "Financial Year Filter",
        description: "Filter by financial year (September to August). See how costs track across different reporting periods.",
        position: "bottom",
      },
      {
        targetSelector: '[data-testid="input-cos-search"]',
        title: "Search Projects",
        description: "Find specific projects by name. Useful when you need to drill into a particular project's cost breakdown.",
        position: "bottom",
      },
      {
        title: "Exception Highlighting",
        description: "Variance cells are colour-coded: standard red/green within ±15%, amber for ±15-25%, and dark red beyond ±25%. This makes it easy to spot projects that need urgent attention.",
        position: "center",
      },
    ],
  },

  "/cashflow": {
    id: "cashflow",
    title: "Cashflow Tracker",
    steps: [
      {
        title: "Cashflow Tracker",
        description: "Track weekly cashflow across projects. See inflows, outflows, and net position to manage liquidity and forecast future cash needs.",
        position: "center",
      },
      {
        targetSelector: '[data-testid="kpi-summary-row"]',
        title: "KPI Summary",
        description: "Top-level cashflow metrics: total inflows, total outflows, net position, and outstanding receivables. These update based on your selected filters.",
        position: "bottom",
      },
      {
        targetSelector: '[data-testid="select-project-filter"]',
        title: "Project Filter",
        description: "Filter cashflow data by project. Select a specific project to see its individual cashflow breakdown, or view all projects combined.",
        position: "bottom",
      },
      {
        targetSelector: '[data-testid="card-trend-chart"]',
        title: "Trend Chart",
        description: "Visual representation of cashflow trends over time. See patterns in inflows and outflows to identify potential cash crunches before they happen.",
        position: "top",
      },
      {
        targetSelector: '[data-testid="card-weekly-grid"]',
        title: "Weekly Grid",
        description: "Detailed weekly breakdown showing actual payments and receipts. Each cell is clickable for drill-down details.",
        position: "top",
      },
    ],
  },

  "/lifecycle-board": {
    id: "lifecycle-board",
    title: "Company Life Cycle",
    steps: [
      {
        title: "Company Life Cycle Board",
        description: "Drag-and-drop board showing all projects across lifecycle phases. Move projects between phases to track their journey from initial assessment to handover.",
        position: "center",
      },
      {
        targetSelector: '[data-testid="input-search-lifecycle"]',
        title: "Search Projects",
        description: "Search for a specific project by name. The board will highlight matching projects across all phase columns.",
        position: "bottom",
      },
      {
        targetSelector: '[data-testid="switch-active-only"]',
        title: "Active Filter",
        description: "Toggle to show only active projects, hiding archived ones. Archived projects are those older than 90 days since their last import.",
        position: "bottom",
      },
      {
        title: "Drag & Drop",
        description: "Drag project cards between columns to change their lifecycle phase. Moving a project automatically triggers engineering stage generation and sends notifications to the team.",
        position: "center",
      },
    ],
  },

  "/admin/smart-import": {
    id: "smart-import",
    title: "Smart Import",
    steps: [
      {
        title: "Smart Import Wizard",
        description: "Upload Excel tracker files to create or update project data. The 5-step wizard guides you through file upload, section detection, column mapping, and final import.",
        position: "center",
      },
      {
        targetSelector: '[data-testid="step-indicator"]',
        title: "Step Progress",
        description: "Track your progress through the 5 import steps: Upload, Detect Sections, Map Columns, Review, and Import. You can go back to any previous step if needed.",
        position: "bottom",
      },
      {
        targetSelector: '[data-testid="upload-step"]',
        title: "Upload Files",
        description: "Drag and drop your Excel tracker files here, or click to browse. The project name comes from the filename — everything before '_Tracker' becomes the project name.",
        position: "bottom",
      },
      {
        title: "Re-run Protection",
        description: "If you've already imported a file, the system warns you before overwriting. It compares the data to prevent duplicate imports and preserves any manual edits you've made.",
        position: "center",
      },
    ],
  },

  "/collaboration": {
    id: "collaboration-hub",
    title: "Collaboration Hub",
    steps: [
      {
        title: "Collaboration Hub",
        description: "All your Microsoft 365 tools and in-app notifications in one place. Switch between Calendar, Email, Teams Chat, SharePoint, and Notifications using the tabs.",
        position: "center",
      },
      {
        targetSelector: '[data-testid="tab-calendar"]',
        title: "Calendar Tab",
        description: "View your Outlook calendar events. Switch between weekly and daily views, navigate between weeks, and see meeting details including time, location, and attendees.",
        position: "bottom",
      },
      {
        targetSelector: '[data-testid="tab-email"]',
        title: "Email Tab",
        description: "Read your Outlook inbox right here. Search emails, switch folders, and click any email to read the full content. Supports pagination for large inboxes.",
        position: "bottom",
      },
      {
        targetSelector: '[data-testid="tab-teams"]',
        title: "Teams Chat Tab",
        description: "See your Teams channels and group chats. Click any channel to open the full Teams Chat experience. Department and project channels are shown separately.",
        position: "bottom",
      },
      {
        targetSelector: '[data-testid="tab-sharepoint"]',
        title: "SharePoint Tab",
        description: "Browse your SharePoint document library. Navigate folders, preview files, download documents, or open them directly in SharePoint.",
        position: "bottom",
      },
      {
        targetSelector: '[data-testid="tab-notifications"]',
        title: "Notifications Tab",
        description: "All your in-app notifications: task assignments, approval requests, plan changes, and project updates. Filter by unread or action-required. Confirm plan changes directly here.",
        position: "bottom",
      },
    ],
  },

  "/portfolios": {
    id: "portfolios",
    title: "Portfolio Dashboard",
    steps: [
      {
        title: "Portfolio Dashboard",
        description: "Group related projects under portfolios for better oversight. Create portfolios, assign projects, and track aggregated financial and progress metrics.",
        position: "center",
      },
      {
        targetSelector: '[data-testid="button-create-portfolio"]',
        title: "Create Portfolio",
        description: "Create a new portfolio by giving it a name, assigning a client, and selecting an owner. Portfolios help you organise projects by client, region, or programme.",
        position: "bottom",
      },
      {
        targetSelector: '[data-testid="input-search-portfolios"]',
        title: "Search Portfolios",
        description: "Filter portfolios by name or client. Quick way to find a specific grouping when you have many portfolios.",
        position: "bottom",
      },
      {
        title: "Portfolio Cards",
        description: "Each card shows aggregated metrics: total projects, combined revenue, expenditure, and completion percentage. Click a portfolio to see its detail page with project-level breakdowns.",
        position: "center",
      },
    ],
  },

  // /pm-dashboard redirects to /execution-board — tour is on that page

  "/leaderboard": {
    id: "leaderboard",
    title: "Leaderboard",
    steps: [
      {
        title: "Leaderboard & Gamification",
        description: "Track team performance through points, badges, and levels. Earn points for completing tasks, approving deliverables, and making imports. Lose points for overdue items.",
        position: "center",
      },
      {
        targetSelector: '[data-testid="card-my-stats"]',
        title: "Your Stats",
        description: "Your current level, total points, rank position, and badge collection. See how you compare to the rest of the team.",
        position: "bottom",
      },
      {
        targetSelector: '[data-testid="tab-leaderboard"]',
        title: "Rankings",
        description: "See everyone's ranking sorted by points. Top performers earn special badges and bragging rights. Healthy competition keeps the team motivated.",
        position: "bottom",
      },
      {
        targetSelector: '[data-testid="tab-badges"]',
        title: "Badge Collection",
        description: "View all available badges and which ones you've earned. Badges are awarded for milestones like completing 10 tasks, making your first import, or reaching a new level.",
        position: "bottom",
      },
    ],
  },

  "/notifications": {
    id: "notification-center",
    title: "Notification Center",
    steps: [
      {
        title: "Notification Center",
        description: "All your notifications in one place. See task assignments, approval requests, plan changes, deadline warnings, and project updates.",
        position: "center",
      },
      {
        title: "Notification Types",
        description: "Notifications are colour-coded by type: blue for task assignments, amber for plan changes needing confirmation, purple for approval requests, red for warnings and overdue items.",
        position: "center",
      },
      {
        title: "Actions",
        description: "Mark notifications as read individually or all at once. For plan change confirmations, click 'Confirm' to acknowledge the change — this also auto-confirms related notifications.",
        position: "center",
      },
    ],
  },

  "/teams/chats": {
    id: "teams-chats",
    title: "Teams Chat",
    steps: [
      {
        title: "Teams Chat",
        description: "Microsoft Teams-style chat system. Create department or project channels, send messages, share files, and manage team members.",
        position: "center",
      },
      {
        title: "Channels",
        description: "The left sidebar shows your channels organised by type. Department channels are for cross-project communication, project channels are for specific project discussions.",
        position: "center",
      },
      {
        title: "Messages & Files",
        description: "Send text messages and share files up to 25MB. Messages show timestamps, avatars, and file attachments with inline image previews. Use the members panel to manage channel participants.",
        position: "center",
      },
    ],
  },

  "/ee-info": {
    id: "ee-info",
    title: "EE Info & Walkthroughs",
    steps: [
      {
        title: "EE Info Knowledge Base",
        description: "Your central knowledge hub. Browse the operating system map, access process templates, and follow step-by-step walkthroughs for every feature in the application.",
        position: "center",
      },
      {
        title: "Operating System Map",
        description: "Visual overview of all company processes. Drill down from lifecycle overview to department-level processes to individual SOPs. Each process node includes detailed steps and responsible roles.",
        position: "center",
      },
      {
        title: "Walkthroughs",
        description: "37 interactive guides covering every major feature — from Smart Import and COS Tracking to Weekly Reviews and Engineering Tasks. Each walkthrough has step-by-step instructions with tips.",
        position: "center",
      },
    ],
  },

  "/weekly-reviews": {
    id: "weekly-reviews",
    title: "Weekly Reviews",
    steps: [
      {
        title: "Weekly Reviews",
        description: "Structured weekly project reviews. Each review captures progress updates, blockers, decisions made, and action items for the coming week.",
        position: "center",
      },
      {
        title: "Review Wizard",
        description: "The wizard guides you through each project that needs a review. Answer questions about progress, flag any blockers, and the system automatically generates the review summary.",
        position: "center",
      },
    ],
  },

  "/my-tool": {
    id: "my-tool",
    title: "My Work",
    steps: [
      {
        title: "My Work — Today",
        description: "Your personal productivity hub. See today's tasks, meetings, priorities, and quick actions. Everything you need to start your day effectively.",
        position: "center",
      },
      {
        title: "Task List",
        description: "Tasks assigned to you sorted by priority. Overdue tasks are highlighted in red at the top. Click any task to see details, update status, or add notes.",
        position: "center",
      },
      {
        title: "Quick Actions",
        description: "Common actions like creating tasks from emails, starting a timer, or jumping to your most recent project. Designed to save you clicks on things you do every day.",
        position: "center",
      },
    ],
  },

  "/subcontractor-dashboard": {
    id: "subcontractor-dashboard",
    title: "Subcontractor Dashboard",
    steps: [
      {
        title: "Subcontractor Dashboard",
        description: "Track subcontractor performance across all projects. See delivery records, compliance status, and payment history for each subcontractor.",
        position: "center",
      },
      {
        title: "Performance Metrics",
        description: "Each subcontractor card shows on-time delivery rate, quality scores, compliance documents, and total contract value. Use these metrics for future procurement decisions.",
        position: "center",
      },
    ],
  },

  "/admin/roles": {
    id: "admin-roles",
    title: "Admin Roles & Permissions",
    steps: [
      {
        title: "Roles & Permissions",
        description: "Manage who can access what. Configure role-based permissions, project detail access levels, and user assignments across the platform.",
        position: "center",
      },
      {
        title: "Role Permissions Tab",
        description: "Set view, create, edit, and delete permissions for each role across all modules — from projects and engineering to finance and collaboration.",
        position: "center",
      },
      {
        title: "User Management Tab",
        description: "Assign roles to users, manage their project access, and control which features they can see. Changes take effect immediately.",
        position: "center",
      },
    ],
  },
};

export function getScreenTour(pathname: string): ScreenTourDef | null {
  if (SCREEN_TOURS[pathname]) {
    const tour = SCREEN_TOURS[pathname];
    if (tour.steps.length === 0) return null;
    return tour;
  }

  if (pathname.startsWith("/project/")) {
    return {
      id: "project-detail",
      title: "Project Detail",
      steps: [
        {
          title: "Project Detail Page",
          description: "Everything about this project in one place. Navigate between pillars — Project Management, Engineering, Quality, and Collaboration — using the section tabs.",
          position: "center",
        },
        {
          title: "Overview Section",
          description: "The overview shows pillar summary cards, financial integration panel, expenditure breakdown, and project plan progress. It's your starting point for understanding project health.",
          position: "center",
        },
        {
          title: "Project Management Pillar",
          description: "Access the project plan (Gantt chart), revenue tracking, expenditure breakdown, and task management. Edit task statuses, dates, and assignees inline.",
          position: "center",
        },
        {
          title: "Engineering Pillar",
          description: "Track the 5 engineering stages from First Assessment to Handover Pack. Each stage has a checklist, deliverables, and approval workflow. Stage gates must be completed before moving forward.",
          position: "center",
        },
        {
          title: "Quality Pillar",
          description: "Quality checklists, gate reviews, and warning management for this project. Complete quality gates to ensure standards are met before moving to the next phase.",
          position: "center",
        },
        {
          title: "Collaboration Pillar",
          description: "Project-specific chat, SharePoint files, approvals and deliverables, and notifications — all scoped to this project. Keep communication focused and trackable.",
          position: "center",
        },
      ],
    };
  }

  if (pathname.startsWith("/portfolios/")) {
    return {
      id: "portfolio-detail",
      title: "Portfolio Detail",
      steps: [
        {
          title: "Portfolio Detail",
          description: "Deep dive into this portfolio. See all assigned projects, aggregated financials, quality rollups, engineering progress, and rollout plans.",
          position: "center",
        },
        {
          title: "Portfolio Tabs",
          description: "Switch between Projects, Finance, Quality, Engineering, and Rollout Plan tabs. Each shows rollup metrics computed from the underlying project data.",
          position: "center",
        },
        {
          title: "Financial Summary",
          description: "Aggregated Costed vs Actual financials across all projects in this portfolio. Recharts visualizations show revenue and expenditure trends.",
          position: "center",
        },
      ],
    };
  }

  return null;
}
