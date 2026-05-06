# Permission Model Alignment

## Layer Breakdown

The permission system operates across four distinct layers. The Roles & Permissions screen now exposes all four to the admin.

### Layer 1: Navigation Access

**What it controls:** Which sidebar sections and routes a role can see and reach.

**How it works:**
- Each role has a `sections` array stored in the `role_permissions` table
- The sidebar filters items based on this array
- Routes are gated by the `RoleGuard` component in `App.tsx`
- Hard-coded path whitelists exist for restricted roles (e.g., `PROJECT_MANAGER_SITE`)

**Enforcement:** Fully enforced. Hiding a section removes sidebar links AND blocks the routes.

**Admin control:** Toggle switches in the Navigation tab.

---

### Layer 2: Functional Permissions (Capabilities)

**What it controls:** What operations a role can perform on specific entities/features.

**Actions available:**
| Action | Risk Level | Description |
|---|---|---|
| View | Low | Read-only access to the feature |
| Edit | Medium | Create or modify data |
| Approve | Medium | Sign off on stages, expenses, quality items |
| Override | High | Bypass standard logic or constraints |
| Delete | High | Remove records |

**How it works:**
- Two-tiered resolution: database overrides checked first, then falls back to `ENTITY_PERMISSION_DEFAULTS`
- Permission cache with 60-second TTL for performance
- Backend middleware `requirePermission(entity, action)` enforces on write routes

**Enforcement:** Mixed.
- 47 critical write routes have backend `requirePermission` or `requireAdmin` middleware
- Some features are UI-gated only (sidebar/button visibility) without dedicated backend middleware
- Backend-enforced entities are marked with "BE" badge in the Capabilities tab

**Admin control:** Toggle buttons per entity/action in the Capabilities tab.

---

### Layer 3: Scope Rules

**What it controls:** Which subset of records a role can see within a permitted feature.

**Scope tiers:**
| Tier | Description | Roles |
|---|---|---|
| Full Oversight | All projects, tasks, and data | CEO Admin, COO Admin, CCO, CFO, Program Manager, Finance PM, Accountant |
| Owned Projects | Projects they own (PM) + assigned tasks | Project Manager (Site) |
| Assigned Only | Only directly assigned tasks and projects | Engineer |
| Own Records | Only records they created | Project Developer |

**Backend-enforced scope rules:**
| Endpoint | Scope |
|---|---|
| `GET /api/projects-summary` | Ownership metadata + optional `scope=owned` filter |
| `GET /api/tasks` | Non-management users scoped to assigned/owned tasks |
| `GET /api/my-work/all-tasks` | Strictly scoped to current user |
| `GET /api/pd/tickets` | PD sees own tickets, admin sees all |
| Smart Import (all writes) | Admin-only access enforced |

**Enforcement:** Backend-enforced on the endpoints listed above. Some read endpoints still rely on application-level filtering.

**Admin control:** Read-only in the Scope & Limits tab. Scope rules are not configurable per role — they are determined by the role tier.

---

### Layer 4: Enforcement Truth

**What it shows:** Honest accounting of what is truly enforced vs what relies on UI gating.

**Categories:**
| Category | Count | Description |
|---|---|---|
| Backend-Enforced Routes | 47 | Write routes with `requirePermission`/`requireAdmin` middleware |
| Ownership-Scoped Endpoints | 5 | Read endpoints with backend data filtering |
| Application-Logic Only | 2 | Endpoints relying on frontend context for scoping |

**Known limitations:**
1. Row-level security (RLS) not fully implemented — some read endpoints use application-level filtering
2. Project-specific read endpoints scoped by frontend project context, not backend ownership
3. Rate limiting and brute-force protection not yet implemented
4. Detailed change-level audit trails for permission changes not yet available

**Admin control:** Read-only in the Enforcement & Risks tab. Shows live data from the permission enforcement API.

---

## What Is Truly Enforced vs Still Limited

### Fully Enforced
- Navigation access (sidebar visibility + route blocking)
- 47 write routes with backend permission middleware
- 5 read endpoints with ownership scoping
- Smart Import operations restricted to admin only
- Settings route requires admin authentication
- Financial approvals require finance-specific roles

### UI-Gated Only (Not Backend-Enforced)
- Some entity view/edit toggles that control button/component visibility but don't have dedicated backend middleware
- Project detail tab visibility
- Collaboration feature access
- Gamification and leaderboard access

### Not Yet Implemented
- Full row-level security across all database queries
- Rate limiting
- IP-based access controls
- Comprehensive audit trails for every permission change
