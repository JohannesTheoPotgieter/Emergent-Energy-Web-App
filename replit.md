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