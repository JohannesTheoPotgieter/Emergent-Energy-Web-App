# Emergent Energy Dashboard

## Overview
The Emergent Energy Dashboard is a full-stack web application designed for tracking and managing renewable energy projects. Its core purpose is to deliver real-time insights into project metrics, financial performance (cashflow, budget, cost of sales), and scheduling by processing project data from Excel files. The application aims to enhance operational efficiency, streamline project oversight, and support strategic decision-making for FY26. Key features include financial tracking, project and quality management, a smart Excel import system, and integration with subcontractor workflows. The project vision is to become the leading platform for renewable energy project management, offering unparalleled transparency and control to project stakeholders.

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
-   **Core Features**: Financial tracking, project and quality management, a 5-step Smart Excel Import wizard, Subcontractor Dashboard, SharePoint Proposals Pipeline integration, a UX Guidance System, a Project Awareness Bar, a Business Alert Engine, a 5-Tab Navigation system, a Weekly Review Wizard, Admin utilities including an Execution Cockpit, redesigned sidebar navigation, a comprehensive Permission Gate System for role-based access, a dedicated Weekly Reviews Page, and Admin Roles & Permissions management. The TR Register module tracks cross-project action items. Smart Import is the sole method for project creation/update, including re-run protection and font color extraction for COS/cashflow status. The Money tab includes a project-level **COS Tracker** sub-tab showing expenditure items grouped by category with COS status and payment status. A **PM Dashboard** (`/pm-dashboard`) provides view-only project oversight for assigned project managers.

### Backend
-   **Framework**: Express.js with TypeScript.
-   **Authentication**: Passport.js with local strategy and PostgreSQL-backed sessions, supporting role-based access control and rate limiting.
-   **Permission Middleware**: `requirePermission(entity, action)` for API-level role-based access. Entity permissions (e.g., `projects`, `financials`) control view/edit/approve/override per role. Section-level access uses 7 consolidated keys: `COCKPIT`, `PROJECTS`, `MONEY`, `DELIVERY`, `GOVERNANCE`, `INFORMATION`, `ADMIN`.
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
-   **Routes**: `server/eng-stage-routes.ts` — `/api/eng-stages/templates` (list/detail/toggle), `/api/projects/:id/eng-stages` (generate/list/detail), task/deliverable/approval CRUD, stage completion + COO override. Auth: dual JWT+session matching `engineering-routes.ts` pattern.
-   **Stage Gating**: Each template defines gate rules (e.g., `requireAllTasks`, `requireQaApproval`). COO can override stage completion with a mandatory reason.
-   **Handover Pack**: Requires QA_REVIEW (Dean) + TECHNICAL_SIGNOFF (Tanaka) approvals — auto-created on stage generation.
-   **File Uploads**: Deliverables are uploaded via multer to `uploads/eng-deliverables/`, tracked per stage with version tags.
-   **Frontend**: `EngineeringStagesTab.tsx` (sub-tab under Engineering on project detail), `eng-template-admin.tsx` (COO admin at `/admin/eng-templates`), `stage-export.ts` (File System Access API folder picker + JSZip fallback).
-   **Seed**: `server/seed-eng-templates.ts` seeds 5 templates with 39 tasks on startup (idempotent).
-   **Phase Integration**: `PHASE_TO_ENG_STAGES` mapping in `shared/schema.ts` maps project phases to engineering stage names. When a project phase changes via `PATCH /api/projects/:id/phase`, the corresponding engineering stages are auto-generated (idempotent, skips already-existing stages). The reusable `generateEngStagesForProject()` function is exported from `eng-stage-routes.ts`.
-   **Lifecycle Board Integration**: When a project moves on the company lifecycle board (`PATCH /api/lifecycle-board/projects/:id/phase` or `POST /promote-engineering`), the corresponding engineering stages are auto-generated based on the `PHASE_TO_ENG_STAGES` mapping. E.g., moving to "Construction" auto-creates "IFC Planning" + "Construction Support" stages.
-   **Project Phases**: `LIFECYCLE_PHASES` includes Hold, Closed, DLP, Financial Close, TBC. Engineering task creation (`engineering-tasks.tsx`) excludes Hold and Closed projects from the project picker.

### Emergent Energy Info & Walkthroughs
-   **Knowledge Base**: `client/src/pages/ee-info.tsx` — wiki-style knowledge base with Graph, Detail, Flow, and Walkthroughs tabs. Backed by `ee_info_nodes` / `ee_info_edges` / `ee_info_assets` tables.
-   **Content Seed**: `seed/ee-info/Emergent Energy.zip` imported on boot via `server/ee-info-routes.ts`. Additional content updates seeded by `server/seed-ee-info-updates.ts` (idempotent).
-   **Walkthroughs**: 9 interactive step-by-step guides defined in `client/src/data/walkthroughs.ts`. Categories: project-management, finance, engineering, governance, operations. Progress tracked in localStorage. Covers: Smart Import, COS Tracking, Cashflow, Weekly Review, Lifecycle Board & Engineering Stages (merged), Quality, Engineering Tasks, Subcontractor Management.
-   **Content Nodes**: 90 nodes covering roles, processes, tools, templates. Key additions: COS Tracking, Cashflow Management, Revenue Recognition, Smart Import Process, Weekly Review Process, Engineering Stage Gating, Permission & Access Control, Emergent Dashboard.

### Deploy Cache & Session Clearing
-   **Build Versioning**: A unique `buildId` is generated per build, enabling the frontend to detect new deployments and clear client-side cache/session data, redirecting to login.
-   **Server Session Clearing**: In production, all PostgreSQL sessions are cleared on each deploy.
-   **Cache Headers**: `no-cache` for HTML and version files; hashed assets are cached for 1 year immutable.

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