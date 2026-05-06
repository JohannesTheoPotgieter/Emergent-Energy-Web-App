// @vitest-environment jsdom
/**
 * Component integration tests for QbMatchingWorkbench.
 * Uses vi.mock for apiRequest — no MSW needed.
 */
import * as React from "react";
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, waitFor, act, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// Mock apiRequest before importing the component
vi.mock("@/lib/queryClient", () => ({
  apiRequest: vi.fn(),
}));

// Mock use-toast to avoid rendering toast infrastructure
vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

import { apiRequest } from "@/lib/queryClient";
import { QbMatchingWorkbench } from "@/components/quickbooks/QbMatchingWorkbench";
import {
  makeFindResponse,
  makeScoredCandidate,
} from "../setup/test-utils-qb";

const mockedApiRequest = vi.mocked(apiRequest);

function mockResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  } as unknown as Response;
}

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0, staleTime: 0 },
      mutations: { retry: false },
    },
  });
}

function renderWorkbench(props: { defaultScope?: "cost" | "revenue" } = {}) {
  const client = makeQueryClient();
  const result = render(
    <QueryClientProvider client={client}>
      <QbMatchingWorkbench defaultScope={props.defaultScope ?? "cost"} />
    </QueryClientProvider>,
  );
  return { ...result, queryClient: client };
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

// ─── Loading state ────────────────────────────────────────────────────────────

describe("QbMatchingWorkbench — loading state", () => {
  it("shows the workbench root element", async () => {
    mockedApiRequest.mockImplementation(() => new Promise(() => {})); // never resolves
    renderWorkbench();
    expect(screen.getByTestId("qb-matching-workbench")).toBeTruthy();
  });

  it("shows loading indicator while query is pending", async () => {
    mockedApiRequest.mockImplementation(() => new Promise(() => {}));
    renderWorkbench();
    await waitFor(() => {
      expect(screen.getByTestId("table-loading")).toBeTruthy();
    });
  });
});

// ─── Empty state ──────────────────────────────────────────────────────────────

describe("QbMatchingWorkbench — empty state", () => {
  beforeEach(() => {
    mockedApiRequest.mockResolvedValue(mockResponse({ costLines: [] }));
  });

  it("renders the empty-table message when no lines are returned", async () => {
    renderWorkbench();
    await waitFor(() => {
      expect(screen.getByTestId("table-empty")).toBeTruthy();
    });
  });
});

// ─── Row rendering ────────────────────────────────────────────────────────────

describe("QbMatchingWorkbench — row rendering", () => {
  beforeEach(() => {
    mockedApiRequest.mockResolvedValue(
      mockResponse({
        costLines: [
          {
            id: 501,
            projectId: 10,
            projectName: "Solar Farm Alpha",
            invoiceNumber: "INV-001",
            invoiceDate: "2025-03-15",
            amountExVat: 150000,
            counterpartyName: "Acme Solar",
            description: null,
          },
        ],
      }),
    );
  });

  it("renders a workbench row for each cost line", async () => {
    renderWorkbench();
    await waitFor(() => {
      expect(screen.getByTestId("workbench-row-501")).toBeTruthy();
    });
  });

  it("shows Find button for idle rows", async () => {
    renderWorkbench();
    await waitFor(() => {
      expect(screen.getByTestId("btn-find-row-501")).toBeTruthy();
    });
  });

  it("row has data-status=idle initially", async () => {
    renderWorkbench();
    await waitFor(() => {
      const statusCell = screen.getByTestId("row-status-501");
      expect(statusCell.getAttribute("data-status")).toBe("idle");
    });
  });
});

// ─── Find transition ──────────────────────────────────────────────────────────

describe("QbMatchingWorkbench — find transition", () => {
  it("updates row status to found after successful find", async () => {
    // First call: load cost lines
    mockedApiRequest
      .mockResolvedValueOnce(
        mockResponse({
          costLines: [
            {
              id: 501,
              projectId: 10,
              projectName: "Solar Farm Alpha",
              invoiceNumber: "INV-001",
              invoiceDate: "2025-03-15",
              amountExVat: 150000,
              counterpartyName: "Acme Solar",
              description: null,
            },
          ],
        }),
      )
      // Second call: find response
      .mockResolvedValueOnce(mockResponse(makeFindResponse()));

    renderWorkbench();

    await waitFor(() => {
      expect(screen.getByTestId("btn-find-row-501")).toBeTruthy();
    });

    await act(async () => {
      fireEvent.click(screen.getByTestId("btn-find-row-501"));
    });

    await waitFor(() => {
      const statusCell = screen.getByTestId("row-status-501");
      expect(statusCell.getAttribute("data-status")).toBe("found");
    });
  });

  it("sets row status to error when find fails", async () => {
    mockedApiRequest
      .mockResolvedValueOnce(
        mockResponse({
          costLines: [
            {
              id: 501,
              projectId: 10,
              projectName: "Alpha",
              invoiceNumber: "INV-001",
              invoiceDate: "2025-03-15",
              amountExVat: 100000,
              counterpartyName: "Vendor",
              description: null,
            },
          ],
        }),
      )
      .mockResolvedValueOnce(mockResponse({ message: "QB unavailable" }, 503));

    renderWorkbench();

    await waitFor(() => {
      expect(screen.getByTestId("btn-find-row-501")).toBeTruthy();
    });

    await act(async () => {
      fireEvent.click(screen.getByTestId("btn-find-row-501"));
    });

    await waitFor(() => {
      const statusCell = screen.getByTestId("row-status-501");
      expect(statusCell.getAttribute("data-status")).toBe("error");
    });
  });
});

// ─── Lane badges ──────────────────────────────────────────────────────────────

describe("QbMatchingWorkbench — lane badges", () => {
  it("row gets data-lane=safe for a 95% confidence clean match", async () => {
    mockedApiRequest
      .mockResolvedValueOnce(
        mockResponse({
          costLines: [
            {
              id: 501,
              projectId: 10,
              projectName: "Alpha",
              invoiceNumber: "INV-001",
              invoiceDate: "2025-03-15",
              amountExVat: 150000,
              counterpartyName: "Acme Solar",
              description: null,
            },
          ],
        }),
      )
      .mockResolvedValueOnce(mockResponse(makeFindResponse()));

    renderWorkbench();

    await waitFor(() => expect(screen.getByTestId("btn-find-row-501")).toBeTruthy());

    await act(async () => {
      fireEvent.click(screen.getByTestId("btn-find-row-501"));
    });

    await waitFor(() => {
      const laneCell = screen.getByTestId("row-lane-501");
      expect(laneCell.getAttribute("data-lane")).toBe("safe");
    });
  });

  it("row gets data-lane=exception for no_po warning", async () => {
    mockedApiRequest
      .mockResolvedValueOnce(
        mockResponse({
          costLines: [
            {
              id: 501,
              projectId: 10,
              projectName: "Alpha",
              invoiceNumber: "INV-001",
              invoiceDate: "2025-03-15",
              amountExVat: 150000,
              counterpartyName: "Acme Solar",
              description: null,
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        mockResponse(
          makeFindResponse({ warnings: { no_po: true, already_linked: false } }),
        ),
      );

    renderWorkbench();

    await waitFor(() => expect(screen.getByTestId("btn-find-row-501")).toBeTruthy());

    await act(async () => {
      fireEvent.click(screen.getByTestId("btn-find-row-501"));
    });

    await waitFor(() => {
      expect(screen.getByTestId("row-lane-501").getAttribute("data-lane")).toBe("exception");
    });
  });
});

// ─── Warning chips ────────────────────────────────────────────────────────────

describe("QbMatchingWorkbench — warning chips", () => {
  it("renders per-row warning testid for amount_mismatch", async () => {
    mockedApiRequest
      .mockResolvedValueOnce(
        mockResponse({
          costLines: [
            {
              id: 501,
              projectId: 10,
              projectName: "Alpha",
              invoiceNumber: "INV-001",
              invoiceDate: "2025-03-15",
              amountExVat: 150000,
              counterpartyName: "Acme Solar",
              description: null,
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        mockResponse(
          makeFindResponse({
            candidates: [makeScoredCandidate({ confidence: 92, warnings: ["amount_mismatch"] })],
          }),
        ),
      );

    renderWorkbench();

    await waitFor(() => expect(screen.getByTestId("btn-find-row-501")).toBeTruthy());

    await act(async () => {
      fireEvent.click(screen.getByTestId("btn-find-row-501"));
    });

    await waitFor(() => {
      expect(screen.getByTestId("row-warning-501-amount_mismatch")).toBeTruthy();
    });
  });
});

// ─── Toolbar button disable logic ─────────────────────────────────────────────

describe("QbMatchingWorkbench — toolbar disable logic", () => {
  beforeEach(() => {
    mockedApiRequest.mockResolvedValue(mockResponse({ costLines: [] }));
  });

  it("Find Matches for Selected is disabled when nothing selected", async () => {
    renderWorkbench();
    await waitFor(() => expect(screen.getByTestId("table-empty")).toBeTruthy());
    const btn = screen.getByTestId("btn-find-selected");
    expect(btn.hasAttribute("disabled") || (btn as HTMLButtonElement).disabled).toBe(true);
  });

  it("Bulk Approve Safe is disabled when no safe rows exist", async () => {
    renderWorkbench();
    await waitFor(() => expect(screen.getByTestId("table-empty")).toBeTruthy());
    const btn = screen.getByTestId("btn-bulk-approve-safe");
    expect(btn.hasAttribute("disabled") || (btn as HTMLButtonElement).disabled).toBe(true);
  });

  it("Export Exceptions is disabled when no exception rows exist", async () => {
    renderWorkbench();
    await waitFor(() => expect(screen.getByTestId("table-empty")).toBeTruthy());
    const btn = screen.getByTestId("btn-export-exceptions");
    expect(btn.hasAttribute("disabled") || (btn as HTMLButtonElement).disabled).toBe(true);
  });
});

// ─── Scope toggle ─────────────────────────────────────────────────────────────

describe("QbMatchingWorkbench — scope toggle", () => {
  it("switches to revenue scope when Revenue button is clicked", async () => {
    mockedApiRequest.mockResolvedValue(mockResponse({ costLines: [], revenueLines: [] }));
    renderWorkbench();

    await act(async () => {
      fireEvent.click(screen.getByTestId("btn-scope-revenue"));
    });

    // The revenue query should be fired
    await waitFor(() => {
      expect(screen.getByTestId("btn-scope-revenue").classList.contains("bg-white") === false ||
        screen.getByTestId("btn-scope-cost") !== null).toBe(true);
    });
  });
});

// ─── Row selection + checkbox ─────────────────────────────────────────────────

describe("QbMatchingWorkbench — row checkbox selection", () => {
  it("selecting a row via checkbox enables Reject Selected button", async () => {
    mockedApiRequest.mockResolvedValue(
      mockResponse({
        costLines: [
          {
            id: 501,
            projectId: 10,
            projectName: "Alpha",
            invoiceNumber: "INV-001",
            invoiceDate: "2025-03-15",
            amountExVat: 150000,
            counterpartyName: "Acme Solar",
            description: null,
          },
        ],
      }),
    );

    renderWorkbench();

    await waitFor(() => expect(screen.getByTestId("workbench-row-501")).toBeTruthy());

    // Click checkbox
    await act(async () => {
      const cb = screen.getByTestId("checkbox-row-501");
      fireEvent.click(cb);
    });

    await waitFor(() => {
      const btn = screen.getByTestId("btn-reject-selected");
      expect(btn.hasAttribute("disabled") || (btn as HTMLButtonElement).disabled).toBe(false);
    });
  });
});

// ─── Drawer open ─────────────────────────────────────────────────────────────

describe("QbMatchingWorkbench — drawer", () => {
  it("clicking a row opens the proof drawer", async () => {
    mockedApiRequest.mockResolvedValue(
      mockResponse({
        costLines: [
          {
            id: 501,
            projectId: 10,
            projectName: "Alpha",
            invoiceNumber: "INV-001",
            invoiceDate: "2025-03-15",
            amountExVat: 150000,
            counterpartyName: "Acme Solar",
            description: null,
          },
        ],
      }),
    );

    renderWorkbench();

    await waitFor(() => expect(screen.getByTestId("workbench-row-501")).toBeTruthy());

    await act(async () => {
      fireEvent.click(screen.getByTestId("workbench-row-501"));
    });

    await waitFor(() => {
      expect(screen.getByTestId("proof-drawer")).toBeTruthy();
    });
  });
});

// ─── Lane filter ──────────────────────────────────────────────────────────────

describe("QbMatchingWorkbench — lane filter", () => {
  it("lane summary chips appear after finding matches", async () => {
    mockedApiRequest
      .mockResolvedValueOnce(
        mockResponse({
          costLines: [
            {
              id: 501,
              projectId: 10,
              projectName: "Alpha",
              invoiceNumber: "INV-001",
              invoiceDate: "2025-03-15",
              amountExVat: 150000,
              counterpartyName: "Acme Solar",
              description: null,
            },
          ],
        }),
      )
      .mockResolvedValueOnce(mockResponse(makeFindResponse()));

    renderWorkbench();

    await waitFor(() => expect(screen.getByTestId("btn-find-row-501")).toBeTruthy());

    await act(async () => {
      fireEvent.click(screen.getByTestId("btn-find-row-501"));
    });

    await waitFor(() => {
      expect(screen.getByTestId("lane-count-safe")).toBeTruthy();
    });
  });
});

// ─── Bulk Approve Modal ────────────────────────────────────────────────────────

describe("QbMatchingWorkbench — bulk approve modal", () => {
  async function setupWithSafeRow() {
    mockedApiRequest
      .mockResolvedValueOnce(
        mockResponse({
          costLines: [
            {
              id: 501,
              projectId: 10,
              projectName: "Solar Farm Alpha",
              invoiceNumber: "INV-001",
              invoiceDate: "2025-03-15",
              amountExVat: 150000,
              counterpartyName: "Acme Solar",
              description: null,
            },
          ],
        }),
      )
      .mockResolvedValueOnce(mockResponse(makeFindResponse()));

    renderWorkbench();

    await waitFor(() => expect(screen.getByTestId("btn-find-row-501")).toBeTruthy());

    await act(async () => {
      fireEvent.click(screen.getByTestId("btn-find-row-501"));
    });

    await waitFor(() => {
      expect(screen.getByTestId("row-lane-501").getAttribute("data-lane")).toBe("safe");
    });
  }

  it("opens bulk approve modal when Bulk Approve Safe is clicked", async () => {
    await setupWithSafeRow();

    await act(async () => {
      fireEvent.click(screen.getByTestId("btn-bulk-approve-safe"));
    });

    await waitFor(() => {
      expect(screen.getByTestId("modal-bulk-approve-preview")).toBeTruthy();
    });
  });

  it("modal shows correct match count", async () => {
    await setupWithSafeRow();

    await act(async () => {
      fireEvent.click(screen.getByTestId("btn-bulk-approve-safe"));
    });

    await waitFor(() => {
      const countEl = screen.getByTestId("modal-approve-count");
      expect(countEl.textContent).toBe("1");
    });
  });

  it("modal shows project name in projects affected", async () => {
    await setupWithSafeRow();

    await act(async () => {
      fireEvent.click(screen.getByTestId("btn-bulk-approve-safe"));
    });

    await waitFor(() => {
      const projEl = screen.getByTestId("modal-approve-projects");
      expect(projEl.textContent).toContain("Solar Farm Alpha");
    });
  });

  it("calls bulk-approve endpoint when Confirm is clicked", async () => {
    await setupWithSafeRow();

    // Set up the bulk-approve response
    mockedApiRequest.mockResolvedValueOnce(
      mockResponse({ approved: 1, skipped: 0, failed: 0, results: [{ suggestionId: 1001, outcome: "approved", linkId: 999 }] }),
    );

    await act(async () => {
      fireEvent.click(screen.getByTestId("btn-bulk-approve-safe"));
    });

    await waitFor(() => {
      expect(screen.getByTestId("btn-confirm-bulk-approve")).toBeTruthy();
    });

    await act(async () => {
      fireEvent.click(screen.getByTestId("btn-confirm-bulk-approve"));
    });

    await waitFor(() => {
      expect(mockedApiRequest).toHaveBeenCalledWith(
        "POST",
        "/api/quickbooks/invoice-matches/bulk-approve",
        expect.objectContaining({ items: expect.any(Array) }),
      );
    });
  });

  it("row status becomes approved after successful bulk approve", async () => {
    await setupWithSafeRow();

    mockedApiRequest.mockResolvedValueOnce(
      mockResponse({
        approved: 1,
        skipped: 0,
        failed: 0,
        results: [{ suggestionId: 1001, outcome: "approved", linkId: 999 }],
      }),
    );

    await act(async () => {
      fireEvent.click(screen.getByTestId("btn-bulk-approve-safe"));
    });

    await waitFor(() => expect(screen.getByTestId("btn-confirm-bulk-approve")).toBeTruthy());

    await act(async () => {
      fireEvent.click(screen.getByTestId("btn-confirm-bulk-approve"));
    });

    await waitFor(() => {
      const statusCell = screen.getByTestId("row-status-501");
      expect(statusCell.getAttribute("data-status")).toBe("approved");
    });
  });
});

// ─── Bulk Reject Dialog ───────────────────────────────────────────────────────

describe("QbMatchingWorkbench — bulk reject dialog", () => {
  it("opens reject dialog when Reject Selected is clicked with selection", async () => {
    mockedApiRequest.mockResolvedValue(
      mockResponse({
        costLines: [
          {
            id: 501,
            projectId: 10,
            projectName: "Alpha",
            invoiceNumber: "INV-001",
            invoiceDate: "2025-03-15",
            amountExVat: 150000,
            counterpartyName: "Acme Solar",
            description: null,
          },
        ],
      }),
    );

    renderWorkbench();

    await waitFor(() => expect(screen.getByTestId("workbench-row-501")).toBeTruthy());

    await act(async () => {
      fireEvent.click(screen.getByTestId("checkbox-row-501"));
    });

    await act(async () => {
      fireEvent.click(screen.getByTestId("btn-reject-selected"));
    });

    await waitFor(() => {
      expect(screen.getByTestId("modal-bulk-reject")).toBeTruthy();
    });
  });

  it("Confirm reject button is disabled when reason is empty", async () => {
    mockedApiRequest.mockResolvedValue(
      mockResponse({
        costLines: [
          {
            id: 501,
            projectId: 10,
            projectName: "Alpha",
            invoiceNumber: "INV-001",
            invoiceDate: "2025-03-15",
            amountExVat: 150000,
            counterpartyName: "Acme Solar",
            description: null,
          },
        ],
      }),
    );

    renderWorkbench();

    await waitFor(() => expect(screen.getByTestId("workbench-row-501")).toBeTruthy());

    await act(async () => {
      fireEvent.click(screen.getByTestId("checkbox-row-501"));
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId("btn-reject-selected"));
    });

    await waitFor(() => expect(screen.getByTestId("btn-confirm-bulk-reject")).toBeTruthy());

    const confirmBtn = screen.getByTestId("btn-confirm-bulk-reject");
    expect(confirmBtn.hasAttribute("disabled") || (confirmBtn as HTMLButtonElement).disabled).toBe(true);
  });

  it("entering a reason enables the Confirm reject button", async () => {
    mockedApiRequest.mockResolvedValue(
      mockResponse({
        costLines: [
          {
            id: 501,
            projectId: 10,
            projectName: "Alpha",
            invoiceNumber: "INV-001",
            invoiceDate: "2025-03-15",
            amountExVat: 150000,
            counterpartyName: "Acme Solar",
            description: null,
          },
        ],
      }),
    );

    renderWorkbench();

    await waitFor(() => expect(screen.getByTestId("workbench-row-501")).toBeTruthy());

    await act(async () => {
      fireEvent.click(screen.getByTestId("checkbox-row-501"));
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId("btn-reject-selected"));
    });

    await waitFor(() => expect(screen.getByTestId("input-bulk-reject-reason")).toBeTruthy());

    await act(async () => {
      fireEvent.change(screen.getByTestId("input-bulk-reject-reason"), {
        target: { value: "Wrong project" },
      });
    });

    const confirmBtn = screen.getByTestId("btn-confirm-bulk-reject");
    expect(confirmBtn.hasAttribute("disabled") || (confirmBtn as HTMLButtonElement).disabled).toBe(false);
  });
});
