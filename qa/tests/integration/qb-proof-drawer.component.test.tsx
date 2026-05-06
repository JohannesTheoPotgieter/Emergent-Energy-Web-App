// @vitest-environment jsdom
/**
 * Component integration tests for ProofDrawerContent.
 * Tests the side-by-side evidence panel in isolation.
 */
import * as React from "react";
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, act, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("@/lib/queryClient", () => ({
  apiRequest: vi.fn(),
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

import { apiRequest } from "@/lib/queryClient";
import { ProofDrawerContent } from "@/components/quickbooks/QbMatchingWorkbench";
import { makeFindResponse, makeScoredCandidate, makeWorkbenchRow } from "../setup/test-utils-qb";
import type { WorkbenchRow } from "@/components/quickbooks/qb-matching-workbench-logic";

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
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
}

function renderDrawer(row: WorkbenchRow, overrides: {
  onApprove?: (idx: number) => void;
  approvePending?: boolean;
  onRejectDone?: () => void;
} = {}) {
  const client = makeQueryClient();
  return render(
    <QueryClientProvider client={client}>
      <ProofDrawerContent
        row={row}
        scope="cost"
        onApprove={overrides.onApprove ?? vi.fn()}
        approvePending={overrides.approvePending ?? false}
        onRejectDone={overrides.onRejectDone ?? vi.fn()}
      />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

// ─── Idle state ───────────────────────────────────────────────────────────────

describe("ProofDrawerContent — idle state", () => {
  it("shows idle placeholder when no findResult and status is idle", () => {
    const row = makeWorkbenchRow({ status: "idle", findResult: null });
    renderDrawer(row);
    expect(screen.getByTestId("drawer-state-idle")).toBeTruthy();
    expect(screen.getByTestId("drawer-state-idle").textContent).toContain("No matches found yet");
  });

  it("shows searching indicator when status is searching", () => {
    const row = makeWorkbenchRow({ status: "searching", findResult: null });
    renderDrawer(row);
    expect(screen.getByTestId("drawer-state-searching")).toBeTruthy();
  });
});

// ─── No-candidates state ──────────────────────────────────────────────────────

describe("ProofDrawerContent — no candidates", () => {
  it("shows no-candidates message when candidates array is empty", () => {
    const row = makeWorkbenchRow({
      status: "found",
      findResult: makeFindResponse({ candidates: [] }),
      lane: "exception",
    });
    renderDrawer(row);
    expect(screen.getByTestId("drawer-state-no-candidates")).toBeTruthy();
  });
});

// ─── Field values ─────────────────────────────────────────────────────────────

describe("ProofDrawerContent — proof table field values", () => {
  it("shows app invoice number in the invoice-num row", () => {
    const row = makeWorkbenchRow({
      status: "found",
      findResult: makeFindResponse(),
      lane: "safe",
      appLine: {
        id: 501,
        projectId: 10,
        projectName: "Alpha",
        invoiceNumber: "INV-2025-001",
        invoiceDate: "2025-03-15",
        amountExVat: 150000,
        counterpartyName: "Acme Solar",
      },
    });
    renderDrawer(row);
    const appValCell = screen.getByTestId("proof-app-value-invoice-num");
    expect(appValCell.textContent).toBe("INV-2025-001");
  });

  it("shows QB doc number in the invoice-num row", () => {
    const row = makeWorkbenchRow({
      status: "found",
      findResult: makeFindResponse({
        candidates: [makeScoredCandidate({ qbDocNumber: "QB-INV-001" })],
      }),
      lane: "safe",
    });
    renderDrawer(row);
    const qbValCell = screen.getByTestId("proof-qb-value-invoice-num");
    expect(qbValCell.textContent).toBe("QB-INV-001");
  });

  it("renders all four standard proof field rows", () => {
    const row = makeWorkbenchRow({
      status: "found",
      findResult: makeFindResponse(),
      lane: "safe",
    });
    renderDrawer(row);
    expect(screen.getByTestId("proof-field-invoice-num")).toBeTruthy();
    expect(screen.getByTestId("proof-field-date")).toBeTruthy();
    expect(screen.getByTestId("proof-field-amount")).toBeTruthy();
    expect(screen.getByTestId("proof-field-counterparty")).toBeTruthy();
  });
});

// ─── Match indicators ─────────────────────────────────────────────────────────

describe("ProofDrawerContent — match indicators", () => {
  it("shows match indicator for exact invoice number match", () => {
    const row = makeWorkbenchRow({
      status: "found",
      findResult: makeFindResponse({
        candidates: [makeScoredCandidate({ qbDocNumber: "INV-2025-001" })],
      }),
      lane: "safe",
      appLine: {
        id: 501,
        projectId: 10,
        projectName: "Alpha",
        invoiceNumber: "INV-2025-001",
        invoiceDate: "2025-03-15",
        amountExVat: 150000,
        counterpartyName: "Acme Solar",
      },
    });
    renderDrawer(row);
    const matchCell = screen.getByTestId("proof-match-invoice-num");
    expect(matchCell.innerHTML).not.toBe("");
  });
});

// ─── Score reasons ────────────────────────────────────────────────────────────

describe("ProofDrawerContent — score reasons", () => {
  it("renders score reasons list", () => {
    const row = makeWorkbenchRow({
      status: "found",
      findResult: makeFindResponse({
        candidates: [makeScoredCandidate({
          reasons: ["Invoice number exact match", "Amount within R0.01"],
        })],
      }),
      lane: "safe",
    });
    renderDrawer(row);
    expect(screen.getByTestId("drawer-score-reasons")).toBeTruthy();
    expect(screen.getByTestId("drawer-reason-0").textContent).toBe("Invoice number exact match");
    expect(screen.getByTestId("drawer-reason-1").textContent).toBe("Amount within R0.01");
  });
});

// ─── Warnings ─────────────────────────────────────────────────────────────────

describe("ProofDrawerContent — warnings section", () => {
  it("renders warning detail entries for each candidate warning", () => {
    const row = makeWorkbenchRow({
      status: "found",
      findResult: makeFindResponse({
        candidates: [makeScoredCandidate({
          confidence: 88,
          warnings: ["amount_mismatch", "vendor_mismatch"],
        })],
      }),
      lane: "review",
    });
    renderDrawer(row);
    expect(screen.getByTestId("drawer-warnings")).toBeTruthy();
    expect(screen.getByTestId("drawer-warning-amount_mismatch")).toBeTruthy();
    expect(screen.getByTestId("drawer-warning-vendor_mismatch")).toBeTruthy();
  });

  it("does not render warnings section when no warnings", () => {
    const row = makeWorkbenchRow({
      status: "found",
      findResult: makeFindResponse({
        candidates: [makeScoredCandidate({ warnings: [] })],
      }),
      lane: "safe",
    });
    renderDrawer(row);
    expect(screen.queryByTestId("drawer-warnings")).toBeNull();
  });
});

// ─── Payment status ───────────────────────────────────────────────────────────

describe("ProofDrawerContent — payment status", () => {
  it("renders payment status badge when qbPaymentStatus is present", () => {
    const row = makeWorkbenchRow({
      status: "found",
      findResult: makeFindResponse({
        candidates: [makeScoredCandidate({ qbPaymentStatus: "paid", qbBalance: 0 })],
      }),
      lane: "safe",
    });
    renderDrawer(row);
    expect(screen.getByTestId("drawer-payment-status")).toBeTruthy();
    expect(screen.getByTestId("drawer-payment-status").textContent).toContain("paid");
  });
});

// ─── Approve button states ────────────────────────────────────────────────────

describe("ProofDrawerContent — approve button", () => {
  it("approve button is enabled for a found safe row", () => {
    const row = makeWorkbenchRow({
      status: "found",
      findResult: makeFindResponse(),
      lane: "safe",
    });
    renderDrawer(row);
    const btn = screen.getByTestId("drawer-btn-approve");
    expect(btn.hasAttribute("disabled") || (btn as HTMLButtonElement).disabled).toBe(false);
  });

  it("approve button is disabled when approvePending is true", () => {
    const row = makeWorkbenchRow({
      status: "found",
      findResult: makeFindResponse(),
      lane: "safe",
    });
    renderDrawer(row, { approvePending: true });
    const btn = screen.getByTestId("drawer-btn-approve");
    expect(btn.hasAttribute("disabled") || (btn as HTMLButtonElement).disabled).toBe(true);
  });

  it("approve button is disabled when QB doc is already linked elsewhere", () => {
    const row = makeWorkbenchRow({
      status: "found",
      findResult: makeFindResponse({
        candidates: [makeScoredCandidate({ qbAlreadyLinkedElsewhere: true })],
      }),
      lane: "safe",
    });
    renderDrawer(row);
    const btn = screen.getByTestId("drawer-btn-approve");
    expect(btn.hasAttribute("disabled") || (btn as HTMLButtonElement).disabled).toBe(true);
  });

  it("approve button is disabled when result has already_linked warning", () => {
    const row = makeWorkbenchRow({
      status: "found",
      findResult: makeFindResponse({
        warnings: { no_po: false, already_linked: true },
      }),
      lane: "exception",
    });
    renderDrawer(row);
    const btn = screen.getByTestId("drawer-btn-approve");
    expect(btn.hasAttribute("disabled") || (btn as HTMLButtonElement).disabled).toBe(true);
  });

  it("calls onApprove with selectedCandidateIdx when clicked", async () => {
    const onApprove = vi.fn();
    const row = makeWorkbenchRow({
      status: "found",
      findResult: makeFindResponse(),
      lane: "safe",
    });
    renderDrawer(row, { onApprove });

    await act(async () => {
      fireEvent.click(screen.getByTestId("drawer-btn-approve"));
    });

    expect(onApprove).toHaveBeenCalledWith(0);
  });
});

// ─── Reject button ────────────────────────────────────────────────────────────

describe("ProofDrawerContent — reject button", () => {
  it("reject button is disabled when reason is empty", () => {
    const row = makeWorkbenchRow({
      status: "found",
      findResult: makeFindResponse(),
      lane: "safe",
    });
    renderDrawer(row);
    const btn = screen.getByTestId("drawer-btn-reject");
    expect(btn.hasAttribute("disabled") || (btn as HTMLButtonElement).disabled).toBe(true);
  });

  it("reject button enables when reason is typed", async () => {
    const row = makeWorkbenchRow({
      status: "found",
      findResult: makeFindResponse(),
      lane: "safe",
    });
    renderDrawer(row);

    await act(async () => {
      fireEvent.change(screen.getByTestId("drawer-input-reject-reason"), {
        target: { value: "Wrong project" },
      });
    });

    const btn = screen.getByTestId("drawer-btn-reject");
    expect(btn.hasAttribute("disabled") || (btn as HTMLButtonElement).disabled).toBe(false);
  });
});

// ─── Candidate selector ───────────────────────────────────────────────────────

describe("ProofDrawerContent — candidate selector", () => {
  it("shows candidate selector buttons when there are multiple candidates", () => {
    const row = makeWorkbenchRow({
      status: "found",
      findResult: makeFindResponse({
        candidates: [
          makeScoredCandidate({ qbEntityId: "qb-1", confidence: 95 }),
          makeScoredCandidate({ qbEntityId: "qb-2", confidence: 78 }),
        ],
      }),
      lane: "safe",
    });
    renderDrawer(row);
    expect(screen.getByTestId("drawer-candidate-0")).toBeTruthy();
    expect(screen.getByTestId("drawer-candidate-1")).toBeTruthy();
  });

  it("does not show candidate selector for single candidate", () => {
    const row = makeWorkbenchRow({
      status: "found",
      findResult: makeFindResponse({
        candidates: [makeScoredCandidate()],
      }),
      lane: "safe",
    });
    renderDrawer(row);
    expect(screen.queryByTestId("drawer-candidate-0")).toBeNull();
  });
});

// ─── Approved / Rejected status display ──────────────────────────────────────

describe("ProofDrawerContent — status display", () => {
  it("shows approved status message for approved rows", () => {
    const row = makeWorkbenchRow({
      status: "approved",
      findResult: makeFindResponse(),
      lane: "safe",
    });
    renderDrawer(row);
    expect(screen.getByTestId("drawer-state-approved")).toBeTruthy();
    expect(screen.getByTestId("drawer-state-approved").textContent).toContain("approved and linked");
  });

  it("shows rejected status message for rejected rows", () => {
    const row = makeWorkbenchRow({
      status: "rejected",
      findResult: makeFindResponse(),
      lane: "review",
    });
    renderDrawer(row);
    expect(screen.getByTestId("drawer-state-rejected")).toBeTruthy();
    expect(screen.getByTestId("drawer-state-rejected").textContent).toContain("rejected");
  });
});

// ─── Manual link ──────────────────────────────────────────────────────────────

describe("ProofDrawerContent — manual link", () => {
  it("manual link button is disabled when QB ID input is empty", () => {
    const row = makeWorkbenchRow({ status: "idle", findResult: null });
    renderDrawer(row);
    const btn = screen.getByTestId("drawer-btn-manual-link");
    expect(btn.hasAttribute("disabled") || (btn as HTMLButtonElement).disabled).toBe(true);
  });

  it("manual link button enables with a valid QB ID", async () => {
    const row = makeWorkbenchRow({ status: "idle", findResult: null });
    renderDrawer(row);

    await act(async () => {
      fireEvent.change(screen.getByTestId("drawer-input-manual-qb-id"), {
        target: { value: "12345" },
      });
    });

    const btn = screen.getByTestId("drawer-btn-manual-link");
    expect(btn.hasAttribute("disabled") || (btn as HTMLButtonElement).disabled).toBe(false);
  });

  it("calls manual-link API endpoint on click", async () => {
    mockedApiRequest.mockResolvedValueOnce(mockResponse({ linkId: 777 }));
    const row = makeWorkbenchRow({ id: 501, status: "idle", findResult: null });
    renderDrawer(row);

    await act(async () => {
      fireEvent.change(screen.getByTestId("drawer-input-manual-qb-id"), {
        target: { value: "qb-bill-99" },
      });
    });

    await act(async () => {
      fireEvent.click(screen.getByTestId("drawer-btn-manual-link"));
    });

    await waitFor(() => {
      expect(mockedApiRequest).toHaveBeenCalledWith(
        "POST",
        "/api/quickbooks/invoice-matches/manual-link",
        expect.objectContaining({ qbEntityId: "qb-bill-99", appEntityId: 501 }),
      );
    });
  });
});
