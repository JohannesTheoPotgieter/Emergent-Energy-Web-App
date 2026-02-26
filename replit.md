# Emergent Energy Dashboard

## Overview
The Emergent Energy Dashboard is a full-stack web application for tracking and managing renewable energy projects. It provides real-time insights into project metrics, financial performance (cashflow, budget, cost of sales), and scheduling by processing project data from Excel files. The application aims to enhance operational efficiency, streamline project oversight, and support strategic decision-making. Key capabilities include financial tracking, project and quality management, a smart Excel import system, and integration with subcontractor workflows. The project envisions becoming a leading platform for renewable energy project management, offering transparency and control to stakeholders.

## User Preferences
Preferred communication style: Simple, everyday language.

### Data Import Rules
- **Project Name Derivation**: The project name is ALWAYS derived from the Excel filename — specifically all alphanumeric characters (letters, numbers, spaces) before "_Tracker" or "_tracker" in the filename. E.g., `Coega_Steels_Phase_2_Tracker.xlsx` → project name "Coega Steels Phase 2". Underscores in the filename before "_Tracker" are replaced with spaces.
- **COS Realised**: Invoice Number + Black invoice date font. Logic: hasInvoice + (invoiceDateConfirmed === true OR invoiceDateFontColor === 'black'). PO number is NOT required for realisation. NULL/empty font color does NOT default to confirmed.
- **COS Deferred**: Invoice present + invoice date exists but font is RED (not yet realised).
- **COS Flagged**: Invoice date font IS black but missing Invoice number — needs attention. Users can override Flagged status via a dialog (click the badge), providing a new status and reason. Overrides are stored in `cos_status_overrides` table, keyed by `expense_id` + `project_name:row_number` for re-import resilience. Override reason shown on hover.
- **COS Planned**: Default state for all other lines.
- **Cashflow Out of Bank**: Payment date font is BLACK + has invoice number. Logic: paymentDateBlack + hasInvoice.
- **Cashflow Payment Planned**: Payment date exists but font is RED (planned, not yet out of bank).
- **Cashflow Planned**: No payment date or no relevant data.
- **Font Color Rule**: Only explicit black font (invoiceDateFontColor === 'black' or invoiceDateConfirmed === true) means confirmed. NULL or empty font color is treated as NOT confirmed (changed from legacy behavior that defaulted null to confirmed).
- **Font Color Override**: Users can click the color dot next to invoice/payment dates in the Expenditure Breakdown to toggle between black (confirmed) and red (forecast). This saves an override in `expenditure_overrides` table (keyed by `project_name` + `row_number`) which persists across re-imports. The override is applied on-read in expenditure-breakdown, COS tracker, and month-detail endpoints via `applyExpenditureOverridesWithConfirmed()`. The toggle endpoint is `PATCH /api/expenditure/font-color-toggle`.
- **Revenue Recognition Amount**: Extracted from "REVENUE RECOGNITION AMOUNT" column in the Expenditure Breakdown sheet. Stored in `program_expense.revenue_amount`. Both the legacy excelParser and Smart Import normalizer extract this field.
- **Budget vs Actual Separation**: The Expenditure Breakdown sheet has dual sections — budget (left, cols 2-8) and actual (right, cols 13-26). The parser uses `actualSectionStartCol` detection to build separate `budgetColMap` and `colMap` for correct column resolution.
- **Smart Import Legacy Parity**: The Smart Import commit writes ALL fields to `program_expense` that the legacy excelParser writes, including: `revenueAmount` (from revenue_recognition_amount), `actualCosTotal` (from actual_cos), `budgetCosTotal` (from budget_cos), `budgetQty`, `budgetRateUnit`, `budgetTotal` (from budget section columns), `expenseQty` (from budget_qty), `expenseRateUnit` (from budget_rate), `forecastPaymentDate`, `computedForecastPaymentDate` (from forecast_payment_date), and `lineStatus` (derived: Planned/Committed/Invoiced/Paid). Without these, COS tracker and cashflow calculations produce wrong numbers after re-import.
- **Budget Section Detection**: The Smart Import detector now captures both budget section headers (left side of Expenditure Breakdown) and actual section headers (right side). Budget headers are stored in `DetectedSection.budgetHeaders` and mapped via `MappingResult.budgetMappings`. The normalizer uses budget mappings for `budget_qty`, `budget_rate`, `budget_total`, `budget_cos`, and `forecast_payment_date`, falling back to actual section mappings if budget mappings aren't available.
- **Data End Detection**: The Smart Import detector scans up to 50 rows ahead past empty gaps to check for more data. This prevents premature cutoff when Excel files have large empty row gaps between expenditure categories (e.g., Mondi Tracker has 30+ empty rows between General Expenses and Service Add On). The `findDataEndRow` function uses a look-ahead mechanism instead of the rigid 3-consecutive-empty-rows rule.
- **Smart Import Issue Resolution**: Three resolution types control row import behavior: "IGNORED" skips the row (user chose to ignore/exclude it), "SKIP_ROW"/"EXCLUDE" also skip the row, and "ALLOW_ALL"/"ACCEPTED"/"OVERRIDE" import the row as-is. The "Allow All" button in the issues step resolves all unresolved issues as "ALLOW_ALL", importing every data row without filtering. Bulk commit auto-resolves non-blocker warnings as "ALLOW_ALL" so data is not silently dropped.
- **Expenditure Sort Order**: Categories in the expenditure tab are sorted by minimum `row_number` from the original Excel, preserving the Excel's category order.
- **Database Sync**: Dev and production have separate databases. Data is migrated via `server/seed-data-migration.ts` which runs on startup — it reads JSON seed files from `server/data-seed/` and imports them if the target database is empty. The `.migrated` flag file prevents re-runs.

## System Architecture

### Frontend
-   **Framework**: React 18 with TypeScript.
-   **State Management**: TanStack React Query for server state, React Context for local state.
-   **UI**: shadcn/ui (Radix UI-based) and Tailwind CSS v4 for mobile-first responsive design.
-   **Data Visualization**: Recharts.
-   **Forms**: React Hook Form with Zod validation.
-   **Core Features**: Financial tracking, project and quality management, a 5-step Smart Excel Import wizard, Subcontractor Dashboard, SharePoint Proposals Pipeline integration, UX Guidance System, Project Awareness Bar, Business Alert Engine, 5-Tab Navigation, Weekly Review Wizard, Admin utilities including Execution Cockpit, redesigned sidebar, Permission Gate System for role-based access, Weekly Reviews Page, and Admin Roles & Permissions management. TR Register module tracks cross-project action items. Smart Import is the sole method for project creation/update, including re-run protection and font color extraction for COS/cashflow status. The Money tab includes a project-level **COS Tracker** showing expenditure items grouped by category with COS status and payment status. A **PM Dashboard** (`/pm-dashboard`) provides view-only project oversight for assigned project managers.

### Backend
-   **Framework**: Express.js with TypeScript.
-   **Authentication**: Passport.js with local strategy and PostgreSQL-backed sessions, supporting role-based access control and rate limiting.
-   **Permission Middleware**: `requirePermission(entity, action)` for API-level role-based access with 18 granular permission entities. Section-level access uses 7 consolidated keys: `COCKPIT`, `PROJECTS`, `MONEY`, `DELIVERY`, `GOVERNANCE`, `INFORMATION`, `ADMIN`.
-   **File Handling**: Multer for uploads, `exceljs` for parsing.
-   **Data Storage**: PostgreSQL with Drizzle ORM.
-   **Data Integrity**: Transactional safety and reprocessing.
-   **Calculation Engine**: Pure-function modules for computations and data quality.
-   **Backfill System**: Automated population of computed columns and foreign keys on server startup.
-   **Audit Trails**: Immutable `change_sets` and `field_changes` for data mutations, plus detailed logs.

### Database Architecture
-   **Central Spine**: `project_info` is the primary table, with all modules linking via `project_id`.
-   **Normalized Data**: `normalized_cost_lines`, `normalized_revenue_lines`, `normalized_plan_tasks` are the source of truth.
-   **Derived Tables**: `derived_project_kpis`, `derived_portfolio_kpis`, `derived_rag_summary` are rebuilt on demand.
-   **FK Backfill**: `backfill-project-ids.ts` populates `projectId` on related tables on startup.

### Engineering Stage Templates
-   **Module**: Implements a 5-stage engineering checklist system (First Assessment, Cost Proposal, IFC Planning, Construction Support, Handover Pack) with CRUD for templates, project stage instantiation, task/deliverable/approval management, and stage gate completion logic.
-   **Tables**: `eng_stage_templates`, `eng_task_templates`, `eng_deliverable_templates` (template definitions); `project_eng_stages`, `project_eng_tasks`, `project_eng_deliverables`, `project_eng_approvals` (project instances). All link to `project_info` via `project_id`.
-   **Stage Gating**: Each template defines gate rules (e.g., `requireAllTasks`, `requireQaApproval`). COO can override stage completion with a mandatory reason.
-   **Lifecycle Board Integration**: When a project moves on the company lifecycle board, the corresponding engineering stages are auto-generated based on the `PHASE_TO_ENG_STAGES` mapping.

### Emergent Energy Info & Walkthroughs
-   **Knowledge Base**: Wiki-style knowledge base with Graph, Detail, Flow, and Walkthroughs tabs. Backed by `ee_info_nodes` / `ee_info_edges` / `ee_info_assets` tables.
-   **Walkthroughs**: 9 interactive step-by-step guides covering key functionalities like Smart Import, COS Tracking, Cashflow, Weekly Review, Lifecycle Board & Engineering Stages, Quality, Engineering Tasks, Subcontractor Management, My Tool (Personal Productivity).

### Deploy Cache & Session Clearing
-   **Build Versioning**: Unique `buildId` enables frontend to detect new deployments and clear client-side cache/session data.
-   **Server Session Clearing**: In production, all PostgreSQL sessions are cleared on each deploy.

## External Dependencies

### Database & ORM
-   **PostgreSQL**: Primary data store.
-   **Drizzle ORM**: Type-safe ORM.

### Authentication & Security
-   **Passport.js**: Authentication middleware.
-   **bcryptjs**: Password hashing.

### File Processing
-   **exceljs**: Excel file parsing and writing.
-   **multer**: Handling `multipart/form-data`.

### Frontend Libraries
-   **@tanstack/react-query**: Data fetching and state management.
-   **recharts**: Declarative charting.
-   **date-fns**: Date utility library.
-   **zod**: Schema validation.
-   **@radix-ui/**: Accessible UI component primitives.
-   **tailwindcss**: Utility-first CSS framework.

### Third-Party Integrations
-   **Microsoft Graph API**: For Outlook calendar integration.
-   **Read.ai**: Meeting data ingestion via webhooks.