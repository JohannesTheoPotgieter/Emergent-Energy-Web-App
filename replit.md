# Emergent Energy Dashboard

## Overview
The Emergent Energy Dashboard is a full-stack web application designed to track and manage renewable energy projects. It ingests project data from Excel tracker files to provide comprehensive views of project metrics, financial performance (cashflow, budget, cost of sales), and scheduling. The application aims to offer real-time insights into project progress and financial health for FY26, supporting decision-making and project oversight.

## User Preferences
Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend
- **Framework**: React 18 with TypeScript
- **State Management**: TanStack React Query for server state, React Context for local state
- **UI**: shadcn/ui (Radix UI-based) and Tailwind CSS v4
- **Data Visualization**: Recharts
- **Forms**: React Hook Form with Zod validation
- **Core Features**:
    -   **Expenditure Breakdown**: Dual-table parsing of budget/costed vs. actual/finance data from Excel, with auto-computed line statuses (Planned, Committed, Invoiced, Paid) and strict COS recognition rules (Invoice Number AND Invoice Raised Date required). Includes UI/UX enhancements like sticky headers, collapsible groups, and column visibility toggles.
    -   **Cashflow Planning**: Editable planning grid for revenue and expenditure, with real-time chart updates, override persistence, and multi-project support.
    -   **Home Page (Projects Report)**: Comprehensive FY overview including Portfolio Summary (active projects, capacity, schedule adherence), Execution Summary (construction progress, milestones), Financial Summary (revenue, expenses, net cashflow, COS realized), Data Quality Panel, and editable project notes.
    -   **COS Tracker Page**: Detailed Cost of Sales tracking with KPIs (COS Realised, Cash Paid, Outstanding COS), supplier extraction, and a monthly COS matrix.
    -   **Project Plan View**: CPM scheduling tool with Gantt visualization, critical path calculation, task grid with inline editing, task detail panel, and dependency management. Features include hover sync between grid/Gantt and schedule governance warnings for critical path changes.
    -   **SafeMoney Utilities**: Frontend utilities for NaN-safe currency handling and formatting.

### Backend
- **Framework**: Express.js with TypeScript
- **Authentication**: Passport.js with local strategy and PostgreSQL-backed sessions
- **File Upload**: Multer for handling Excel files
- **Excel Parsing**: `xlsx` library with custom parsing logic to ingest project, expense, revenue, plan, and cashflow data from defined Excel sheet structures.
- **Data Storage**: PostgreSQL as primary, with resilient fallback to SQLite (`./data/app.sqlite`) if PostgreSQL is unavailable. Drizzle ORM is used for database interactions.
- **Transactional Safety**: All file uploads and data modifications are wrapped in database transactions to ensure data integrity.
- **Reprocessing**: Supports re-parsing previously uploaded Excel files without re-uploading.

### Key Database Tables
-   `users`: User authentication and role-based access.
-   `projectInfo`: Core project metadata.
-   `programExpense`, `programInflows`: Detailed expenditure and revenue entries.
-   `projectPlan`: Project task and milestone data.
-   `cashflowPlanningOverrides`: Stores user-defined cashflow adjustments.
-   `uploadMetadata`, `refreshLogs`: Audit trails for data ingestion.

## External Dependencies

### Database & ORM
-   **PostgreSQL**: Primary data store.
-   **Drizzle ORM**: Type-safe ORM for database interactions.
-   **connect-pg-simple**: PostgreSQL session store.

### Authentication & Security
-   **Passport.js**: Authentication middleware.
-   **bcryptjs**: Password hashing.

### File Processing
-   **xlsx**: Excel file parsing library.
-   **multer**: Middleware for handling `multipart/form-data`.

### Frontend Libraries
-   **@tanstack/react-query**: Data fetching, caching, and state management.
-   **recharts**: Declarative charting library.
-   **date-fns**: Date utility library.
-   **zod**: Schema declaration and validation (shared).

### UI Libraries
-   **@radix-ui/**: Accessible UI component primitives.
-   **tailwindcss**: Utility-first CSS framework.