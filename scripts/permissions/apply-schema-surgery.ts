#!/usr/bin/env tsx
/**
 * One-shot surgery — Task #101.
 *
 * Three edits to shared/schema/users.ts:
 *   1. Add `import { ENTITY_PERMISSION_DEFAULTS } from "../permissions/registry"`
 *      at the top of the import block, AND a re-export so the public surface
 *      stays identical.
 *   2. Replace the in-file ENTITY_PERMISSION_DEFAULTS array (lines 320-1339)
 *      with a one-line re-export sentinel + comment block.
 *   3. Insert two new optional `notes` columns (rolePermissions,
 *      userPermissionOverrides) and the new roleTemplates table.
 *
 * All PK types stay `serial("id").primaryKey()`. No existing column types touched.
 *
 * Idempotent: re-running the script on an already-surgeon'd file is a no-op
 * because each edit is guarded by a marker check.
 */
import fs from "node:fs";
import path from "node:path";

const file = path.join(process.cwd(), "shared/schema/users.ts");
let src = fs.readFileSync(file, "utf8");

const REGISTRY_IMPORT = `import { ENTITY_PERMISSION_DEFAULTS } from "../permissions/registry";\nexport { ENTITY_PERMISSION_DEFAULTS } from "../permissions/registry";\nexport { ENTITY_REGISTRY, PERMISSION_CATEGORIES, findEntityRegistry, entityTitle } from "../permissions/registry";\nexport type { EntityRegistryEntry, PermissionCategoryKey } from "../permissions/registry";\n`;

if (!src.includes('from "../permissions/registry"')) {
  src = src.replace(
    `import { z } from "zod";\n`,
    `import { z } from "zod";\n${REGISTRY_IMPORT}`,
  );
  console.log("[surgery] inserted registry import + re-exports");
}

// 2. Replace the giant ENTITY_PERMISSION_DEFAULTS literal with a comment.
const beforeMarker = "export const ENTITY_PERMISSION_DEFAULTS: EntityPermissionRule[] = [";
const idx = src.indexOf(beforeMarker);
if (idx !== -1) {
  // Find the closing `];` for this block.
  let depth = 0;
  let i = idx + beforeMarker.length - 1; // position of `[`
  for (; i < src.length; i++) {
    if (src[i] === "[") depth++;
    else if (src[i] === "]") {
      depth--;
      if (depth === 0) break;
    }
  }
  // Expect `];` after the closing bracket.
  const endOfBlock = src.indexOf(";", i) + 1;
  const replacement = `// ENTITY_PERMISSION_DEFAULTS now lives in shared/permissions/registry.ts\n// (canonical source). It is re-exported above so every existing import keeps\n// working — see the registry file for entity titles, descriptions, and categories.`;
  src = src.slice(0, idx) + replacement + src.slice(endOfBlock);
  console.log(`[surgery] removed in-file ENTITY_PERMISSION_DEFAULTS array (${endOfBlock - idx} chars)`);
}

// 3a. Add `notes` to rolePermissions table definition.
if (!src.match(/notes: text\("notes"\),\s*\n\s*createdAt: timestamp\("created_at"\)\.notNull\(\)\.defaultNow\(\),\s*\n\s*updatedAt: timestamp\("updated_at"\)\.notNull\(\)\.defaultNow\(\),\s*\n}\);\s*\n\s*export const insertRolePermissionSchema/)) {
  src = src.replace(
    `  permissionVersion: integer("permission_version").notNull().default(1),\n  createdAt: timestamp("created_at").notNull().defaultNow(),\n  updatedAt: timestamp("updated_at").notNull().defaultNow(),\n});\n\nexport const insertRolePermissionSchema`,
    `  permissionVersion: integer("permission_version").notNull().default(1),\n  notes: text("notes"),\n  createdAt: timestamp("created_at").notNull().defaultNow(),\n  updatedAt: timestamp("updated_at").notNull().defaultNow(),\n});\n\nexport const insertRolePermissionSchema`,
  );
  console.log("[surgery] added notes column to rolePermissions");
}

// 3b. Add `notes` to userPermissionOverrides.
if (!src.match(/createdAt: timestamp\("created_at"\)\.notNull\(\)\.defaultNow\(\),\s*\n\s*deletedAt: timestamp\("deleted_at"\),\s*\n\s*deletedBy: integer\("deleted_by"\),\s*\n\s*notes: text\("notes"\)/)) {
  src = src.replace(
    `  createdAt: timestamp("created_at").notNull().defaultNow(),\n  deletedAt: timestamp("deleted_at"),\n  deletedBy: integer("deleted_by"),\n});\nexport type UserPermissionOverride`,
    `  createdAt: timestamp("created_at").notNull().defaultNow(),\n  deletedAt: timestamp("deleted_at"),\n  deletedBy: integer("deleted_by"),\n  notes: text("notes"),\n});\nexport type UserPermissionOverride`,
  );
  console.log("[surgery] added notes column to userPermissionOverrides");
}

// 3c. Insert roleTemplates table after rolePermissions block.
if (!src.includes("export const roleTemplates")) {
  const ROLE_TEMPLATES_BLOCK = `

// ===================== ROLE TEMPLATES =====================

/**
 * Curated role templates ("starter packs") shown in the Roles & Permissions
 * admin UI. Each template captures plain-English summary plus the entity
 * permissions and section access. Seeded on boot from
 * shared/permissions/templates.ts. NEW table — additive.
 */
export const roleTemplates = pgTable("role_templates", {
  id: serial("id").primaryKey(),
  key: text("key").notNull().unique(),
  name: text("name").notNull(),
  summary: text("summary").notNull(),
  category: text("category").notNull(),
  permissions: jsonb("permissions").notNull(),
  sections: text("sections").array().notNull().default([]),
  isSystem: boolean("is_system").notNull().default(true),
  seededAt: timestamp("seeded_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
export const insertRoleTemplateSchema = createInsertSchema(roleTemplates).omit({ id: true, seededAt: true, updatedAt: true } as any);
export type InsertRoleTemplate = z.infer<typeof insertRoleTemplateSchema>;
export type RoleTemplate = typeof roleTemplates.$inferSelect;
`;
  src = src.replace(
    "// ===================== USER PERMISSION OVERRIDES =====================",
    `${ROLE_TEMPLATES_BLOCK}\n// ===================== USER PERMISSION OVERRIDES =====================`,
  );
  console.log("[surgery] inserted roleTemplates table");
}

fs.writeFileSync(file, src);
console.log(`[surgery] wrote ${file}`);
