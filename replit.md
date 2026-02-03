# Emergent Energy Dashboard

## Overview

This is a full-stack program dashboard application for Emergent Energy, designed to track renewable energy projects across FY26. The system ingests Excel tracker files (project-specific `.xlsx`/`.xlsm` files) and populates dashboard metrics, project summaries, cashflow analysis, and budget tracking views.

The application follows a client-server architecture with React on the frontend and Express on the backend, using PostgreSQL for data persistence. Key functionality includes Excel file parsing for project data ingestion, authentication with role-based access control, and real-time dashboard metrics.

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend Architecture
- **Framework**: React 18 with TypeScript
- **Routing**: Wouter (lightweight React router)
- **State Management**: TanStack React Query for server state, React Context for auth and program data
- **UI Components**: shadcn/ui component library built on Radix UI primitives
- **Styling**: Tailwind CSS v4 with CSS variables for theming
- **Charts**: Recharts for data visualization
- **Forms**: React Hook Form with Zod validation

The frontend follows a page-based structure under `client/src/pages/` with shared components in `client/src/components/`. Custom hooks in `client/src/hooks/` manage authentication (`use-auth`), program data state (`use-program-data`), and UI utilities.

### Expenditure Breakdown Feature
- **Dual-Table Structure**: Parses Budget/Costed side and Actual/Finance side from Excel
- **Budget Fields**: Budget Qty, Budget Rate, Budget Total, Forecasted Payment Date, Budget COS Total
- **Actual Fields**: Actual Total, PO Number, Invoice Number, Invoice Raised Date, Payment Date, Actual COS Total
- **Line Status**: Auto-computed as Planned → Committed (has PO) → Invoiced (has invoice number AND date) → Paid (has payment date)
- **COS Recognition**: Requires BOTH Invoice Number AND Invoice Raised Date for COS to be recognized (per user requirement)
- **Ex-VAT Values**: All expenditure values are assumed to be ex-VAT (no VAT calculations)
- **Single Invoice/Payment Per Line**: Each line supports one invoice and one payment entry

#### Table UX Improvements (Feb 2026)
- **Sticky Headers**: Column headers remain visible while scrolling vertically
- **Sticky First Column**: Description column stays visible during horizontal scroll
- **Collapsible Groups**: Categories display as expandable/collapsible groups with totals
- **Row Cleanup**: Blank rows and duplicate category headers automatically filtered out
- **Column Visibility**: Dropdown menu allows toggling column visibility
- **Zebra Striping**: Alternating row colors for better readability
- **Tooltips**: Long descriptions truncated with hover tooltips
- **Status Badges**: Compact colored badges for Planned/Committed/Invoiced/Paid

### Cashflow Planning Feature
- **Editable Planning Grid**: Users can edit Planned Revenue and Planned Expenditure values directly in the UI (inline editing)
- **Real-time Chart Updates**: Chart reflects edits immediately (before saving) using local state management
- **Planning Overrides**: Edits are stored as overrides per project + week_start_date + series_name, applied on top of baseline tracker data
- **Save/Reset**: Save Plan persists overrides to database, Reset Plan clears all overrides for selected project
- **Multi-project Support**: Edits are automatically cleared when switching projects to prevent cross-project confusion
- **Forecast Payment Date**: Available in expenditure data for future cashflow planning integration

### Home Page (Projects Report)
The Home page serves as the default landing page with a comprehensive FY overview:

#### Portfolio Summary
- **Active Projects**: Count of projects not in "Closed" or "On Hold" phase
- **Active Capacity**: Total kWp/MW for active projects (sum of sizeKwp from projectInfo)
- **On Schedule Rate**: Percentage of projects where actual % complete >= expected % complete
- **Behind Plan**: Count of projects where delta (actual - expected) < 0
- **Phase Distribution**: Breakdown by phase (Construction, Handover, QA, etc.)

#### Execution Summary
- **In Construction**: Count of projects in "Construction" phase
- **Avg % Complete**: Average of pctComplete across all construction projects
- **Expected %**: Average of expectedPctComplete (based on current date vs planned dates)
- **Delta vs Expected**: (actual - expected) * 100, shown as trend indicator
- **Critical Milestones**: Upcoming milestones due in next 30 days

#### Financial Summary (FY-based)
- **Revenue (Actual)**: Sum of inflowActualTotal for inflows with receiptDate in FY range
- **Revenue Budget**: Sum of inflowBudgetTotal for all inflows
- **Expenses (Actual)**: Sum of expenseActualTotal for expenses with paymentDate in FY range
- **Expense Budget**: Sum of expenseBudgetTotal for all expenses
- **Net Cashflow**: Revenue Actual - Expenses Actual
- **COS Realised**: Sum of expenseActualTotal where BOTH invoiceNumber AND invoicedDate exist
- **Inflows Received/Pending**: Split based on presence of receiptDate

#### Data Quality Panel
- Missing Phase / kWp / Commissioning Date counts per project
- Total row counts: Projects, Expense Lines, Inflow Lines, Plan Tasks
- Last upload timestamp with link to Upload page

#### Editable Notes
- Weekly Highlights, Construction Notes, Finance Notes
- Persisted in homeNotes table, editable inline with Save button

### COS Tracker Page
Enhanced Cost of Sales tracking with strict recognition rules:

#### COS Recognition Rules
1. **Planned**: Line exists with budget, no PO number
2. **Committed**: PO Number exists (goods/services ordered)
3. **Invoiced (COS)**: Invoice Number AND Invoice Raised Date BOTH present
4. **Paid**: Payment Date exists (cash left the bank)

**Critical**: COS is only recognized when BOTH Invoice Number AND Invoice Raised Date are present

#### KPIs
- **COS Realised**: Sum of expenseActualTotal where invoiced (both fields present)
- **Cash Paid**: Sum of expenseActualTotal where paymentDate exists
- **Outstanding COS**: Invoiced but not yet paid
- **Paid vs Budget**: (Cash Paid / Total Budget) * 100

#### Supplier Extraction
Supplier name extracted from invoice/PO numbers by splitting on ':' or '-' and taking first segment

#### Monthly COS Matrix
- Rows: Categories from expense data
- Columns: Months (YYYY-MM) based on invoicedDate
- Values: Sum of expenseActualTotal per category per month

### SafeMoney Utilities
Located in `client/src/lib/safeMoney.ts`, provides NaN-safe currency handling:
- `safeNumber(value)`: Converts any value to number, returns 0 for null/undefined/NaN
- `safeSum(values[])`: Sums array safely
- `safeSumField(items[], field)`: Sums a specific field from objects
- `formatRand(value, options)`: Formats as "R1.23M" with compact/showSign options
- `formatPercent(value, options)`: Formats as "45.2%" safely
- `safePercent(num, denom)`: Safe division returning 0 if denominator is 0
- `formatNumber(value, decimals)`: Number with thousands separators
- `hasValue(value)`: Returns true if valid non-zero number

### Project Plan View (Scheduling Tool)

The Project Plan tab provides CPM scheduling with Gantt visualization:

#### How to Use

1. **Summary Strip**: Shows Project Start/Finish, Duration, # Tasks, # Critical, Overall % Complete vs Expected at a glance.

2. **Task Grid Tab**:
   - **Search & Filter**: Search tasks by name or number. Filter by: All Tasks, Critical Only, Late Tasks, Blocked.
   - **Split View Toggle**: ON = Grid + Gantt side-by-side. OFF = Grid only. Default ON for desktop.
   - **% Complete / Expected %**: Each task shows actual progress with a progress bar. Expected % is computed from planned dates.
   - **Late Indicator**: Tasks behind schedule show an amber warning icon.
   - **Critical Badge**: Tasks on critical path marked with "CRIT" badge.
   - **Inline Editing**: Click Edit to modify task name, start/end dates.

3. **Gantt Chart Tab**:
   - **Fit to Project**: Zooms viewport to show entire project from first task start to last task end (with padding).
   - **Jump to Today**: Centers today's date in the viewport.
   - **Zoom Levels**: Week / Month / Quarter - controls timescale granularity.
   - **Today Line**: Blue vertical line marks current date.
   - **Progress Fill**: Bars fill based on actual % complete.
   - **Expected Marker**: Small vertical line on bars shows expected % position.
   - **Critical Path**: Critical tasks have red fill with distinct border.

4. **Task Detail Panel**: Click any task row (grid or Gantt) to open a side panel with:
   - Start/End dates, Duration, Slack
   - Progress vs Expected comparison
   - Predecessor/Successor dependencies
   - Edit Task button

5. **Dependencies Tab**: View and manage task links (FS/SS/FF/SF with lag).

6. **Changes Tab**: View history of schedule change notices for governance tracking.

#### Key Features
- **CPM Engine**: Server-side critical path calculation with working-days calendar (Mon-Fri).
- **Hover Sync**: Hovering a grid row highlights the matching Gantt bar and vice versa.
- **Schedule Governance**: Changes to critical path tasks that may affect Commissioning/Client Handover dates trigger a warning modal requiring acknowledgment.

### Backend Architecture
- **Framework**: Express.js with TypeScript
- **Authentication**: Passport.js with local strategy, express-session with PostgreSQL session store
- **File Upload**: Multer for handling Excel file uploads
- **Excel Parsing**: xlsx library for parsing tracker files with custom parsing logic in `server/excelParser.ts`

The server follows a modular structure:
- `server/routes.ts` - API route definitions with transactional upload handling
- `server/storage.ts` - Database access layer abstraction with transaction support
- `server/db.ts` - Drizzle ORM database connection with resilient connection logic
- `server/db-config.ts` - Database connection testing and fallback management
- `server/excelParser.ts` - Excel file parsing logic for tracker ingestion

### Data Storage
- **Database**: PostgreSQL (primary) with SQLite fallback, using Drizzle ORM
- **Schema Location**: `shared/schema.ts` (shared between client and server)
- **Resilient Connection**: 
  - `server/db-config.ts` - Tests Postgres connection with 2-second timeout
  - Automatically falls back to file-based SQLite (`./data/app.sqlite`) if Postgres unavailable
  - Health endpoint (`/api/health`) reports current database mode and connection status
- **Transactional Safety**: All file uploads wrapped in database transactions to prevent partial data loss
- **Key Tables**:
  - `users` - Authentication with role-based access (admin/member)
  - `projectInfo` - Project metadata parsed from trackers
  - `programExpense` - Expenditure entries from "Expenditure Breakdown" sheets
  - `programInflows` - Revenue entries from "Revenue Tracking" sheets
  - `projectPlan` - Task/milestone entries from "Project Plan" sheets
  - `cashflowPoints` - Cashflow series data from "Cashflow" sheets
  - `financeRevenueMonthly` - Revenue monthly data from "Finance-Revenue" sheets
  - `financeCosMonthly` - Cost of sales monthly data from "Finance-COS" sheets
  - `cashflowPlanningOverrides` - User edits for planned cashflow series (project + week + series + override value)
  - `uploadMetadata` - Upload history with file paths for reprocessing
  - `refreshLogs` - Data refresh audit trail
  - Legacy tables: `projects`, `expenses`, `revenues`, `tasks`, `budgets`

### Excel Parsing Contract
The system parses project tracker Excel files with specific sheet structures using robust header detection:
1. **Expenditure Breakdown** - Row 4 headers (L-X columns), data starts row 6
2. **Revenue Tracking** - Row 12 headers, data starts row 13, parse first table only
3. **Project Plan** - Row 8 headers for task/milestone data
4. **Cashflow** - Robust header detection, canonical series naming (Planned/Actual Revenue/Expenditure/CashFlow)
5. **Finance-Revenue** - Monthly revenue breakdown with smart date horizon limiting
6. **Finance-COS** - Monthly cost of sales with smart date horizon limiting

### File Upload Features
- **Disk Storage**: Files persisted to `./uploads/` directory for reprocessing capability
- **Transactional Safety**: All uploads wrapped in database transactions to prevent partial data loss
- **Reprocess Endpoint**: `POST /api/reprocess-all` re-parses stored files without re-upload
- **Upload Validation**: Real-time validation report showing parsed record counts by type
- **Database Mode Indicator**: UI displays current database mode (Postgres/SQLite) in top bar

### Build System
- **Development**: Vite dev server with HMR for client, tsx for server
- **Production**: Custom build script using esbuild for server bundling, Vite for client
- **Output**: `dist/` directory with `index.cjs` (server) and `public/` (client assets)

## External Dependencies

### Database
- **PostgreSQL** - Primary database, connection via `DATABASE_URL` environment variable
- **connect-pg-simple** - Session storage in PostgreSQL

### Authentication
- **Passport.js** - Authentication framework
- **bcryptjs** - Password hashing

### File Processing
- **xlsx** - Excel file parsing for `.xlsx`, `.xlsm`, `.xls` files
- **multer** - Multipart file upload handling

### Frontend Libraries
- **@tanstack/react-query** - Server state management and caching
- **recharts** - Chart components for dashboards
- **date-fns** - Date manipulation utilities
- **zod** - Schema validation (shared between client/server)

### UI Framework
- **@radix-ui/** - Accessible UI primitives (dialog, dropdown, tabs, etc.)
- **class-variance-authority** - Component variant management
- **tailwindcss** - Utility-first CSS framework