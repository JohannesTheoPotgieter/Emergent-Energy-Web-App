# Roles & Permissions UX Rework

## What Was Wrong Before

### 1. Flat, Mixed Structure
The previous screen combined navigation access (section toggles) and entity-level permissions (View/Edit/Approve/Override/Delete) in a single scrollable list. Admins could not clearly distinguish between "what can this role see in the sidebar" vs "what can this role do with features."

### 2. No Scope Visibility
There was no information about data scope — whether a role sees all records, only assigned records, or only owned records. Admins had to guess based on experience.

### 3. No Enforcement Truth
The screen did not distinguish between permissions that are truly enforced by the backend vs permissions that only affect UI visibility. Admins were configuring permissions without knowing whether they were actually secure.

### 4. Ambiguous Action Labels
Permission actions used single-letter pills (V, E, A, O, D) which were compact but easy to misread. No visual indication of which actions are high-risk (delete, override).

### 5. No Role Summary
No quick overview of a role's total configuration — how many sections, how many editable entities, how many high-risk permissions.

### 6. No Role Comparison
Admins had to manually switch between roles to understand differences.

---

## What Changed

### 1. Four-Tab Information Architecture
The Permissions tab is now split into 4 sub-tabs:

| Tab | Purpose |
|---|---|
| **Navigation** | Controls sidebar section visibility. Shows each section with its pages listed. Clear on/off switches with status badges. |
| **Capabilities** | Entity-level permission matrix (View/Edit/Approve/Override/Delete) grouped by business area. Searchable. Backend-enforced entities marked with "BE" badge. |
| **Scope & Limits** | Shows scope tiers (Full Oversight, Owned Projects, Assigned Only, Own Records) and highlights which tier applies to the selected role. Lists all backend-enforced scope rules. |
| **Enforcement & Risks** | Shows backend enforcement stats, high-risk permissions for the selected role, backend-enforced vs UI-only features, and known limitations. |

### 2. Enhanced Role List Panel
- Search/filter for roles
- System/Custom badge per role
- Risk level indicator (shield icon for high-risk roles)

### 3. Role Summary Header
- System vs Custom badge
- Section count, editable entity count, high-risk permission count
- Total features count

### 4. Role Comparison
- Compare button in the role list header
- Select two roles to see a side-by-side diff of all permission differences
- Shows category, feature, action, and which role has access

### 5. Enforcement Panel
- Pulls live data from the Admin Control Center permission enforcement API
- Shows backend-enforced route count, ownership-scoped endpoints, app-logic-only endpoints, recent access denials
- Lists high-risk permissions, backend-enforced features, and UI-only features for the selected role
- Enumerates known limitations honestly

### 6. Backend-Enforced Markers
- Entities with backend middleware are marked with a green "BE" badge in the Capabilities tab
- Makes it clear which permission toggles have real backend enforcement vs UI-only gating

---

## How the New Screen Maps to the Actual App

| Navigation Section | Sidebar Pages | Permission Category |
|---|---|---|
| My Work | Command Center, Tasks, Approvals, Calendar, Meetings, Email, Teams Chat | My Work |
| Project Development | PD Dashboard, PD Tickets, Clients, Lifecycle Board | Project Development |
| Engineering | Eng Dashboard, Task Board | Engineering |
| Quality | Quality Dashboard | Quality |
| Project Management | Project List, Portfolios, Execution Board, PM Dashboard, On-The-Go, Weekly Reviews | Project Management |
| Finance | Cashflow, COS Tracker, Revenue Tracker, GP Tracker, Procurement, Invoice Patterns | Finance |
| System / Admin | Control Center, Users & Roles, App Settings, Activity Log, Smart Import, Recovery Center | System / Admin |
| (Always On) | Per-project tabs | Project Detail Tabs |

Each navigation section in the Navigation tab corresponds exactly to a sidebar group. Each permission category in the Capabilities tab corresponds to one of these sections. Turning off a navigation section visually disables the corresponding capability section, making the relationship clear.
