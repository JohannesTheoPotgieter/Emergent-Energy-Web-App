/**
 * Excel cell extraction (D3.6).
 *
 * When a Costing Excel is approved via the D3 document-control flow,
 * we want to auto-read the headline numbers (revenue, CoS, margin)
 * out of specific cells so the CEO home can display them without
 * anyone re-typing.
 *
 * The extract spec lives on controlled_document_types.extractSpec as:
 *   { sheetName?: string, cells: { revenue?: string, cos?: string, ... } }
 *
 * When a document is promoted to state='approved' and its type has an
 * extractSpec, this service reads the values and writes them to
 * controlledDocuments.extractedValues (jsonb) + sets extractedAt.
 *
 * Mock-connector aware: in dev without Graph creds, returns plausible
 * fixture numbers so the CEO home shows non-empty headline data.
 */

import { isConnectorMocked, logConnectorModeOnce } from "../lib/connector-mode";

export interface ExtractSpec {
  sheetName?: string;
  cells?: Record<string, string>;
}

export interface ExtractedValues {
  /** Each key from extractSpec.cells mapped to its parsed value. */
  values: Record<string, number | null>;
  /** Computed margin percentage when both revenue + cos are present. */
  marginPct?: number | null;
  /** Timestamp of the extraction. */
  extractedAt: string;
  /** Non-fatal message when one or more cells failed to parse. */
  warning?: string;
}

/**
 * Extract values from a Costing Excel in SharePoint.
 *
 * Real-mode path (not yet wired): calls Graph Excel API
 *   GET /drives/{driveId}/items/{itemId}/workbook/worksheets/{name}/range(address='B42')
 * for each configured cell, parses .values[0][0].
 *
 * Mock mode: returns randomised-but-realistic fixture numbers so the
 * downstream UI (CEO home) has something to display in dev.
 */
export async function extractCostingValues(params: {
  driveId: string | null;
  itemId: string | null;
  spec: ExtractSpec;
}): Promise<ExtractedValues | null> {
  logConnectorModeOnce("ms-graph");
  if (!params.spec?.cells || Object.keys(params.spec.cells).length === 0) {
    return null;
  }

  if (isConnectorMocked("ms-graph")) {
    // Deterministic seed — use driveId + itemId hash so the same file
    // always returns the same fixture numbers, which is less surprising
    // than random on every read.
    const seed = hashString((params.driveId ?? "") + (params.itemId ?? "mock"));
    const revenue = 800_000 + (seed % 1_800_000); // R800k - R2.6M
    const cos = Math.floor(revenue * (0.65 + ((seed >> 8) % 20) / 100)); // 65-84% of revenue
    const values: Record<string, number | null> = {};
    for (const key of Object.keys(params.spec.cells)) {
      if (key === "revenue") values[key] = revenue;
      else if (key === "cos") values[key] = cos;
      else values[key] = 0;
    }
    const marginPct = revenue > 0 ? Math.round(((revenue - cos) / revenue) * 1000) / 10 : null;
    return {
      values,
      marginPct,
      extractedAt: new Date().toISOString(),
    };
  }

  throw new Error(
    "Real Excel cell extraction not yet wired. " +
    "Set USE_MOCK_CONNECTORS=true to see fixture headline numbers, " +
    "or wire Graph Excel /workbook/worksheets/*/range here.",
  );
}

function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}
