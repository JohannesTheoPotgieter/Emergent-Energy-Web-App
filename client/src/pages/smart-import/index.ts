/**
 * Smart import page - barrel export.
 *
 * The default export is the main SmartImportPage orchestrator component.
 * Named exports provide access to sub-components for selective importing.
 */

// Default export: orchestrator (preserves lazy-import compatibility)
export { default } from "../smart-import";

// Sub-component modules
export * from "./ImportUploadStep";
export * from "./ImportMappingStep";
export * from "./ImportIssueResolution";
export * from "./ImportCommitStep";
