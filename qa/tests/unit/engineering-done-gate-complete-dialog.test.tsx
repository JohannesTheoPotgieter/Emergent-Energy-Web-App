// @vitest-environment jsdom
import * as React from "react";
import { describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, fireEvent } from "@testing-library/react";

// The check-in hook hits the network in real use — keep it inert; the Done-gate
// behaviour under test never reaches check-in.
vi.mock("@/components/documents/use-documents", () => ({
  useCheckin: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

import { CompletePromptDialog } from "@/pages/engineering/dialogs/CompletePromptDialog";

const TASK_ID = 7;

function renderDialog(
  opts: {
    requiresOutputDocument?: boolean;
    links: Array<{ id: number; managedDocumentId: number | null; projectDocumentLinkId: number | null; linkRole: string }>;
    onNeedsDocument?: () => void;
    onCancel?: () => void;
  },
) {
  const qc = new QueryClient({
    // Seeded data below is fresh (staleTime: Infinity) so this default queryFn is
    // never actually invoked — it only silences react-query's "no queryFn" warning.
    defaultOptions: {
      queries: { queryFn: async () => ({}), retry: false, gcTime: 0, staleTime: Infinity },
    },
  });
  // Seed the two queries the dialog reads so no network fetch is attempted.
  qc.setQueryData(["/api/engineering/tasks", TASK_ID, "documents"], {
    links: opts.links.map((l) => ({ ...l, createdAt: "2026-01-01T00:00:00.000Z" })),
  });
  qc.setQueryData(["/api/engineering/tasks", TASK_ID, "document-candidates"], { candidates: [] });

  return render(
    <QueryClientProvider client={qc}>
      <CompletePromptDialog
        open
        taskId={TASK_ID}
        checkedOutDocId={null}
        requiresOutputDocument={opts.requiresOutputDocument}
        onProceed={vi.fn()}
        onCancel={opts.onCancel ?? vi.fn()}
        onError={vi.fn()}
        onNeedsDocument={opts.onNeedsDocument}
      />
    </QueryClientProvider>,
  );
}

describe("CompletePromptDialog — engineering Done-gate affordance", () => {
  it("blocks completion and offers a link CTA when an output-document task has no output link", () => {
    renderDialog({ requiresOutputDocument: true, links: [] });

    // Blocked panel is shown; the "complete anyway" escape hatch is NOT offered.
    expect(screen.getByTestId("task-complete-doc-required")).toBeTruthy();
    expect(screen.queryByTestId("task-complete-escape")).toBeNull();
    expect(screen.queryByTestId("task-complete-confirm")).toBeNull();
    expect(screen.getByTestId("task-complete-link-doc")).toBeTruthy();
  });

  it("an EVIDENCE link does NOT satisfy the gate (only an output link does)", () => {
    renderDialog({
      requiresOutputDocument: true,
      links: [{ id: 1, managedDocumentId: 10, projectDocumentLinkId: null, linkRole: "evidence" }],
    });
    expect(screen.getByTestId("task-complete-doc-required")).toBeTruthy();
    expect(screen.getByTestId("task-complete-link-doc")).toBeTruthy();
  });

  it("the link CTA cancels this dialog and deep-links to the document link flow", () => {
    const onNeedsDocument = vi.fn();
    const onCancel = vi.fn();
    renderDialog({ requiresOutputDocument: true, links: [], onNeedsDocument, onCancel });

    fireEvent.click(screen.getByTestId("task-complete-link-doc"));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onNeedsDocument).toHaveBeenCalledTimes(1);
  });

  it("an OUTPUT link satisfies the gate — the normal confirm UI is shown", () => {
    renderDialog({
      requiresOutputDocument: true,
      links: [{ id: 1, managedDocumentId: 10, projectDocumentLinkId: null, linkRole: "output" }],
    });
    expect(screen.queryByTestId("task-complete-doc-required")).toBeNull();
    expect(screen.getByTestId("task-complete-confirm")).toBeTruthy();
    // A document-output task never gets the "complete anyway" escape hatch.
    expect(screen.queryByTestId("task-complete-escape")).toBeNull();
  });

  it("a task that does NOT require an output document keeps the escape hatch", () => {
    renderDialog({ requiresOutputDocument: false, links: [] });
    expect(screen.queryByTestId("task-complete-doc-required")).toBeNull();
    expect(screen.getByTestId("task-complete-escape")).toBeTruthy();
    expect(screen.getByTestId("task-complete-confirm")).toBeTruthy();
  });
});
