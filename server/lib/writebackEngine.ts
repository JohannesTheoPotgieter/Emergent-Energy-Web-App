import * as XLSX from "xlsx";
import * as fs from "fs";
import * as path from "path";
import type { WritebackMapping, WritebackAuditLog } from "@shared/schema";

export interface WritebackResult {
  mappingId: number;
  cellAddress: string;
  previousValue: string | null;
  newValue: string;
  status: "applied" | "failed" | "skipped";
  errorMessage?: string;
}

export interface WritebackBatchResult {
  workbookPath: string;
  totalMappings: number;
  applied: number;
  failed: number;
  skipped: number;
  results: WritebackResult[];
}

function resolveSourceValue(
  sourceField: string,
  entityType: string,
  data: Record<string, any>
): string | null {
  if (!data) return null;
  const value = data[sourceField];
  if (value === undefined || value === null) return null;
  return String(value);
}

function applyTransform(value: string, transform: string | null): string {
  if (!transform) return value;
  try {
    switch (transform) {
      case "number":
        return String(Number(value));
      case "currency":
        return String(Number(value).toFixed(2));
      case "percentage":
        return String((Number(value) * 100).toFixed(1));
      case "date":
        return new Date(value).toISOString().split("T")[0];
      case "uppercase":
        return value.toUpperCase();
      case "lowercase":
        return value.toLowerCase();
      default:
        return value;
    }
  } catch {
    return value;
  }
}

function validateValue(value: string, rule: string | null): { valid: boolean; error?: string } {
  if (!rule) return { valid: true };
  try {
    switch (rule) {
      case "required":
        return value.trim() ? { valid: true } : { valid: false, error: "Value is required" };
      case "numeric":
        return !isNaN(Number(value)) ? { valid: true } : { valid: false, error: "Value must be numeric" };
      case "positive":
        return Number(value) > 0 ? { valid: true } : { valid: false, error: "Value must be positive" };
      case "date":
        return !isNaN(Date.parse(value)) ? { valid: true } : { valid: false, error: "Value must be a valid date" };
      default:
        return { valid: true };
    }
  } catch {
    return { valid: false, error: `Validation failed: ${rule}` };
  }
}

export function executeWriteback(
  mappings: WritebackMapping[],
  dataByEntity: Record<string, Record<string, any>[]>
): WritebackBatchResult[] {
  const resultsByWorkbook = new Map<string, WritebackBatchResult>();

  for (const mapping of mappings) {
    const workbookPath = mapping.workbookPath;
    if (!resultsByWorkbook.has(workbookPath)) {
      resultsByWorkbook.set(workbookPath, {
        workbookPath,
        totalMappings: 0,
        applied: 0,
        failed: 0,
        skipped: 0,
        results: [],
      });
    }
    const batch = resultsByWorkbook.get(workbookPath)!;
    batch.totalMappings++;

    const entities = dataByEntity[mapping.entityType] || [];
    let entity: Record<string, any> | undefined;
    if (mapping.projectName) {
      entity = entities.find((e) => e.projectName === mapping.projectName || e.project_name === mapping.projectName);
    } else {
      entity = entities[0];
    }

    if (!entity) {
      batch.skipped++;
      batch.results.push({
        mappingId: mapping.id,
        cellAddress: mapping.cellAddress,
        previousValue: null,
        newValue: "",
        status: "skipped",
        errorMessage: `No data found for entity type '${mapping.entityType}'${mapping.projectName ? ` and project '${mapping.projectName}'` : ""}`,
      });
      continue;
    }

    const rawValue = resolveSourceValue(mapping.sourceField, mapping.entityType, entity);
    if (rawValue === null) {
      batch.skipped++;
      batch.results.push({
        mappingId: mapping.id,
        cellAddress: mapping.cellAddress,
        previousValue: null,
        newValue: "",
        status: "skipped",
        errorMessage: `Source field '${mapping.sourceField}' not found in data`,
      });
      continue;
    }

    const transformedValue = applyTransform(rawValue, mapping.dataTransform);
    const validation = validateValue(transformedValue, mapping.validationRule);
    if (!validation.valid) {
      batch.failed++;
      batch.results.push({
        mappingId: mapping.id,
        cellAddress: mapping.cellAddress,
        previousValue: null,
        newValue: transformedValue,
        status: "failed",
        errorMessage: validation.error,
      });
      continue;
    }

    batch.applied++;
    batch.results.push({
      mappingId: mapping.id,
      cellAddress: mapping.cellAddress,
      previousValue: null,
      newValue: transformedValue,
      status: "applied",
    });
  }

  return Array.from(resultsByWorkbook.values());
}

export function writeToWorkbook(
  workbookPath: string,
  writes: Array<{ sheetName: string; cellAddress: string; value: string }>,
  outputPath?: string
): { success: boolean; previousValues: Map<string, string | null>; error?: string } {
  const previousValues = new Map<string, string | null>();

  try {
    const fullPath = path.resolve(workbookPath);
    if (!fs.existsSync(fullPath)) {
      return { success: false, previousValues, error: `Workbook not found: ${fullPath}` };
    }

    const workbook = XLSX.readFile(fullPath, { type: "file" });

    for (const write of writes) {
      const sheet = workbook.Sheets[write.sheetName];
      if (!sheet) {
        previousValues.set(`${write.sheetName}!${write.cellAddress}`, null);
        continue;
      }

      const existingCell = sheet[write.cellAddress];
      const previousValue = existingCell ? String(existingCell.v ?? "") : null;
      previousValues.set(`${write.sheetName}!${write.cellAddress}`, previousValue);

      const numericValue = Number(write.value);
      if (!isNaN(numericValue) && write.value.trim() !== "") {
        sheet[write.cellAddress] = { t: "n", v: numericValue };
      } else {
        sheet[write.cellAddress] = { t: "s", v: write.value };
      }
    }

    const outPath = outputPath || fullPath;
    const outDir = path.dirname(outPath);
    if (!fs.existsSync(outDir)) {
      fs.mkdirSync(outDir, { recursive: true });
    }
    XLSX.writeFile(workbook, outPath);

    return { success: true, previousValues };
  } catch (err: any) {
    return { success: false, previousValues, error: err.message };
  }
}

export function readCellValue(
  workbookPath: string,
  sheetName: string,
  cellAddress: string
): string | null {
  try {
    const fullPath = path.resolve(workbookPath);
    if (!fs.existsSync(fullPath)) return null;
    const workbook = XLSX.readFile(fullPath, { type: "file" });
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) return null;
    const cell = sheet[cellAddress];
    if (!cell) return null;
    return String(cell.v ?? "");
  } catch {
    return null;
  }
}

export function getWorkbookSheets(workbookPath: string): string[] {
  try {
    const fullPath = path.resolve(workbookPath);
    if (!fs.existsSync(fullPath)) return [];
    const workbook = XLSX.readFile(fullPath, { type: "file" });
    return workbook.SheetNames;
  } catch {
    return [];
  }
}

export function previewWriteback(
  workbookPath: string,
  mappings: WritebackMapping[],
  dataByEntity: Record<string, Record<string, any>[]>
): Array<{
  mappingId: number;
  mappingName: string;
  sheetName: string;
  cellAddress: string;
  currentValue: string | null;
  newValue: string | null;
  willChange: boolean;
  error?: string;
}> {
  const previews: Array<{
    mappingId: number;
    mappingName: string;
    sheetName: string;
    cellAddress: string;
    currentValue: string | null;
    newValue: string | null;
    willChange: boolean;
    error?: string;
  }> = [];

  for (const mapping of mappings) {
    const currentValue = readCellValue(workbookPath, mapping.sheetName, mapping.cellAddress);

    const entities = dataByEntity[mapping.entityType] || [];
    let entity: Record<string, any> | undefined;
    if (mapping.projectName) {
      entity = entities.find((e) => e.projectName === mapping.projectName || e.project_name === mapping.projectName);
    } else {
      entity = entities[0];
    }

    if (!entity) {
      previews.push({
        mappingId: mapping.id,
        mappingName: mapping.name,
        sheetName: mapping.sheetName,
        cellAddress: mapping.cellAddress,
        currentValue,
        newValue: null,
        willChange: false,
        error: "No matching data found",
      });
      continue;
    }

    const rawValue = resolveSourceValue(mapping.sourceField, mapping.entityType, entity);
    if (rawValue === null) {
      previews.push({
        mappingId: mapping.id,
        mappingName: mapping.name,
        sheetName: mapping.sheetName,
        cellAddress: mapping.cellAddress,
        currentValue,
        newValue: null,
        willChange: false,
        error: `Field '${mapping.sourceField}' not found`,
      });
      continue;
    }

    const transformedValue = applyTransform(rawValue, mapping.dataTransform);
    previews.push({
      mappingId: mapping.id,
      mappingName: mapping.name,
      sheetName: mapping.sheetName,
      cellAddress: mapping.cellAddress,
      currentValue,
      newValue: transformedValue,
      willChange: currentValue !== transformedValue,
    });
  }

  return previews;
}
