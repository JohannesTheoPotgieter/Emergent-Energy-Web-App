/**
 * Mock-connector regression guards (Phase 7)
 *
 * Pins the integration-mock contract:
 *
 *   1. server/lib/connector-mode.ts defines isConnectorMocked(name) and
 *      a strict NODE_ENV gate — prod is never allowed into the mock path.
 *
 *   2. The three fixture files exist, export their main entry points, and
 *      return non-empty arrays / objects on the happy path so UI click-
 *      through QA has something to show.
 *
 *   3. Each integration service file imports the gate helper AND its mock
 *      fixtures, and gates its public read/write entry points on
 *      isConnectorMocked(...). A revert that removes the guard will fail
 *      the corresponding "does not use isConnectorMocked" assertion.
 *
 *   4. .env.example documents USE_MOCK_CONNECTORS.
 *
 *   5. CLAUDE.md has a "Local QA: mock connectors" section that tells
 *      future readers where the gate lives and how to flip it.
 */

import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

function read(relPath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relPath), "utf8");
}

describe("connector-mode gate (Phase 7)", () => {
  const source = read("server/lib/connector-mode.ts");

  it("exports isConnectorMocked that accepts per-integration names", () => {
    expect(source).toMatch(/export function isConnectorMocked\(name: ConnectorName\)/);
  });

  it("strict NODE_ENV gate — prod is never mocked", () => {
    expect(
      source,
      "The first decision in the gate MUST be `NODE_ENV === 'production' → force-real` so the mock path can never leak to prod.",
    ).toMatch(/NODE_ENV === "production"[\s\S]{0,100}force-real/);
  });

  it("honours USE_MOCK_CONNECTORS=true / =false overrides", () => {
    expect(source).toMatch(/USE_MOCK_CONNECTORS/);
    expect(source).toMatch(/force-mock/);
    expect(source).toMatch(/force-real/);
  });

  it("covers all three integrations", () => {
    expect(source).toMatch(/"ms-graph"/);
    expect(source).toMatch(/"quickbooks"/);
    expect(source).toMatch(/"pipedrive"/);
  });
});

describe("fixture files exist and return non-empty data", () => {
  const FIXTURE_FILES = [
    "server/mocks/ms-graph-fixtures.ts",
    "server/mocks/quickbooks-fixtures.ts",
    "server/mocks/pipedrive-fixtures.ts",
  ];
  for (const file of FIXTURE_FILES) {
    it(`${file} exists and exports named fixture functions`, () => {
      const source = read(file);
      expect(source).toMatch(/export function mock/);
    });
  }

  it("MS Graph fixtures cover calendar / mail / teams / SharePoint", () => {
    const source = read("server/mocks/ms-graph-fixtures.ts");
    expect(source).toMatch(/mockCalendarEvents/);
    expect(source).toMatch(/mockMailMessages/);
    expect(source).toMatch(/mockJoinedTeams/);
    expect(source).toMatch(/mockSharePointSites/);
  });

  it("QuickBooks fixtures cover invoices / bills / customers / vendors / P&L", () => {
    const source = read("server/mocks/quickbooks-fixtures.ts");
    expect(source).toMatch(/mockInvoices/);
    expect(source).toMatch(/mockBills/);
    expect(source).toMatch(/mockCustomers/);
    expect(source).toMatch(/mockVendors/);
    expect(source).toMatch(/mockProfitAndLossReport/);
  });

  it("Pipedrive fixtures cover deals + stages + owners", () => {
    const source = read("server/mocks/pipedrive-fixtures.ts");
    expect(source).toMatch(/mockPipedriveDeals/);
    expect(source).toMatch(/mockPipedriveStages/);
    expect(source).toMatch(/mockPipedriveOwners/);
  });
});

describe("integration services gate on isConnectorMocked (Phase 7)", () => {
  interface ServiceCase {
    file: string;
    integration: string;
    expectedGateCallsAtLeast: number; // sanity floor; each service gates multiple entry points
  }
  const cases: ServiceCase[] = [
    { file: "server/outlook.ts", integration: "ms-graph", expectedGateCallsAtLeast: 8 },
    { file: "server/sharepoint-list.ts", integration: "ms-graph", expectedGateCallsAtLeast: 4 },
    { file: "server/services/quickbooks-service.ts", integration: "quickbooks", expectedGateCallsAtLeast: 5 },
    { file: "server/services/pipedrive-sync-service.ts", integration: "pipedrive", expectedGateCallsAtLeast: 1 },
  ];

  for (const c of cases) {
    describe(c.file, () => {
      const source = read(c.file);

      it("imports isConnectorMocked", () => {
        expect(source).toMatch(/isConnectorMocked/);
      });

      it("imports its mock fixtures module", () => {
        expect(source).toMatch(/mocks\/.+-fixtures/);
      });

      it(`calls isConnectorMocked("${c.integration}") at least ${c.expectedGateCallsAtLeast}× (one per gated entry point)`, () => {
        const needle = new RegExp(`isConnectorMocked\\("${c.integration}"\\)`, "g");
        const hits = source.match(needle) || [];
        expect(
          hits.length,
          `${c.file} must gate at least ${c.expectedGateCallsAtLeast} entry points on isConnectorMocked("${c.integration}") so every call path has a mock branch.`,
        ).toBeGreaterThanOrEqual(c.expectedGateCallsAtLeast);
      });
    });
  }
});

describe("documentation — USE_MOCK_CONNECTORS flag + CLAUDE.md section", () => {
  it(".env.example documents USE_MOCK_CONNECTORS", () => {
    const source = read(".env.example");
    expect(source).toMatch(/USE_MOCK_CONNECTORS/);
  });

  it("CLAUDE.md has a 'Local QA: mock connectors' section", () => {
    const source = read("CLAUDE.md");
    expect(source).toMatch(/Local QA: mock connectors/);
    expect(source).toMatch(/connector-mode\.ts/);
  });
});
