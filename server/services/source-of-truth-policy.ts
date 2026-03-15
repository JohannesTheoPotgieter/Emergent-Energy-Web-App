export type SourceOfTruthClass = "EXCEL_MASTERED" | "APP_MASTERED" | "HYBRID_GOVERNED";

const PROJECT_INFO_EXCEL_MASTERED_FIELDS = new Set([
  "projectName",
  "phase",
  "executionPhase",
  "pd",
  "pm",
  "sizeKwp",
  "contractValue",
  "constructionStartDate",
  "commissioningDate",
  "omHandoverDate",
  "clientHandoverDate",
  "pdHandoverDate",
  "clientId",
]);

const PROJECT_INFO_APP_MASTERED_FIELDS = new Set([
  "latestUpdate",
  "escalationLevel",
]);

export function classifyProjectInfoField(field: string): SourceOfTruthClass {
  if (PROJECT_INFO_EXCEL_MASTERED_FIELDS.has(field)) return "EXCEL_MASTERED";
  if (PROJECT_INFO_APP_MASTERED_FIELDS.has(field)) return "APP_MASTERED";
  return "HYBRID_GOVERNED";
}

export function classifyProjectInfoPayload(payload: Record<string, unknown>) {
  const touchedFields = Object.keys(payload);
  const excelMasteredFields = touchedFields.filter((field) => classifyProjectInfoField(field) === "EXCEL_MASTERED");
  const appMasteredFields = touchedFields.filter((field) => classifyProjectInfoField(field) === "APP_MASTERED");
  const hybridGovernedFields = touchedFields.filter((field) => classifyProjectInfoField(field) === "HYBRID_GOVERNED");

  return {
    touchedFields,
    excelMasteredFields,
    appMasteredFields,
    hybridGovernedFields,
    requiresSourceUpdateGovernance: excelMasteredFields.length > 0,
  };
}
