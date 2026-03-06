# Future PM Platform Foundation Map

## Version: 1.0 | Date: 2026-03-06

## Purpose
This document maps the current platform foundation to future PM (Project Management) platform expansion, identifying which systems are ready for scaling and which need further work.

## Foundation Components Ready for Expansion

### 1. Canonical Task Engine
**Current State**: Fully operational with 6 statuses, 4 priorities, 5 task types
**Future PM Use**: Foundation for cross-project task aggregation, portfolio-level task analytics, resource capacity planning
**Extension Points**:
- Add `estimated_hours` and `actual_hours` to canonical task model for effort tracking
- Add `milestone_id` for milestone-based tracking
- Add `dependency_ids` array for task dependency chains
- Add `sprint_id` for agile sprint tracking (if adopted)

### 2. Role & Permission System
**Current State**: 13 roles, 30+ entities, configurable entity-level permissions
**Future PM Use**: Support for client-facing roles, contractor roles, external auditor read-only access
**Extension Points**:
- Add `CLIENT` and `EXTERNAL_AUDITOR` roles with view-only permissions
- Add project-level role overrides (PM per project, not just globally)
- Add team-based permissions (engineering team A vs B)

### 3. Audit Trail
**Current State**: 170+ audit points, typed helpers, activity log UI
**Future PM Use**: Compliance reporting, change management audit, client-visible activity feeds
**Extension Points**:
- Add audit report generation (PDF export by date range)
- Add project-scoped audit views for PM dashboards
- Add automated alerts on sensitive changes (role modifications, financial edits)

### 4. Admin Control Center
**Current State**: System health, feature flags, integration status, dangerous actions
**Future PM Use**: Multi-tenant system administration, per-client configuration
**Extension Points**:
- Add system performance metrics (API response times, query counts)
- Add user session monitoring
- Add data export/import tools for client data migration

### 5. Financial Engine
**Current State**: COS tracking, revenue calculation, GP tracking, cashflow, OPEX
**Future PM Use**: Budget forecasting, earned value management, multi-currency support
**Extension Points**:
- Add budget vs actual variance reporting
- Add forecasting models (linear, curve-based)
- Add multi-currency with exchange rate tracking

### 6. Work Item Model
**Current State**: 3,000+ work items, WBS hierarchy, baseline tracking, actual dates
**Future PM Use**: MS Project integration, critical path analysis, resource leveling
**Extension Points**:
- Add `constraint_type` and `constraint_date` for scheduling constraints
- Add `calendar_id` for working day calendars
- Add `cost_rate` for resource cost tracking

## Architecture Decisions for Future

### Database
- Continue using PostgreSQL with Drizzle ORM
- Use raw SQL migrations via db.execute for schema changes
- Consider read replicas for reporting queries at scale

### API Design
- Maintain RESTful patterns with typed error responses
- Add pagination to all list endpoints (some already have it)
- Consider GraphQL for complex cross-entity queries

### Frontend
- Maintain React + TanStack Query + shadcn/ui stack
- Add virtualized lists for large datasets (>1000 items)
- Consider micro-frontend architecture if separate PM and Finance modules emerge

### Authentication
- Maintain Azure AD SSO as primary
- Add multi-tenant support via organization_id on all entities
- Consider OAuth2 for client portal access

## Priority Roadmap

### Phase 1 (Next Quarter)
1. Project-level role overrides
2. Budget vs actual variance reporting
3. Audit report PDF export
4. API pagination on all endpoints

### Phase 2 (Following Quarter)
1. Client portal with read-only access
2. Resource capacity planning
3. Multi-currency support
4. Task dependency visualization

### Phase 3 (Future)
1. MS Project live sync
2. Critical path analysis
3. Multi-tenant architecture
4. Mobile app (React Native)
