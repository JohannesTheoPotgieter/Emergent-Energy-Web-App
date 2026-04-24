// @vitest-environment jsdom
/**
 * Task #83 — Component-level render contract for OpportunityDetailBody
 * when the workflow payload contains `pd: null` (no engineering shadow
 * ticket yet).
 *
 * This is the React Testing Library counterpart to the API-contract
 * test at `qa/tests/integration/opportunity-drawer-no-shadow.test.ts`
 * and the live Playwright spec at
 * `qa/tests/e2e/opportunity-drawer-no-shadow.spec.ts`.
 *
 * Strategy: pre-seed the React Query cache for the workflow query key
 * before mounting, so `useQuery` returns the seeded payload synchronously
 * without firing any fetch. We then assert the drawer body renders the
 * full no-shadow contract and never falls through to the
 * "Could not load opportunity." fallback.
 *
 * Pre-fix, the drawer's gate was `isError || !data || !merged`, which
 * routed every `pd: null` payload to the failure fallback. The fix
 * (now under test) is two lines: the gate is `isError || !data`, and
 * every `merged.X` reference is null-safe.
 */
import * as React from "react";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { OpportunityDetailBody } from "@/components/opportunities/OpportunityDrawer";

// Belt-and-suspenders: stub the network layer so any accidental refetch
// (e.g. if a dev later changes staleTime or enabled) cannot escape the
// test sandbox. The seeded cache below means useQuery should never
// actually call queryFn — but if it does, this throws loudly instead
// of hanging on a real fetch in jsdom.
vi.mock("@/lib/queryClient", async () => {
  const actual = await vi.importActual<any>("@/lib/queryClient");
  return {
    ...actual,
    apiRequest: vi.fn(async () => {
      throw new Error("apiRequest must NOT be called: cache is pre-seeded");
    }),
  };
});

// useToast is a module-level singleton in this codebase, so it works
// without a provider — but we still mock it so spawn-task / convert
// mutations can't trigger real toast state if a future refactor wires
// them on mount.
vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn(), dismiss: vi.fn(), toasts: [] }),
}));

const FIXTURE_ID = 999_999;

function buildWorkflowPayload() {
  return {
    crm: {
      id: FIXTURE_ID,
      pipedriveDealId: null,
      source: "internal",
      dealName: "Task #83 RTL Fixture",
      dealOwnerName: "Test Owner",
      stage: "qualification",
      estimatedValue: "1500000.00",
      estimatedKwp: null,
      currency: "ZAR",
      weightedValue: null,
      probability: null,
      expectedCloseDate: null,
      lastActivityDate: null,
      nextActivityDate: null,
      nextActivitySubject: null,
      personName: null,
      personEmail: null,
      labels: null,
      lostReason: null,
      pipedriveUpdatedAt: null,
      pipedriveStageChangedAt: null,
    },
    clientName: "Acme Solar Ltd",
    siteName: null,
    pd: null,        // ← the contract under test
    tasks: [],
    tickets: [],
  };
}

function renderWithSeededCache() {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Infinity, gcTime: Infinity },
      mutations: { retry: false },
    },
  });
  // Seed the EXACT key OpportunityDetailBody uses so useQuery returns
  // the payload synchronously without firing queryFn.
  client.setQueryData(["/api/opportunities", FIXTURE_ID, "workflow"], buildWorkflowPayload());
  return render(
    <QueryClientProvider client={client}>
      <OpportunityDetailBody opportunityId={FIXTURE_ID} active={true} variant="inline" />
    </QueryClientProvider>,
  );
}

describe("OpportunityDetailBody — no-shadow render contract (Task #83)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  afterEach(() => {
    cleanup();
  });

  it("renders the header, CRM stat row, no-engineering-ticket pill, and Convert CTA without showing 'Could not load opportunity.'", () => {
    renderWithSeededCache();

    // 1. CRITICAL: the load-failure fallback MUST NOT render.
    expect(
      screen.queryByTestId("opportunity-detail-error"),
      "regression of Task #83: 'Could not load opportunity.' fallback rendered for pd:null payload",
    ).toBeNull();
    expect(screen.queryByText(/Could not load opportunity/i)).toBeNull();

    // 2. Header section + opportunity name render (proves we got past
    //    the load gate into the success branch).
    expect(screen.getByTestId("section-detail-header")).toBeTruthy();
    expect(screen.getByTestId("text-opportunity-name").textContent).toContain("Task #83 RTL Fixture");

    // 3. The "No engineering ticket" pill renders (the no-shadow
    //    branch of the header status badge).
    const noTicketBadge = screen.getByTestId("badge-no-engineering-ticket");
    expect(noTicketBadge).toBeTruthy();
    expect(noTicketBadge.textContent).toMatch(/No engineering ticket/i);

    // 4. The engineering-status badge MUST NOT render (would imply
    //    auto-spawn regressed).
    expect(screen.queryByTestId("badge-engineering-status")).toBeNull();

    // 5. The CRM stat row labels render (Value, CRM stage, Owner).
    expect(screen.getAllByText(/^Value$/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/^CRM stage$/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/^Owner$/).length).toBeGreaterThan(0);

    // 6. CRM read-only details section renders.
    expect(screen.getByTestId("section-crm")).toBeTruthy();

    // 7. Tickets section shows the "No PD tickets yet" empty state
    //    (the !merged?.projectId branch).
    const noTicketsCopy = screen.getByTestId("text-no-pd-tickets-yet");
    expect(noTicketsCopy).toBeTruthy();
    expect(noTicketsCopy.textContent).toMatch(/No PD tickets yet/i);

    // 8. The Convert-to-Project CTA renders below the tickets section
    //    (this is the user's path forward when no shadow exists).
    expect(screen.getByTestId("section-convert-cta")).toBeTruthy();
    expect(screen.getByTestId("btn-open-convert-wizard")).toBeTruthy();
  });
});
