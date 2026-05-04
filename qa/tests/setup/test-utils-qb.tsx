/**
 * Test utilities for QB Matching Workbench component tests.
 * Provides render helpers and factory functions for stable test data.
 */
import * as React from "react";
import { render } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import type { FindResponse, ScoredCandidate, WorkbenchRow } from "@/components/quickbooks/qb-matching-workbench-logic";

// ─── Render helper ────────────────────────────────────────────────────────────

export function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0, staleTime: 0 },
      mutations: { retry: false },
    },
  });
}

export function renderWithProviders(ui: React.ReactElement) {
  const client = makeQueryClient();
  const Wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return {
    ...render(ui, { wrapper: Wrapper }),
    queryClient: client,
  };
}

// ─── Factory helpers ──────────────────────────────────────────────────────────

export function makeScoredCandidate(overrides: Partial<ScoredCandidate> = {}): ScoredCandidate {
  return {
    qbEntityId: "qb-bill-42",
    qbEntityType: "bill",
    qbDocNumber: "INV-2025-001",
    qbTxnDate: "2025-03-15",
    qbCounterpartyName: "Acme Solar Supplies",
    qbCounterpartyId: "vendor-99",
    qbAmountExVat: 150000,
    qbBalance: 0,
    qbPaymentStatus: "paid",
    confidence: 95,
    reasons: ["Invoice number exact match", "Amount within R0.01", "Same month"],
    warnings: [],
    qbAlreadyLinkedElsewhere: false,
    ...overrides,
  };
}

export function makeFindResponse(overrides: Partial<FindResponse> = {}): FindResponse {
  return {
    suggestionId: 1001,
    scope: "cost",
    app: {
      id: 501,
      invoiceNumber: "INV-2025-001",
      invoiceDate: "2025-03-15",
      amountExVat: 150000,
      counterpartyName: "Acme Solar Supplies",
      poNumber: "PO-001",
      projectId: 10,
    },
    warnings: { no_po: false, already_linked: false },
    candidates: [makeScoredCandidate()],
    ...overrides,
  };
}

export function makeWorkbenchRow(overrides: Partial<WorkbenchRow> = {}): WorkbenchRow {
  return {
    id: 501,
    appLine: {
      id: 501,
      projectId: 10,
      projectName: "Solar Farm Alpha",
      invoiceNumber: "INV-2025-001",
      invoiceDate: "2025-03-15",
      amountExVat: 150000,
      counterpartyName: "Acme Solar Supplies",
    },
    findResult: null,
    status: "idle",
    lane: null,
    errorMessage: null,
    ...overrides,
  };
}

export function makeSafeRow(id = 501): WorkbenchRow {
  return makeWorkbenchRow({
    id,
    appLine: {
      id,
      projectId: 10,
      projectName: "Solar Farm Alpha",
      invoiceNumber: `INV-2025-00${id}`,
      invoiceDate: "2025-03-15",
      amountExVat: 150000,
      counterpartyName: "Acme Solar Supplies",
    },
    findResult: makeFindResponse({ suggestionId: id + 1000 }),
    status: "found",
    lane: "safe",
    errorMessage: null,
  });
}

export function makeReviewRow(id = 502): WorkbenchRow {
  return makeWorkbenchRow({
    id,
    findResult: makeFindResponse({
      suggestionId: id + 1000,
      candidates: [makeScoredCandidate({ confidence: 78, warnings: [] })],
    }),
    status: "found",
    lane: "review",
  });
}

export function makeExceptionRow(id = 503): WorkbenchRow {
  return makeWorkbenchRow({
    id,
    findResult: makeFindResponse({
      suggestionId: id + 1000,
      warnings: { no_po: true, already_linked: false },
      candidates: [makeScoredCandidate({ confidence: 88, warnings: [] })],
    }),
    status: "found",
    lane: "exception",
  });
}
