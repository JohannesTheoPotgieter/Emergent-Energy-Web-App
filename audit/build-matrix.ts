/**
 * Per-page × per-role matrix and conflict report.
 *
 * Source-of-truth definitions for "nav-visible to a role":
 *   1. The path appears in TOP_SECTIONS[].secondary (this is the actual
 *      sidebar source — page-registry's `showInSidebar` flag is registry
 *      metadata and includes detail/utility routes that are not sidebar links).
 *   2. The role's section is allowed by ROLE_VISIBLE_SECTIONS.
 *
 * "Conflict" = nav-visible AND a permissionEntity is mapped AND the role
 * is NOT in entity.view_roles (i.e. user can click the sidebar link and
 * the backend would deny the resulting view).
 */
import { PAGE_REGISTRY, type PageRegistryEntry } from "../client/src/config/page-registry";
import { TOP_SECTIONS, ROLE_VISIBLE_SECTIONS, type SectionKey } from "../client/src/config/app-navigation";
import {
  COMPANY_ROLES,
  ENTITY_PERMISSION_DEFAULTS,
  ROLE_PERMISSION_ALIASES,
  type CompanyRole,
  type EntityPermissionRule,
} from "../shared/schema/users";
import * as fs from "node:fs";

type RoleId = CompanyRole | "COO_SUPER_ADMIN";

// Build path -> SectionKey from the actual sidebar (TOP_SECTIONS.secondary).
const PATH_TO_SECTION = new Map<string, SectionKey>();
for (const section of TOP_SECTIONS) {
  for (const item of section.secondary) {
    const basePath = item.path.split("?")[0];
    if (!PATH_TO_SECTION.has(basePath)) PATH_TO_SECTION.set(basePath, section.key);
  }
}

// Index entity rules.
const entityRules = new Map<string, EntityPermissionRule>();
for (const rule of ENTITY_PERMISSION_DEFAULTS) entityRules.set(rule.entity, rule);

const allRoles: RoleId[] = [...COMPANY_ROLES, "COO_SUPER_ADMIN"];

function effectiveRole(role: RoleId): CompanyRole {
  const aliased = ROLE_PERMISSION_ALIASES[role as string];
  return (aliased ?? role) as CompanyRole;
}

function ynForRoleSet(role: CompanyRole, roleList: readonly string[] | undefined): "Y" | "N" {
  return roleList?.includes(role) ? "Y" : "N";
}

function pageEntityRule(page: PageRegistryEntry): EntityPermissionRule | undefined {
  return page.permissionEntity ? entityRules.get(page.permissionEntity) : undefined;
}

const header: string[] = ["path", "label", "section", "permissionEntity", "isSidebarLink"];
for (const r of allRoles) header.push(`${r}:nav`, `${r}:view`, `${r}:create`, `${r}:edit`, `${r}:delete`);

const rows: string[][] = [header];
type Conflict = { role: RoleId; path: string; label: string; entity: string; section: SectionKey };
const conflicts: Conflict[] = [];

for (const page of PAGE_REGISTRY) {
  if (page.type === "alias") continue; // redirects don't render permission-bearing UI
  const basePath = page.path.split("?")[0];
  const sectionFromSidebar = PATH_TO_SECTION.get(basePath);
  const isSidebarLink = sectionFromSidebar !== undefined;
  const rule = pageEntityRule(page);
  const entity = page.permissionEntity ?? "";

  const row: string[] = [
    page.path,
    page.label,
    sectionFromSidebar ?? "",
    entity,
    isSidebarLink ? "Y" : "N",
  ];

  for (const r of allRoles) {
    const eff = effectiveRole(r);
    const sectionAllowed = sectionFromSidebar
      ? ROLE_VISIBLE_SECTIONS[eff].includes(sectionFromSidebar)
      : false;
    const navMark = isSidebarLink && sectionAllowed ? "Y" : "N";
    const view = rule ? ynForRoleSet(eff, rule.view_roles) : "-";
    const create = rule ? ynForRoleSet(eff, rule.create_roles) : "-";
    const edit = rule ? ynForRoleSet(eff, rule.edit_roles) : "-";
    const del = rule ? ynForRoleSet(eff, rule.delete_roles) : "-";
    row.push(navMark, view, create, edit, del);

    if (isSidebarLink && sectionAllowed && rule && view === "N" && sectionFromSidebar) {
      conflicts.push({ role: r, path: page.path, label: page.label, entity, section: sectionFromSidebar });
    }
  }
  rows.push(row);
}

fs.writeFileSync(
  "audit/per-page-per-role-matrix.csv",
  rows.map((r) => r.map((c) => (/[",\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(",")).join("\n"),
);

const byRole = new Map<RoleId, Conflict[]>();
for (const c of conflicts) {
  const arr = byRole.get(c.role) ?? [];
  arr.push(c);
  byRole.set(c.role, arr);
}

const sidebarPageCount = Array.from(PATH_TO_SECTION.keys()).length;
const aliasCount = PAGE_REGISTRY.filter((p) => p.type === "alias").length;
let md = "# Per-Page × Per-Role Conflicts (sidebar-grounded)\n\n";
md += `**Sources:** \`PAGE_REGISTRY\` (${PAGE_REGISTRY.length} entries, ${PAGE_REGISTRY.filter((p) => p.type !== "alias").length} non-alias) intersected with \`TOP_SECTIONS.secondary\` (${sidebarPageCount} actual sidebar paths) × ${allRoles.length} roles.\n\n`;
md += `**Excluded:** ${aliasCount} alias entries (\`type === "alias"\`) — these are pure redirects with no permission surface of their own. Sidebar links that target an alias path resolve via the alias's destination, which is itself a non-alias entry covered by this matrix.\n\n`;
md += `**Conflict definition:** the path is in the sidebar (TOP_SECTIONS.secondary), the role's section is allowed, an entity is mapped, but the role is not in \`entity.view_roles\`.\n\n`;
md += `**Methodology note.** This is a *policy-baseline* analysis. A "conflict" here means the role would be denied by the entity-rule policy (\`ENTITY_PERMISSION_DEFAULTS\`) — but individual endpoints may layer additional gates (project-membership, named middleware) or, conversely, fail to apply the entity rule at all. Runtime confirmation lives in \`audit/runtime-probes.md\`; treat this matrix as a starting set of *suspected* clickable-but-denied sidebar links rather than a definitive runtime behaviour map.\n\n`;
md += `**Scope.** Expanded from the original foundation-audit chat deliverable to include on-disk artefacts: this matrix + the runtime probes. §6 behavioural fixes (procurement sidebar leakage, COO_SUPER_ADMIN labelling, eng_stages delete drift, requirePriorityAdmin policy registration) are intentionally not applied here — they are tracked as separate follow-up tasks.\n\n`;
md += `**Total conflicts:** ${conflicts.length}\n\n`;
for (const r of allRoles) {
  const cs = byRole.get(r) ?? [];
  md += `\n## ${r} — ${cs.length} conflict${cs.length === 1 ? "" : "s"}\n\n`;
  if (!cs.length) { md += "_None._\n"; continue; }
  md += "| Path | Label | Entity | Section |\n|---|---|---|---|\n";
  for (const c of cs) md += `| \`${c.path}\` | ${c.label} | \`${c.entity}\` | ${c.section} |\n`;
}
fs.writeFileSync("audit/per-page-per-role-conflicts.md", md);

console.log(`PAGE_REGISTRY: ${PAGE_REGISTRY.length} (sidebar-linked: ${sidebarPageCount})`);
console.log(`Roles: ${allRoles.length}`);
console.log(`Conflicts: ${conflicts.length}`);
