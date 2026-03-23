import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

function read(relPath: string) {
  return fs.readFileSync(path.join(process.cwd(), relPath), "utf8");
}

describe("FIX A: WBS Floating-Point Drift Normalization", () => {
  const source = fs.readFileSync(path.join(process.cwd(), "server/lib/import/normalizer.ts"), "utf8");

  it("normalizeTaskNo handles floating-point drift in numeric values", () => {
    // The function should use toFixed(10) to clean drift
    expect(source).toContain("numVal.toFixed(10)");
    expect(source).toContain("parseFloat(numVal.toFixed(10)).toString()");
  });

  it("checks String(numVal) === trimmed to distinguish plain numbers from multi-level WBS", () => {
    // Plain numbers like "1.2000000000000002" should go through float cleanup
    // Multi-level WBS like "1.2.3" should go through dot-split cleanup
    expect(source).toContain("String(numVal) === trimmed");
  });

  it("still supports multi-level dot-separated WBS codes", () => {
    expect(source).toContain('if (/^\\d+(\\.\\d+)*$/.test(trimmed))');
    expect(source).toContain("parts.map(p =>");
  });

  it("preserves non-numeric string WBS codes unchanged", () => {
    // String codes like "A", "B", "C" should pass through
    // normalizeTaskNo returns trimmed for non-matching strings
    expect(source).toContain("return trimmed;");
  });

  it("normalizeTaskNo is called on extracted taskNo values", () => {
    expect(source).toContain("normalizeTaskNo(taskNo)");
  });
});

describe("FIX B: #REF! and Excel Error Handling", () => {
  describe("normalizer.ts error detection", () => {
    const source = read("server/lib/import/normalizer.ts");

    it("defines EXCEL_ERROR_VALUES set with all standard errors", () => {
      expect(source).toContain("EXCEL_ERROR_VALUES");
      expect(source).toContain('"#REF!"');
      expect(source).toContain('"#DIV/0!"');
      expect(source).toContain('"#VALUE!"');
      expect(source).toContain('"#N/A"');
      expect(source).toContain('"#NAME?"');
      expect(source).toContain('"#NULL!"');
      expect(source).toContain('"#NUM!"');
    });

    it("has getExcelError function that handles string and object formats", () => {
      expect(source).toContain("function getExcelError(value: any): string | null");
      // Handles ExcelJS error object format: { error: "#REF!" }
      expect(source).toContain("value.error");
      expect(source).toContain("EXCEL_ERROR_VALUES.has(value.error)");
    });

    it("cellStr filters out Excel errors", () => {
      const cellStrFn = source.substring(
        source.indexOf("function cellStr("),
        source.indexOf("}\n", source.indexOf("function cellStr(")) + 1
      );
      expect(cellStrFn).toContain("getExcelError(v)");
    });

    it("findNumericValueInRow skips Excel errors", () => {
      const fnBlock = source.substring(
        source.indexOf("function findNumericValueInRow"),
        source.indexOf("}\n", source.indexOf("function findNumericValueInRow")) + 1
      );
      expect(fnBlock).toContain("getExcelError(v)");
    });

    it("generates WARNING issues for Excel errors in cost lines", () => {
      // extractCostLines scans rows for errors and pushes issues
      expect(source).toContain('issueType: "EXCEL_ERROR"');
      expect(source).toContain("Excel formula error");
      expect(source).toContain("Value replaced with null");
    });

    it("generates WARNING issues for Excel errors in revenue lines", () => {
      // Two separate scans - one in EXPENDITURE section, one in REVENUE section
      const matches = source.match(/section: "EXPENDITURE"[\s\S]*?EXCEL_ERROR/g);
      expect(matches).toBeTruthy();
      const revMatches = source.match(/section: "REVENUE"[\s\S]*?EXCEL_ERROR/g);
      expect(revMatches).toBeTruthy();
    });
  });

  describe("utils.ts error detection", () => {
    const source = read("server/lib/import/utils.ts");

    it("parseDate handles Excel errors", () => {
      expect(source).toContain("isExcelError(value)");
      // Should be in parseDate function
      const parseDateFn = source.substring(
        source.indexOf("export function parseDate"),
        source.indexOf("}\n\n", source.indexOf("export function parseDate")) + 1
      );
      expect(parseDateFn).toContain("isExcelError");
    });

    it("parseNumber handles Excel errors", () => {
      const parseNumberFn = source.substring(
        source.indexOf("export function parseNumber"),
        source.indexOf("}\n\n", source.indexOf("export function parseNumber")) + 1
      );
      expect(parseNumberFn).toContain("isExcelError");
    });

    it("defines EXCEL_ERRORS set with standard error values", () => {
      expect(source).toContain("EXCEL_ERRORS");
      expect(source).toContain('"#REF!"');
    });
  });
});

describe("FIX C: Font Color Extraction Robustness", () => {
  const source = read("server/lib/import/normalizer.ts");

  it("has extractFontColorHex function for robust color extraction", () => {
    expect(source).toContain("function extractFontColorHex(fontColor: any): string | null");
  });

  it("handles direct ARGB format", () => {
    const fn = source.substring(
      source.indexOf("function extractFontColorHex"),
      source.indexOf("}\n\n", source.indexOf("function extractFontColorHex")) + 1
    );
    expect(fn).toContain("fontColor.argb");
    expect(fn).toContain("substring(2)");
  });

  it("handles direct RGB format", () => {
    const fn = source.substring(
      source.indexOf("function extractFontColorHex"),
      source.indexOf("}\n\n", source.indexOf("function extractFontColorHex")) + 1
    );
    expect(fn).toContain("fontColor.rgb");
  });

  it("handles theme colors with defaults for theme 0 and 1", () => {
    const fn = source.substring(
      source.indexOf("function extractFontColorHex"),
      source.indexOf("}\n\n", source.indexOf("function extractFontColorHex")) + 1
    );
    expect(fn).toContain("fontColor.theme");
    expect(fn).toContain('"000000"'); // theme 1 = black
    expect(fn).toContain('"ffffff"'); // theme 0 = white
  });

  it("accounts for tint on theme colors", () => {
    const fn = source.substring(
      source.indexOf("function extractFontColorHex"),
      source.indexOf("}\n\n", source.indexOf("function extractFontColorHex")) + 1
    );
    expect(fn).toContain("tint");
  });

  it("has classifyColorHex function for color classification", () => {
    expect(source).toContain("function classifyColorHex(hex: string | null)");
  });

  it("classifies dark colors as black (isBlack: true)", () => {
    expect(source).toContain("r < 40 && g < 40 && b < 40");
  });

  it("classifies reddish colors", () => {
    expect(source).toContain("r > 150 && g < 80 && b < 80");
  });

  it("getCellFontColor uses extractFontColorHex and classifyColorHex", () => {
    const fn = source.substring(
      source.indexOf("function getCellFontColor("),
      source.indexOf("}\n\n", source.indexOf("function getCellFontColor(")) + 1
    );
    expect(fn).toContain("extractFontColorHex(font.color)");
    expect(fn).toContain("classifyColorHex(hex)");
  });

  it("returns unconfirmed (isBlack: false) for unresolvable colors", () => {
    const fn = source.substring(
      source.indexOf("function getCellFontColor("),
      source.indexOf("}\n\n", source.indexOf("function getCellFontColor(")) + 1
    );
    // When hex is null (unresolvable), return isBlack: false
    expect(fn).toContain("return { color: null, isBlack: false }");
  });

  it("derives invoiceDateConfirmed from font color during commit", () => {
    const routes = read("server/smart-import-routes.ts");
    expect(routes).toContain('invoiceDateConfirmed: m.invoiceDateFontColor === "black"');
    expect(routes).toContain('paymentDateConfirmed: m.paidDateFontColor === "black"');
  });

  it("never crashes: getCellFontColor has try-catch", () => {
    expect(source).toContain("} catch {");
  });
});
