# COMPREHENSIVE CODEBASE AUDIT IMPLEMENTATION PLAN

## MISSION
You are tasked with implementing ALL findings from three comprehensive audits of the Emergent Energy Dashboard application. This is a full-stack Next.js/React + Express/PostgreSQL enterprise platform for managing renewable energy projects. Read each audit carefully, then systematically implement every fix, improvement, and feature addition identified. Work through each category methodically, committing working code at each major milestone.

---

## AUDIT 1: SYSTEM ARCHITECTURE AUDIT (SYSTEM_AUDIT.md)

Read the file `SYSTEM_AUDIT.md` in the project root for full details. Key implementation context:

- **Stack**: React 18 + TypeScript, Vite, TanStack React Query, Tailwind CSS v4, shadcn/ui, Recharts frontend. Express.js + TypeScript, Passport.js, JWT auth backend. PostgreSQL with Drizzle ORM (~200+ tables).
- **Core Data Model**: project_info → work_items (canonical task source, 3292 items), normalized_cost_lines, normalized_revenue_lines, operational_tasks, engineering_tasks, qc_checklist/qc_item_instance, program_expense/program_inflows
- **Users**: 24 seeded users across 11 roles (CEO_ADMIN, COO_ADMIN, CCO, CFO, PROGRAM_MANAGER, QUALITY_MANAGER, CONSTRUCTION_MANAGER, PROGRAM_FINANCE_MANAGER, ACCOUNTANT, ENGINEER, PROJECT_MANAGER_SITE, PROJECT_DEVELOPER)
- **API**: ~300 endpoints, all auth-protected
- **Frontend**: 55+ routed pages

---

## AUDIT 2: FRONTEND CONSISTENCY AUDIT (FRONTEND_CONSISTENCY_AUDIT.md)

Read the file `FRONTEND_CONSISTENCY_AUDIT.md` in the project root for full details. Key findings to implement:

### PRIORITY 1 (HIGH) — Status Naming Unification
- Plan Tasks use: Not Started, In Progress, Done, Blocked
- Engineering uses: TO DO, IN PROGRESS, COMPLETE, HOLD, NEEDS APPROVAL, QC APPROVED, PROVIDE FEEDBACK
- MyTool uses: inbox, planned, in_progress, done, blocked, waiting, cancelled
- Operational uses: TO DO, IN PROGRESS, COMPLETE, HOLD, PROJECTS ASSISTANCE, NEEDS APPROVAL
- **ACTION**: Create a single normalized status enum displayed consistently everywhere. Implement a shared `normalizeStatus()` utility used by ALL views. Ensure the display text is identical across Plan, Engineering, My Work, and MyTool views.

### PRIORITY 2 (HIGH) — Terminology Standardization
- "Revenue" vs "Inflows" — pick ONE term and use it everywhere (UI labels, API names where possible, documentation)
- "Expenditure" vs "COS (Cost of Sales)" — standardize
- "My Work" vs "MyTool" — clarify the distinction in UI or unify
- "Workstream" vs "Primary Workstream" — standardize
- "% Complete" vs "Percent Complete" — standardize
- **ACTION**: Audit all UI labels, tab titles, button text, drawer headings, and documentation. Standardize terminology across the entire frontend.

### PRIORITY 3 (MEDIUM) — Shared Badge/Chip Components
- Status colors are hardcoded differently across TaskDetailDrawer, UnifiedPlanTab, my-work-tasks, Engineering views
- **ACTION**: Extract a shared `StatusBadge` component and `PriorityBadge` component. Use consistent color mappings everywhere. Replace all local status/priority rendering with these shared components.

### PRIORITY 4 (MEDIUM) — Standardize Delete Confirmation
- Some locations use `confirmDelete` state with inline "Are you sure?" text
- Other locations use full `AlertDialog` component
- **ACTION**: Standardize ALL delete confirmations to use `AlertDialog` from shadcn/ui. Remove all inline confirmation patterns.

### PRIORITY 5 (MEDIUM) — Standardize Save Patterns
- TaskDetailDrawer: auto-save on blur (no button)
- Phase change modal: explicit "Save" button
- Plan tab cells: save on blur or Enter key
- Revenue/Expenditure grids: inline cell auto-save
- **ACTION**: Document the save pattern convention. Where auto-save is used, add clear visual feedback (e.g., "Saved" indicator). Where explicit save is needed, ensure consistent button placement.

### PRIORITY 6 (LOW-MEDIUM) — Standardize Loading States
- Spinner (`Loader2`), Skeleton placeholders, custom `EnergyLoader`, no loading indicator, inline "No data" text
- **ACTION**: Pick ONE primary loading pattern (recommend Skeleton for initial loads, Spinner for mutations). Use the branded `EnergyLoader` for full-page loads. Apply consistently across all pages and tabs.

---

## AUDIT 3: UX/QA ASSESSMENT — DASHBOARD & FULL APPLICATION

### Overall UX/QA Health Rating: 7.5/10

### IMMEDIATE FIXES (CRITICAL/HIGH):

#### 1. Dashboard Metric Drill-Through
- ALL key metric cards (TOTAL PROJECTS 56, IN CONSTRUCTION 11, etc.) must be clickable
- Implement consistent hover states and cursor:pointer on metric cards
- Each card click navigates to a filtered table view showing the underlying data
- RAG status indicators must link to filtered project lists
- Financial totals must link to financial detail views
- Blocker and warning counts must link to actionable, filterable lists
- **ACTION**: For every metric card, KPI tile, and counter on the home dashboard, implement onClick navigation to the appropriate detail view with pre-applied filters.

#### 2. Data Import Health Widget
- Create a "Data Health" or "Data Integrity" widget on the dashboard
- Show: last import time, error counts, pending validations, data source indicator
- Show warnings like "3 projects with missing budgets"
- **ACTION**: Create a new DataHealthWidget component. Add an API endpoint that checks import status, counts validation errors, and returns data freshness info. Place prominently on the dashboard.

#### 3. Attention Needed — Actionable Lists
- "Behind Plan", "Eng. Blockers", "Quality Warnings" links must go to actionable lists
- Each list must show: owner, age/days overdue, severity, project context
- Lists must be filterable and sortable
- **ACTION**: Create or enhance the linked pages for each attention item. Ensure they show owner, age, severity, and project context. Add filtering and sorting capabilities.

### SHORT-TERM IMPROVEMENTS (HIGH/MEDIUM):

#### 4. Enhanced Financial Tiles
- Add period filters (YTD, FY, Month, Custom) to financial metric cards
- Add plan vs actual vs forecast toggles
- Add variance indicators (arrows, deltas, color coding)
- Add micro-visualizations (sparklines, trend arrows)
- **ACTION**: Enhance the financial KPI tiles with period selectors, variance display, and sparkline charts using Recharts.

#### 5. Role-Tailored "My Work / Today" Section
- Add a "My Work Today" section to the dashboard
- Pull together: tasks due today, pending approvals, engineering blockers assigned to user, QA items
- Personalize based on user role
- **ACTION**: Create a MyWorkToday component that aggregates the user's immediate action items. Use the existing role system to tailor what's shown.

#### 6. Visual Hierarchy Improvements
- Add icons to priority list items, metric cards, and attention items
- Improve spacing and typography contrast between data attributes (title, owner, days overdue, % complete)
- Use color-coded indicators for overdue/red/amber items
- Add clear visual separation between widget sections
- **ACTION**: Review and enhance the visual hierarchy of the home dashboard. Add Lucide icons, improve spacing, strengthen typographic hierarchy, add color-coded status indicators.

### FEATURE ADDITIONS (WORLD-CLASS):

#### 7. Daily Standup Workflow for Engineering
- Create a "Yesterday / Today / Blocked" view per engineer
- Link to Eng. Blockers and project plans
- Add a standup board view accessible from Engineering section
- **ACTION**: Create a StandupBoard component and page. Add API endpoints for standup entries. Link from Engineering navigation.

#### 8. Rich Quality Management Views
- Per-project quality dashboards
- NCR (Non-Conformance Report) workflows
- Checklist completion tracking with progress bars
- SLA metrics for quality turnaround times
- Summary insights on home dashboard
- **ACTION**: Enhance the Quality module with per-project dashboards, NCR workflow views, completion tracking, and SLA metrics.

#### 9. Advanced Reporting Capabilities
- Scheduled report subscriptions (email frequency selector)
- Export to PDF, Excel, PowerPoint from any report view
- Configurable, role-based analytic widgets on dashboard
- **ACTION**: Add export buttons to report pages. Create a report subscription system. Add configurable dashboard widget support.

#### 10. Dashboard Personalization
- Allow users to configure dashboard layout
- Pin/unpin favorite views and widgets
- Save dashboard preferences per user
- **ACTION**: Implement a dashboard customization system with drag-and-drop widget placement and user preference storage.

#### 11. Data Lineage & Auditability
- Provide explicit traces from portfolio metrics to individual records
- Add audit trails and change history views
- Show data provenance on imported records
- **ACTION**: Add an audit trail system. Show "last modified by/at" on key records. Add a change history drawer/modal for critical data fields.

#### 12. Role Personalization Enhancements
- Different home dashboard layouts per role (PM vs Engineer vs QA vs Finance vs Executive)
- "View as role" capability for admins
- Per-module access badges and "locked" indicators
- User profile page with current permissions display
- **ACTION**: Implement role-based dashboard variants. Add admin impersonation. Add permission visibility features.

### ADDITIONAL WORLD-CLASS BENCHMARK GAPS:

#### 13. Operational Workflow Surfacing
- Surface workflows on the home screen (RFIs, submittals, inspections, approvals)
- Show actionable queues with process steps
- **ACTION**: Add workflow queue widgets to the dashboard showing pending approvals, inspections, and submissions.

#### 14. Advanced Analytics & Visualization
- Add rich charts, heat maps, and trend lines to the home page
- Replace text-heavy KPIs with visual representations where possible
- Add portfolio-level heat map for project health
- **ACTION**: Create visual analytics components (heat maps, trend charts, portfolio health visualization) and integrate into the dashboard.

#### 15. Mobile & Responsive Optimization
- Validate all layouts on mobile and tablet
- Ensure field teams can use the app effectively on mobile devices
- **ACTION**: Audit and fix responsive behavior across all key pages. Ensure touch-friendly interactions for field use.

---

## IMPLEMENTATION APPROACH

1. **Start with shared components** (StatusBadge, PriorityBadge, AlertDialog standardization, loading states) as these are dependencies for many other fixes
2. **Then fix the dashboard** (drill-through, data health widget, attention items, financial tiles, visual hierarchy)
3. **Then add role-based features** (My Work Today, role-tailored dashboards, standup workflows)
4. **Then enhance modules** (Quality views, reporting, data lineage)
5. **Finally, add advanced features** (personalization, analytics, mobile optimization)

Work through each item systematically. Create a new git branch for this work. Commit after each major milestone with descriptive commit messages. Test that the application builds and runs after each change.

---

## IMPORTANT NOTES
- The application uses Drizzle ORM — check `shared/schema.ts` or `db/schema/` for table definitions
- The application uses TanStack React Query — follow existing patterns for data fetching
- UI components are from shadcn/ui — use existing component library
- Styling uses Tailwind CSS v4 — follow existing class patterns
- Charts use Recharts — use for any new visualizations
- The canonical task source is `work_items` table — use this for all task-related features
- Follow the existing Express.js route pattern for new API endpoints
- All new endpoints must use `requireAuth` middleware at minimum
