/**
 * App-level ACL for document-management folders.
 *
 * Each top-level folder under a root (Engineering, Contracts, Photos,
 * Client Docs, Internal Docs, HR, Templates, Policies, …) has its own
 * read / write / delete capability set mapped to `COMPANY_ROLES` from
 * shared/schema/users.ts. The real SharePoint permission system is still
 * the ultimate enforcement layer (delegated-token writes flow through
 * the user's own SSO token); this config gives the app UI a fast, shared
 * ACL that keeps write buttons honest without a Graph round-trip.
 *
 * Folder matching is based on the FIRST path segment under the root —
 * e.g. "Engineering/Design/spec.pdf" matches "Engineering". An ACL entry
 * without a match is denied by default.
 *
 * NOTE: these top-folder labels are placeholders until the real folder
 * template is confirmed with operations. `resolveFolderAcl` treats
 * unknown segments as `READ_ONLY_FALLBACK` to fail safe.
 */

import {
  COMPANY_ROLES,
  type CompanyRole,
} from "@shared/schema/users";
import type { DocumentRootScope } from "@shared/schema/documents";

type RoleCode = CompanyRole;

export const DOCUMENT_ACTIONS = ["read", "write", "delete"] as const;
export type DocumentAction = (typeof DOCUMENT_ACTIONS)[number];

export interface DocumentFolderAcl {
  scope: DocumentRootScope;
  /** First path segment to match (case-insensitive). */
  prefix: string;
  read: readonly RoleCode[];
  write: readonly RoleCode[];
  delete: readonly RoleCode[];
}

const SUPER_ROLES: readonly RoleCode[] = ["COO_ADMIN", "CEO_ADMIN"] as const;

const ALL_ROLES = COMPANY_ROLES as readonly RoleCode[];

// Safe default when a folder hasn't been mapped yet — everyone can read,
// only super-users can write. Delete is in a later phase anyway.
const READ_ONLY_FALLBACK: DocumentFolderAcl = {
  scope: "project",
  prefix: "",
  read: ALL_ROLES,
  write: SUPER_ROLES,
  delete: SUPER_ROLES,
};

export const DOCUMENT_FOLDER_ACL: ReadonlyArray<DocumentFolderAcl> = [
  // --- Project roots ---
  {
    scope: "project",
    prefix: "engineering",
    read: ALL_ROLES,
    write: [
      ...SUPER_ROLES,
      "PROGRAM_MANAGER",
      "ENGINEERING_MANAGER",
      "ENGINEER",
      "PROJECT_MANAGER_SITE",
      "CONSTRUCTION_MANAGER",
    ],
    delete: [...SUPER_ROLES, "ENGINEERING_MANAGER"],
  },
  {
    scope: "project",
    prefix: "contracts",
    read: [
      ...SUPER_ROLES,
      "CFO",
      "PROGRAM_MANAGER",
      "PROGRAM_FINANCE_MANAGER",
      "CCO",
      "KEY_ACCOUNTS_MANAGER",
      "PROJECT_DEVELOPER",
      "ACCOUNTANT",
    ],
    write: [...SUPER_ROLES, "CFO", "PROGRAM_MANAGER", "CCO"],
    delete: [...SUPER_ROLES],
  },
  {
    scope: "project",
    prefix: "photos",
    read: ALL_ROLES,
    write: [
      ...SUPER_ROLES,
      "PROJECT_MANAGER_SITE",
      "CONSTRUCTION_MANAGER",
      "QUALITY_MANAGER",
      "ENGINEER",
      "ENGINEERING_MANAGER",
      "PROGRAM_MANAGER",
      "HSE_MANAGER",
    ],
    delete: [...SUPER_ROLES, "PROGRAM_MANAGER", "QUALITY_MANAGER"],
  },
  {
    scope: "project",
    prefix: "client docs",
    read: ALL_ROLES,
    write: [
      ...SUPER_ROLES,
      "PROGRAM_MANAGER",
      "KEY_ACCOUNTS_MANAGER",
      "PROJECT_MANAGER_SITE",
      "CCO",
    ],
    delete: [...SUPER_ROLES, "PROGRAM_MANAGER"],
  },
  {
    scope: "project",
    prefix: "internal docs",
    read: ALL_ROLES,
    write: [
      ...SUPER_ROLES,
      "PROGRAM_MANAGER",
      "ENGINEERING_MANAGER",
      "QUALITY_MANAGER",
      "CONSTRUCTION_MANAGER",
      "PROJECT_MANAGER_SITE",
    ],
    delete: [...SUPER_ROLES],
  },

  // --- Company roots ---
  {
    scope: "company",
    prefix: "hr",
    read: [
      ...SUPER_ROLES,
      "PROGRAM_MANAGER",
      "ENGINEERING_MANAGER",
      "QUALITY_MANAGER",
      "CONSTRUCTION_MANAGER",
      "CFO",
      "CCO",
    ],
    write: [...SUPER_ROLES],
    delete: [...SUPER_ROLES],
  },
  {
    scope: "company",
    prefix: "templates",
    read: ALL_ROLES,
    write: [
      ...SUPER_ROLES,
      "PROGRAM_MANAGER",
      "ENGINEERING_MANAGER",
      "QUALITY_MANAGER",
    ],
    delete: [...SUPER_ROLES],
  },
  {
    scope: "company",
    prefix: "policies",
    read: ALL_ROLES,
    write: [...SUPER_ROLES],
    delete: [...SUPER_ROLES],
  },
];

function firstSegment(relativePath: string): string {
  const trimmed = relativePath.replace(/^\/+/, "").replace(/\\/g, "/");
  const idx = trimmed.indexOf("/");
  return (idx < 0 ? trimmed : trimmed.slice(0, idx)).toLowerCase();
}

/**
 * Resolves the ACL entry for a given folder segment under a root. Returns
 * READ_ONLY_FALLBACK when no entry matches (fail-safe: everyone reads,
 * only super-users write).
 */
export function resolveFolderAcl(
  scope: DocumentRootScope,
  pathUnderRoot: string | null | undefined,
): DocumentFolderAcl {
  const segment = firstSegment(pathUnderRoot ?? "");
  if (!segment) return { ...READ_ONLY_FALLBACK, scope };
  for (const entry of DOCUMENT_FOLDER_ACL) {
    if (entry.scope !== scope) continue;
    if (entry.prefix.toLowerCase() === segment) return entry;
  }
  return { ...READ_ONLY_FALLBACK, scope };
}

function normalizeRole(role: string | null | undefined): RoleCode | null {
  if (!role) return null;
  const upper = role.toUpperCase().replace(/[^A-Z_]/g, "_");
  return (COMPANY_ROLES as readonly string[]).includes(upper)
    ? (upper as RoleCode)
    : null;
}

/**
 * True when the given user role is permitted to perform the action on
 * the given folder ACL. Super-users always pass.
 */
export function canPerform(
  action: DocumentAction,
  role: string | null | undefined,
  acl: DocumentFolderAcl,
): boolean {
  const normalized = normalizeRole(role);
  if (!normalized) return false;
  if (SUPER_ROLES.includes(normalized)) return true;
  const allowed = acl[action] ?? [];
  return allowed.includes(normalized);
}
