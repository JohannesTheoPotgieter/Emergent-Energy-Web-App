# Emergent Energy Dashboard — Release Notes

## Version 1.4.0 (02 March 2026)

**Canonical Data Migration & Excel Tracker Sync** — All dashboards now read from a single source of truth, eliminating inconsistencies between screens. A new Excel Updates page gives managers full visibility into changes that need syncing back to Excel trackers.

---

### Data Consistency — Canonical Work Items

- **Single Source of Truth**: All plan task reads now come from the unified `work_items` table instead of multiple legacy tables (`normalized_plan_tasks`, `project_plan`). This resolves the issue where portfolio progress showed different percentages than individual project plan tabs.
- **Startup Backfill**: On every server start, all `normalized_plan_tasks` are automatically synced into `work_items` with correct parent/child relationships and user assignments (idempotent, safe to re-run).
- **Rollup Consistency**: The planning-tasks endpoint now applies the same weighted-average rollup logic (hierarchy, expected %, delta, plan status) whether reading from legacy or canonical data.
- **Migrated Endpoints**:
  - Portfolio Summary — progress calculations
  - Planning Tasks — full rollup pipeline with hierarchy
  - My Work — personal task aggregation
  - PM On-The-Go — schedule and progress queries
  - Gamification — task completion counts and behind-schedule metrics
  - Milestone Notifications — commissioning date and schedule alerts

### Excel Updates Page (New)

- **Dedicated Screen**: New "Excel Updates" page under Project Management in the sidebar, providing a clear view of all changes that need to be captured in Excel trackers.
- **Pending / Confirmed Tabs**: Quickly see which updates are still waiting for confirmation and which have been marked as done.
- **Project Filter**: Narrow down by project name to focus on specific projects.
- **One-Click Confirm**: Mark updates as confirmed directly from the page.
- **Targeted Notifications**: Excel sync notifications are sent only to Programme Manager, Programme Finance Manager, and Construction Manager roles.

### Comprehensive Excel Sync Coverage

- **Project Data Edits**: Summary fields, latest updates, escalation levels, PM assignments, project info changes, and plan task overrides now all trigger Excel sync notifications.
- **Financial Edits**: Cashflow planning overrides, revenue tracking overrides, expenditure overrides, expense line additions, task-to-expense conversions, and COS/revenue finance overrides are all covered.
- **Full Coverage**: Combined with existing engineering, quality, and PM On-The-Go notifications, every manual frontend change on a project now generates an Excel update notification.

### Database Migration Improvements

- **Auto-Drop Foreign Keys**: The archive process now automatically drops foreign key constraints pointing to legacy tables before archiving, eliminating the "active references" blocker.
- **Backup Registration Fix**: Fixed an error when registering migration backups where undefined user properties caused a crash.

---

## Version 1.0.0 (28 February 2026)

**First production release** of the Emergent Energy Dashboard — a comprehensive project management, engineering operations, and cross-department collaboration platform for renewable energy projects.

---

### Project Management

- **Project Lifecycle Board**: Track projects from First Assessment through to Handover with drag-and-drop phase management
- **Execution Board**: Real-time operational dashboard showing active projects, progress, and key metrics
- **PM Dashboard**: View-only project oversight for programme managers with portfolio-level visibility
- **Project Detail Pages**: Section-based navigation with four pillars — Project Management, Engineering, Quality, and Collaboration
- **Portfolio Management**: Group projects under portfolios with client association, four dashboard view modes (PM, Finance, Quality, Engineering), and rollup metrics
- **Smart Excel Import**: 5-step wizard with re-run protection, font color extraction for status fields, and automatic data processing from Excel trackers
- **Project Creation**: COO/CEO can create new projects with auto-generated engineering stage templates
- **TR Register**: Cross-project action item tracking across departments

### Timeline & Planning

- **Project Plan Import**: Full task hierarchy imported from Excel trackers with milestone management
- **Portfolio Gantt Chart**: Two-layer progress bars, commissioning markers, slippage warnings, hover tooltips, sort controls, phase/PM filters, and summary footer
- **Plan Structuring**: Hierarchical milestones with Create, Group, Convert, and Ungroup operations; auto-computed rollup values
- **Overdue Visual Escalation**: Red borders and "X days overdue" badges on overdue tasks across all views, overdue items sorted to top
- **Plan Change Tracker**: Notifies PM, Finance Manager, and Construction Manager when plan data is edited, with confirmation workflow

### Finance

- **COS Tracker**: Monthly cost-of-sales tracking with variance analysis and three-tier exception highlighting (standard, amber at ±15%, red at ±25%)
- **Cashflow Tracking & Forecasting**: Project-level and programme-level cashflow with planning overrides
- **Revenue Tracking**: Milestone-based invoicing with revenue overrides and "Actual vs Costed" terminology
- **Expenditure Tracking**: Category-based breakdown with dual progress bars, variance, and colour-coded budget alerts
- **Financial Integration Panel**: Per-project financial summary with Actual vs Costed metrics
- **Invoice Pattern Analysis**: Identify invoicing patterns across the programme
- **Subcontractor Dashboard**: Procurement tracking and subcontractor management
- **Financial Year**: September to August across all calculations

### Quality

- **Quality Dashboard**: QA/QC management with template-driven checklists
- **Quality Review Approvals**: Multi-step approval workflow for quality sign-offs
- **Red-Team Inspections**: Dedicated inspection tracking
- **Deliverable Evidence**: File attachments with approval and acknowledgment workflows

### Engineering

- **Engineering Dashboard**: Standup-style task status view across projects
- **Task Board**: Full task lifecycle management with priority, status, and assignment tracking
- **5-Stage Engineering Checklist**: First Assessment, Cost Proposal, IFC Planning, Construction Support, Handover Pack — each with templates, deliverables, and approvals
- **Stage Gating**: Template-defined gate rules with COO override capability
- **Engineering Inbox & Sync**: Pipeline inbox for incoming engineering work with SharePoint synchronisation
- **Deliverable Management**: File attachments with recipients, acknowledgment tracking, and Send for Approval workflow

### Collaboration

- **Teams Chat**: MS Teams-styled channel system with department and project channels, file sharing (25MB limit), inline image preview, and member management
- **Per-Project Collaboration Section**: Chat, SharePoint Files, Approvals & Deliverables, and project-scoped Notifications grouped under one tab
- **Notification Centre**: Action-required notifications with confirmation workflow, mark-read, and filtering
- **Email/Message to Task**: Create project-linked operational tasks directly from Outlook emails or Teams messages
- **Company Priorities**: Shared priority board with severity levels, department assignment, and project linking

### Microsoft 365 Integration

- **SSO Authentication**: Microsoft 365 single sign-on via Azure AD, mapping to existing user accounts
- **Outlook**: Calendar sync, email access, and approval email integration
- **SharePoint**: Document library browsing, file management, and deliverable upload sync
- **Teams**: Message linking to projects, tagging, and hot thread tracking
- **Integration Status**: Consolidated status page for all three services

### Security & Permissions

- **Role-Based Access Control**: 10+ roles (CEO, COO, PM, Engineer, Quality Manager, etc.) with 70+ permission entities
- **Granular Permission System**: View, edit, approve, override, and delete permissions per entity per role
- **Admin Roles Management**: Tab-based UI for Role Permissions, Project Detail Access, and User Management across 9 permission categories
- **API Security**: All endpoints protected with authentication middleware; admin routes require admin role
- **Rate Limiting**: API rate limiting on authentication and sensitive endpoints

### Home & User Experience

- **Action Hub**: Personalised home screen with stat cards, My Tasks, Pending Approvals, Notifications, Company Priorities, and Quick Navigation
- **Priority Queue**: Combined overdue tasks, action-required notifications, and pending approvals sorted by urgency (max 5 items)
- **Quick Navigation**: "Continue with [Project Name]" link to last visited project
- **Stale Data Warning**: Yellow badge on project cards when last import exceeds 14 days
- **Interactive Tutorial**: Spotlight-style onboarding tour for new users highlighting 9 key features, replayable via "Take a Tour" button
- **Role-Based Greetings**: Randomised, role-specific welcome messages (motivational and humorous)
- **Mobile-First Design**: Responsive sidebar, 40px tap targets, anti-zoom form inputs, slim mobile scrollbars
- **EE Info Knowledge Base**: Wiki-style system with Operating System Map, department drilldowns, process SOPs, and 37 interactive walkthroughs

### Gamification

- **Leaderboard**: Points and badge system tracking task completion, approvals, reviews, and imports
- **Penalty System**: Point deductions for overdue tasks, behind-schedule projects, quality failures, and unread notifications
- **8 Progression Levels**: Rookie through Titan with badge awards

### Technical

- **Stack**: React 18 + TypeScript (frontend), Express.js + TypeScript (backend), PostgreSQL + Drizzle ORM (database)
- **UI**: shadcn/ui with Tailwind CSS v4, Recharts for data visualisation
- **Build Versioning**: Frontend detects new deployments and clears client-side cache/session
- **Automated Backfill**: Computed columns auto-populated on startup
- **Auto-Archive**: Projects older than 90 days post-import automatically archived

---

### Known Limitations (V1)

- Real-time updates use polling rather than WebSockets
- No offline/PWA support for field use
- Data export (CSV/PDF) not yet available for finance reports
- Dashboard widgets are fixed layout (no drag-and-drop customisation)

---

*Built for Emergent Energy by the development team. For support, use the Feedback & Support page within the application.*
