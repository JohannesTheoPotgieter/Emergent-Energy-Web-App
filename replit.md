# Emergent Energy Dashboard

## Overview
The Emergent Energy Dashboard is a full-stack web application for tracking and managing renewable energy projects. Its primary purpose is to provide comprehensive, real-time insights into project metrics, financial performance (cashflow, budget, cost of sales), and scheduling by ingesting project data from Excel files. The application aims to streamline project oversight, enhance operational efficiency, and support strategic decision-making for FY26. Key capabilities include financial tracking, project and quality management, a smart Excel import system, and integration with subcontractor workflows.

## User Preferences
Preferred communication style: Simple, everyday language.

### Data Import Rules
- **Project Name Derivation**: The project name is ALWAYS derived from the Excel filename — specifically all alphanumeric characters (letters, numbers, spaces) before "_Tracker" or "_tracker" in the filename. E.g., `Coega_Steels_Phase_2_Tracker.xlsx` → project name "Coega Steels Phase 2". Underscores in the filename before "_Tracker" are replaced with spaces.
- **COS Realised**: PO number + Invoice Number + Black invoice date font. Logic: hasPO + hasInvoice + (invoiceDateConfirmed === true OR invoiceDateFontColor === 'black'). NULL/empty font color does NOT default to confirmed.
- **COS Deferred**: PO + Invoice present + invoice date exists but font is RED (not yet realised).
- **COS Flagged**: Invoice date font IS black but missing either PO or Invoice number — needs attention. Users can override Flagged status via a dialog (click the badge), providing a new status and reason. Overrides are stored in `cos_status_overrides` table, keyed by `expense_id` + `project_name:row_number` for re-import resilience. Override reason shown on hover.
- **COS Planned**: Default state for all other lines.
- **Cashflow Out of Bank**: Payment date font is BLACK + has invoice number. Logic: paymentDateBlack + hasInvoice.
- **Cashflow Payment Planned**: Payment date exists but font is RED (planned, not yet out of bank).
- **Cashflow Planned**: No payment date or no relevant data.
- **Font Color Rule**: Only explicit black font (invoiceDateFontColor === 'black' or invoiceDateConfirmed === true) means confirmed. NULL or empty font color is treated as NOT confirmed (changed from legacy behavior that defaulted null to confirmed).
- **Revenue Recognition Amount**: Extracted from "REVENUE RECOGNITION AMOUNT" column in the Expenditure Breakdown sheet. Stored in `program_expense.revenue_amount`. Both the legacy excelParser and Smart Import normalizer extract this field.
- **Budget vs Actual Separation**: The Expenditure Breakdown sheet has dual sections — budget (left, cols 2-8) and actual (right, cols 13-26). The parser uses `actualSectionStartCol` detection to build separate `budgetColMap` and `colMap` for correct column resolution.
- **Smart Import Legacy Parity**: The Smart Import commit writes ALL fields to `program_expense` that the legacy excelParser writes, including: `revenueAmount` (from revenue_recognition_amount), `actualCosTotal` (from actual_cos), `budgetCosTotal` (from budget_cos), `budgetQty`, `budgetRateUnit`, `budgetTotal` (from budget section columns), `expenseQty` (from budget_qty), `expenseRateUnit` (from budget_rate), `forecastPaymentDate`, `computedForecastPaymentDate` (from forecast_payment_date), and `lineStatus` (derived: Planned/Committed/Invoiced/Paid). Without these, COS tracker and cashflow calculations produce wrong numbers after re-import.
- **Budget Section Detection**: The Smart Import detector now captures both budget section headers (left side of Expenditure Breakdown) and actual section headers (right side). Budget headers are stored in `DetectedSection.budgetHeaders` and mapped via `MappingResult.budgetMappings`. The normalizer uses budget mappings for `budget_qty`, `budget_rate`, `budget_total`, `budget_cos`, and `forecast_payment_date`, falling back to actual section mappings if budget mappings aren't available.
- **Data End Detection**: The Smart Import detector scans up to 50 rows ahead past empty gaps to check for more data. This prevents premature cutoff when Excel files have large empty row gaps between expenditure categories (e.g., Mondi Tracker has 30+ empty rows between General Expenses and Service Add On). The `findDataEndRow` function uses a look-ahead mechanism instead of the rigid 3-consecutive-empty-rows rule.
- **Smart Import Issue Resolution**: When import issues (DUPLICATE_INVOICE, DATE_ORDER_VIOLATION, etc.) are resolved as "IGNORED", the data row is still imported — only "SKIP_ROW" or "EXCLUDE" resolutions actually exclude a row from the commit. This prevents auto-resolved warnings from silently dropping data (e.g., Mondi Panels rows were being dropped because duplicate invoice warnings were auto-resolved as IGNORED).
- **Expenditure Sort Order**: Categories in the expenditure tab are sorted by minimum `row_number` from the original Excel, preserving the Excel's category order.
- **Database Sync**: Dev and production have separate databases. Data is migrated via `server/seed-data-migration.ts` which runs on startup — it reads JSON seed files from `server/data-seed/` and imports them if the target database is empty. The `.migrated` flag file prevents re-runs.

## System Architecture

### Frontend
-   **Framework**: React 18 with TypeScript
-   **State Management**: TanStack React Query for server state, React Context for local state
-   **UI**: shadcn/ui (Radix UI-based) and Tailwind CSS v4 for mobile-first responsive design.
-   **Data Visualization**: Recharts
-   **Forms**: React Hook Form with Zod validation
-   **Core Features**: Financial tracking, project and quality management, a 5-step Smart Excel Import wizard, Subcontractor Dashboard, SharePoint Proposals Pipeline integration, a UX Guidance System, a Project Awareness Bar, a Business Alert Engine, a 5-Tab Navigation system, a Weekly Review Wizard, and Admin utilities including an Execution Cockpit. The application also features redesigned sidebar navigation, a comprehensive Permission Gate System for role-based access, a dedicated Weekly Reviews Page, and Admin Roles & Permissions management. The TR Register module provides tracking for cross-project action items with list and board views. Smart Import is the sole method for project creation/update, with re-run protection and font color extraction for COS/cashflow status. The Money tab includes a project-level **COS Tracker** sub-tab (formerly "Monthly Summary") showing expenditure items grouped by category with COS status (Realised/Deferred/Flagged/Planned), payment status, clickable summary cards for filtering, and search.

### Backend
-   **Framework**: Express.js with TypeScript
-   **Authentication**: Passport.js with local strategy and PostgreSQL-backed sessions, supporting role-based access control and rate limiting.
-   **Permission Middleware**: `requirePermission(entity, action)` for API-level role-based access.
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

### UI Libraries
-   **@radix-ui/**: Accessible UI component primitives.
-   **tailwindcss**: Utility-first CSS framework.

### EE Info Knowledge Base
-   **Module**: Obsidian-sourced knowledge base viewer at `/ee-info` (under Governance nav)
-   **Backend**: `server/ee-info-routes.ts` — zip importer, CRUD API, graph/flow/detail routes, post-seed alignment endpoint
-   **Frontend**: `client/src/pages/ee-info.tsx` — 3 tabs: Graph (force-directed canvas), Detail (wiki-link navigation, COO edit), Flow (process chain)
-   **DB Tables**: `ee_info_nodes`, `ee_info_edges`, `ee_info_assets`, `ee_info_versions`, `ee_info_settings`
-   **Seed**: `seed/ee-info/Emergent Energy.zip` — 57 Obsidian MD files auto-imported on boot
-   **Categories**: role, process, governance, tool, template, other, unknown
-   **Structured Metadata**: Process nodes support `gate_conditions`, `blocking_conditions`, `responsible_role`, `escalation_role` (JSONB/text columns)
-   **Post-Seed Alignment**: COO users can click "Align Structure" to upsert governance nodes (COS Realisation Logic, Revenue Milestone Logic, VO Approval Workflow, Cashflow Forecasting Model, Risk/Safety/QA Governance), new roles (Construction Manager, Design Engineer, Project Engineer Quality), new tools (Emergent Energy Web Application), and lifecycle/execution/handover process nodes with full metadata
-   **adm-zip**: Used for Obsidian zip parsing (dynamic import, not require)

### Third-Party Integrations
-   **Microsoft Graph API**: For Outlook calendar integration.
-   **Read.ai**: Meeting data ingestion via webhooks.