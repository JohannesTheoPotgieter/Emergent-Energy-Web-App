// ============================================================
// BARREL RE-EXPORT FILE
// ============================================================
// This file re-exports all domain schema files so that existing
// imports from "@shared/schema" continue to work unchanged.
//
// Domain files live in shared/schema/ directory:
//   users.ts, projects.ts, finance.ts, engineering.ts,
//   tasks.ts, quality.ts, mytool.ts, imports.ts,
//   legacy.ts, collaboration.ts
// ============================================================

export * from "./schema/users";
export * from "./schema/projects";
export * from "./schema/finance";
export * from "./schema/engineering";
export * from "./schema/tasks";
export * from "./schema/quality";
export * from "./schema/mytool";
export * from "./schema/imports";
export * from "./schema/legacy";
export * from "./schema/collaboration";
