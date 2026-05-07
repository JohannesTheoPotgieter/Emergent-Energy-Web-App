// Thin re-export. The canonical barrel lives at shared/schema/index.ts.
// Kept so existing `from "@shared/schema"` imports continue to resolve here
// (file beats directory under bundler resolution).
export * from "./schema/index";
