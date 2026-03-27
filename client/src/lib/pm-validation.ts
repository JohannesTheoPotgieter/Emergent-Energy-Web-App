/**
 * Validates PM/PD field values to detect spreadsheet column headers
 * or other non-person values that were incorrectly imported.
 */

const INVALID_PM_PATTERNS = [
  /^(CONTRACT\s*VALUE|INSTALLER|FY\s*\d{4}|COST|REVENUE|BUDGET|MARGIN|STATUS|TOTAL|AMOUNT|DESCRIPTION|CATEGORY|DATE|TYPE|NOTES?)$/i,
];

export function isValidPmName(name: string | null | undefined): boolean {
  if (!name || name.trim() === "") return false;
  const trimmed = name.trim();
  if (INVALID_PM_PATTERNS.some((p) => p.test(trimmed))) return false;
  // All-caps strings 3+ chars with no lowercase are likely column headers
  if (trimmed.length >= 3 && /^[A-Z\s_]+$/.test(trimmed)) return false;
  return true;
}

export function displayPmName(name: string | null | undefined): string {
  if (!isValidPmName(name)) return "Unassigned";
  return name!.trim();
}
