// @vitest-environment jsdom
/**
 * FYE Revenue Tracking — formatter unit tests + component integration tests.
 *
 * Covers: fmtR, fmtPct, fmtDate, gpColor pure functions; page rendering,
 * KPI strip, tab navigation, add/delete flows for pipeline and lost deals,
 * InlineEditCell, sort header aria-sort, and delete confirmation dialog.
 */
import * as React from "react";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, cleanup, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// ── Mocks (hoisted before imports by Vitest) ──────────────────────────────────

vi.mock("@/lib/queryClient", () => ({
  fetchQueryFn: vi.fn(),
  apiRequest: vi.fn(),
}));

vi.mock("@/hooks/use-permissions", () => ({
  usePermission: vi.fn(),
}));

// ── Imports ───────────────────────────────────────────────────────────────────

import FyeRevenueTrackingPage, {
  fmtR,
  fmtPct,
  fmtDate,
  gpColor,
} from "@/pages/fye-revenue-tracking";
import { fetchQueryFn, apiRequest } from "@/lib/queryClient";
import { usePermission } from "@/hooks/use-permissions";

// ── Typed mock handles ─────────────────────────────────────────────────────────

const mockedFetchQueryFn = vi.mocked(fetchQueryFn);
const mockedApiRequest = vi.mocked(apiRequest);
const mockedUsePermission = vi.mocked(usePermission);

// ── Static mock data ──────────────────────────────────────────────────────────

const MOCK_YEARS = { years: [2026, 2027], currentFye: 2026 };

const MOCK_KPIS = { broughtIn: 7, signed: 4, total: 11 };

const MOCK_MONTHS = [
  {
    monthKey: "2025-09",
    label: "Sep '25",
    revenue: { budget: 500_000, actualForecast: 480_000, actual: 480_000, pipeline: 0 },
    cos: { budget: 350_000, actualForecast: 336_000, actual: 336_000, pipeline: 0 },
    gp: { budget: 150_000, actualForecast: 144_000, actual: 144_000, pipeline: 0 },
  },
  {
    monthKey: "2026-08",
    label: "Aug '26",
    revenue: { budget: 600_000, actualForecast: 620_000, actual: null, pipeline: 200_000 },
    cos: { budget: 420_000, actualForecast: 434_000, actual: null, pipeline: 140_000 },
    gp: { budget: 180_000, actualForecast: 186_000, actual: null, pipeline: 60_000 },
  },
];

const MOCK_DASHBOARD = { fye: 2026, months: MOCK_MONTHS, monthKeys: ["2025-09", "2026-08"] };

const MOCK_PIPELINE = [
  {
    id: 42,
    fyeYear: 2026,
    projectName: "Solar Farm Alpha",
    projectDeveloper: "Alice",
    location: "Cape Town",
    sizeKwp: "500",
    dealProbabilityPct: 95,
    forecastSignatureDate: "2026-03-01",
    solarRevenue: "1500000",
    bessRevenue: "0",
    forecastGpPct: "0.25",
    notes: null,
    status: "active",
  },
];

const MOCK_LOST_DEALS = [
  {
    id: 7,
    fyeYear: 2026,
    dealName: "Pretoria Office Park",
    dealValue: "2000000",
    businessDeveloper: "Bob",
    lostReason: "Price",
    lostDate: "2025-11-15",
    notes: null,
  },
];

const MOCK_DETAIL = {
  fye: 2026,
  cutoffMonth: null,
  projects: [
    {
      projectId: 101,
      projectName: "Project Alpha",
      businessDeveloper: "Alice",
      province: "WC",
      sizeKwp: 500,
      projectType: "EPC",
      fundingType: "Private",
      startDate: "2025-09-01",
      pcDate: "2026-03-01",
      status: "In Construction",
      budgetRevenue: 1_500_000,
      budgetCos: 1_050_000,
      budgetGp: 450_000,
      budgetGpPct: 0.30,
      actualRevenue: 800_000,
      actualExpense: 560_000,
      actualGp: 240_000,
      actualGpPct: 0.30,
      signedStatus: "signed",
      hasTracker: true,
    },
  ],
  totals: {
    budgetRevenue: 1_500_000,
    budgetCos: 1_050_000,
    budgetGp: 450_000,
    actualRevenue: 800_000,
    actualExpense: 560_000,
    actualGp: 240_000,
    budgetGpPct: 0.30,
    actualGpPct: 0.30,
  },
};

// ── Helpers ────────────────────────────────────────────────────────────────────

function makeQc() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0, staleTime: 0 },
      mutations: { retry: false },
    },
  });
}

function renderPage() {
  const qc = makeQc();
  const result = render(
    <QueryClientProvider client={qc}>
      <FyeRevenueTrackingPage />
    </QueryClientProvider>,
  );
  return { ...result, qc };
}

/** Wait until the years query has resolved and the FYE selector is visible. */
async function waitForPageReady() {
  await waitFor(() => {
    expect(screen.getByTestId("select-fye")).toBeTruthy();
  });
}

// ── Lifecycle ─────────────────────────────────────────────────────────────────

beforeEach(() => {
  mockedUsePermission.mockReturnValue({ allowed: true, loading: false });
  mockedFetchQueryFn.mockImplementation((url: string) => {
    return async () => {
      if (url.includes("/years")) return MOCK_YEARS;
      if (url.includes("/kpis")) return MOCK_KPIS;
      if (url.includes("/dashboard")) return MOCK_DASHBOARD;
      if (url.includes("/lost-deals")) return MOCK_LOST_DEALS;
      if (url.includes("/pipeline")) return MOCK_PIPELINE;
      if (url.includes("/detail")) return MOCK_DETAIL;
      return null;
    };
  });
  mockedApiRequest.mockResolvedValue({ ok: true });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

// ═══════════════════════════════════════════════════════════════════════════════
// Pure function tests — no DOM required
// ═══════════════════════════════════════════════════════════════════════════════

describe("fmtR — currency formatter", () => {
  it("returns — for null", () => expect(fmtR(null)).toBe("—"));
  it("returns — for undefined", () => expect(fmtR(undefined)).toBe("—"));
  it("formats zero", () => expect(fmtR(0)).toBe("R 0"));
  it("formats a small positive integer below 1 000", () => expect(fmtR(500)).toBe("R 500"));
  it("formats exactly 1 000 as 1.0K", () => expect(fmtR(1_000)).toBe("R 1.0K"));
  it("formats 1 500 as 1.5K", () => expect(fmtR(1_500)).toBe("R 1.5K"));
  it("formats exactly 1 000 000 as 1.00M", () => expect(fmtR(1_000_000)).toBe("R 1.00M"));
  it("formats 2 500 000 as 2.50M", () => expect(fmtR(2_500_000)).toBe("R 2.50M"));
  it("formats negative thousands", () => expect(fmtR(-1_000)).toBe("-R 1.0K"));
  it("formats negative millions", () => expect(fmtR(-1_500_000)).toBe("-R 1.50M"));
  it("formats a negative value below 1 000", () => expect(fmtR(-250)).toBe("-R 250"));
});

describe("fmtPct — percentage formatter", () => {
  it("returns — for null", () => expect(fmtPct(null)).toBe("—"));
  it("returns — for undefined", () => expect(fmtPct(undefined)).toBe("—"));
  it("formats 0 as 0.0%", () => expect(fmtPct(0)).toBe("0.0%"));
  it("formats 0.5 as 50.0%", () => expect(fmtPct(0.5)).toBe("50.0%"));
  it("formats 1.0 as 100.0%", () => expect(fmtPct(1.0)).toBe("100.0%"));
  it("formats 0.25 as 25.0%", () => expect(fmtPct(0.25)).toBe("25.0%"));
  it("formats negative percentage", () => expect(fmtPct(-0.05)).toBe("-5.0%"));
  it("rounds to one decimal place", () => expect(fmtPct(0.333)).toBe("33.3%"));
});

describe("fmtDate — date formatter", () => {
  it("returns — for null", () => expect(fmtDate(null)).toBe("—"));
  it("returns — for undefined", () => expect(fmtDate(undefined)).toBe("—"));
  it("returns — for empty string", () => expect(fmtDate("")).toBe("—"));
  it("returns the date part of a full ISO datetime", () =>
    expect(fmtDate("2026-03-15T08:30:00.000Z")).toBe("2026-03-15"));
  it("returns a YYYY-MM-DD string unchanged", () =>
    expect(fmtDate("2026-03-15")).toBe("2026-03-15"));
  it("truncates strings longer than 10 characters", () =>
    expect(fmtDate("2026-12-31 extra")).toBe("2026-12-31"));
});

describe("gpColor — GP colour classifier", () => {
  it("returns muted-foreground for null", () =>
    expect(gpColor(null)).toBe("text-muted-foreground"));
  it("returns muted-foreground for undefined", () =>
    expect(gpColor(undefined)).toBe("text-muted-foreground"));
  it("returns destructive + font-semibold for negative GP%", () => {
    const cls = gpColor(-0.01);
    expect(cls).toContain("destructive");
    expect(cls).toContain("font-semibold");
  });
  it("returns emerald-600 for exactly 0", () =>
    expect(gpColor(0)).toContain("emerald-600"));
  it("returns emerald-600 for 0.19 (just below 0.2 threshold)", () =>
    expect(gpColor(0.19)).toContain("emerald-600"));
  it("returns emerald-700 + font-semibold for exactly 0.2", () => {
    const cls = gpColor(0.2);
    expect(cls).toContain("emerald-700");
    expect(cls).toContain("font-semibold");
  });
  it("returns emerald-700 + font-semibold for 0.5", () => {
    const cls = gpColor(0.5);
    expect(cls).toContain("emerald-700");
    expect(cls).toContain("font-semibold");
  });
  it("returns destructive + font-semibold for large negative", () => {
    const cls = gpColor(-1.0);
    expect(cls).toContain("destructive");
    expect(cls).toContain("font-semibold");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Component — loading & permission states
// ═══════════════════════════════════════════════════════════════════════════════

describe("FyeRevenueTrackingPage — loading state", () => {
  it("shows animated skeleton and no FYE selector while years are pending", () => {
    mockedFetchQueryFn.mockImplementation(() => () => new Promise(() => {}));
    renderPage();
    expect(document.querySelector(".animate-pulse")).toBeTruthy();
    expect(screen.queryByTestId("select-fye")).toBeNull();
  });
});

describe("FyeRevenueTrackingPage — access denied", () => {
  it("shows the access-denied message when canView is false", async () => {
    mockedUsePermission.mockReturnValue({ allowed: false, loading: false });
    renderPage();
    await waitFor(() => {
      expect(screen.getByText(/don't have access/i)).toBeTruthy();
    });
  });

  it("does not render the FYE selector when access is denied", async () => {
    mockedUsePermission.mockReturnValue({ allowed: false, loading: false });
    renderPage();
    await waitFor(() => {
      expect(screen.queryByTestId("select-fye")).toBeNull();
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Component — full render with data
// ═══════════════════════════════════════════════════════════════════════════════

describe("FyeRevenueTrackingPage — full render", () => {
  it("renders the page title", async () => {
    renderPage();
    await waitForPageReady();
    expect(screen.getByText("FYE Revenue Tracking")).toBeTruthy();
  });

  it("renders the FYE selector with years from the API", async () => {
    renderPage();
    await waitForPageReady();
    const sel = screen.getByTestId("select-fye") as HTMLSelectElement;
    expect(sel).toBeTruthy();
    expect(sel.options.length).toBeGreaterThanOrEqual(1);
  });

  it("FYE selector label is linked to the select via htmlFor/id", async () => {
    renderPage();
    await waitForPageReady();
    const label = document.querySelector("label[for='select-fye-year']");
    expect(label).toBeTruthy();
    const select = document.getElementById("select-fye-year");
    expect(select).toBeTruthy();
  });

  it("shows KPI cards after KPI data loads", async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId("kpi-brought-in")).toBeTruthy();
    });
    expect(screen.getByTestId("kpi-signed")).toBeTruthy();
    expect(screen.getByTestId("kpi-total")).toBeTruthy();
  });

  it("KPI values reflect mock data", async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId("kpi-brought-in-value")).toBeTruthy();
    });
    expect(screen.getByTestId("kpi-brought-in-value").textContent).toBe("7");
    expect(screen.getByTestId("kpi-signed-value").textContent).toBe("4");
    expect(screen.getByTestId("kpi-total-value").textContent).toBe("11");
  });

  it("defaults to the Dashboard tab", async () => {
    renderPage();
    await waitForPageReady();
    const dashTab = screen.getByTestId("tab-fye-dashboard");
    expect(dashTab.getAttribute("data-state")).toBe("active");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Component — dashboard grid
// ═══════════════════════════════════════════════════════════════════════════════

describe("FyeRevenueTrackingPage — dashboard grid", () => {
  it("renders the dashboard table", async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId("table-fye-dashboard")).toBeTruthy();
    });
  });

  it("renders all metric rows (rev-budget, cos-actual, gp-actual)", async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId("row-rev-budget")).toBeTruthy();
    });
    expect(screen.getByTestId("row-cos-actual")).toBeTruthy();
    expect(screen.getByTestId("row-gp-actual")).toBeTruthy();
  });

  it("shows the Sep '25 month column header", async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByText(/sep '25/i)).toBeTruthy();
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Component — tab navigation
// ═══════════════════════════════════════════════════════════════════════════════

describe("FyeRevenueTrackingPage — tab navigation", () => {
  it("switching to Projects tab shows the projects table", async () => {
    renderPage();
    await waitForPageReady();
    fireEvent.mouseDown(screen.getByTestId("tab-fye-projects"));
    await waitFor(() => {
      expect(screen.getByTestId("table-fye-projects")).toBeTruthy();
    });
  });

  it("switching to Pipeline tab shows the pipeline table", async () => {
    renderPage();
    await waitForPageReady();
    fireEvent.mouseDown(screen.getByTestId("tab-fye-pipeline"));
    await waitFor(() => {
      expect(screen.getByTestId("table-fye-pipeline")).toBeTruthy();
    });
  });

  it("switching to Lost Deals tab shows the lost deals table", async () => {
    renderPage();
    await waitForPageReady();
    fireEvent.mouseDown(screen.getByTestId("tab-fye-lost-deals"));
    await waitFor(() => {
      expect(screen.getByTestId("table-fye-lost-deals")).toBeTruthy();
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// PipelineTab — row rendering
// ═══════════════════════════════════════════════════════════════════════════════

describe("PipelineTab — row rendering", () => {
  async function openPipeline() {
    renderPage();
    await waitForPageReady();
    fireEvent.mouseDown(screen.getByTestId("tab-fye-pipeline"));
    await waitFor(() => {
      expect(screen.getByTestId("table-fye-pipeline")).toBeTruthy();
    });
  }

  it("renders the mock pipeline deal row", async () => {
    await openPipeline();
    expect(screen.getByText("Solar Farm Alpha")).toBeTruthy();
  });

  it("renders delete button for each pipeline row", async () => {
    await openPipeline();
    expect(screen.getByTestId("btn-delete-pipeline-42")).toBeTruthy();
  });

  it("renders edit button for each pipeline row", async () => {
    await openPipeline();
    expect(screen.getByTestId("btn-edit-pipeline-42")).toBeTruthy();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// PipelineTab — add-row flow
// ═══════════════════════════════════════════════════════════════════════════════

describe("PipelineTab — add-row flow", () => {
  async function openPipeline() {
    renderPage();
    await waitForPageReady();
    fireEvent.mouseDown(screen.getByTestId("tab-fye-pipeline"));
    await waitFor(() => expect(screen.getByTestId("btn-add-pipeline")).toBeTruthy());
  }

  it("Add Deal button is visible when canEdit=true", async () => {
    await openPipeline();
    expect(screen.getByTestId("btn-add-pipeline")).toBeTruthy();
  });

  it("clicking Add Deal reveals the add-row form with a project name input", async () => {
    await openPipeline();
    fireEvent.click(screen.getByTestId("btn-add-pipeline"));
    await waitFor(() => expect(screen.getByTestId("input-pipeline-name")).toBeTruthy());
  });

  it("Save button is disabled while project name is empty", async () => {
    await openPipeline();
    fireEvent.click(screen.getByTestId("btn-add-pipeline"));
    await waitFor(() => expect(screen.getByTestId("btn-pipeline-add-save")).toBeTruthy());
    const saveBtn = screen.getByTestId("btn-pipeline-add-save") as HTMLButtonElement;
    expect(saveBtn.disabled).toBe(true);
  });

  it("Save button becomes enabled after typing a project name", async () => {
    await openPipeline();
    fireEvent.click(screen.getByTestId("btn-add-pipeline"));
    await waitFor(() => expect(screen.getByTestId("input-pipeline-name")).toBeTruthy());
    fireEvent.change(screen.getByTestId("input-pipeline-name"), {
      target: { value: "New Solar Project" },
    });
    const saveBtn = screen.getByTestId("btn-pipeline-add-save") as HTMLButtonElement;
    expect(saveBtn.disabled).toBe(false);
  });

  it("clicking Cancel hides the add-row form", async () => {
    await openPipeline();
    fireEvent.click(screen.getByTestId("btn-add-pipeline"));
    await waitFor(() => expect(screen.getByTestId("btn-pipeline-add-cancel")).toBeTruthy());
    fireEvent.click(screen.getByTestId("btn-pipeline-add-cancel"));
    await waitFor(() => {
      expect(screen.queryByTestId("input-pipeline-name")).toBeNull();
    });
  });

  it("clicking Save calls apiRequest for create mutation", async () => {
    await openPipeline();
    fireEvent.click(screen.getByTestId("btn-add-pipeline"));
    await waitFor(() => expect(screen.getByTestId("input-pipeline-name")).toBeTruthy());
    fireEvent.change(screen.getByTestId("input-pipeline-name"), {
      target: { value: "New Solar Project" },
    });
    fireEvent.click(screen.getByTestId("btn-pipeline-add-save"));
    await waitFor(() => expect(mockedApiRequest).toHaveBeenCalledWith(
      "POST",
      "/api/fye-revenue-tracking/pipeline",
      expect.objectContaining({ projectName: "New Solar Project" }),
    ));
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// PipelineTab — delete flow
// ═══════════════════════════════════════════════════════════════════════════════

describe("PipelineTab — delete flow", () => {
  async function openPipeline() {
    renderPage();
    await waitForPageReady();
    fireEvent.mouseDown(screen.getByTestId("tab-fye-pipeline"));
    await waitFor(() => expect(screen.getByTestId("btn-delete-pipeline-42")).toBeTruthy());
  }

  it("clicking delete opens the confirmation dialog", async () => {
    await openPipeline();
    fireEvent.click(screen.getByTestId("btn-delete-pipeline-42"));
    await waitFor(() => {
      expect(screen.getByTestId("btn-confirm-delete")).toBeTruthy();
    });
  });

  it("confirming delete calls apiRequest DELETE for the row", async () => {
    await openPipeline();
    fireEvent.click(screen.getByTestId("btn-delete-pipeline-42"));
    await waitFor(() => expect(screen.getByTestId("btn-confirm-delete")).toBeTruthy());
    fireEvent.click(screen.getByTestId("btn-confirm-delete"));
    await waitFor(() => {
      expect(mockedApiRequest).toHaveBeenCalledWith(
        "DELETE",
        "/api/fye-revenue-tracking/pipeline/42",
      );
    });
  });

  it("dialog closes after confirming delete", async () => {
    await openPipeline();
    fireEvent.click(screen.getByTestId("btn-delete-pipeline-42"));
    await waitFor(() => expect(screen.getByTestId("btn-confirm-delete")).toBeTruthy());
    fireEvent.click(screen.getByTestId("btn-confirm-delete"));
    await waitFor(() => {
      expect(screen.queryByTestId("btn-confirm-delete")).toBeNull();
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// LostDealsTab — row rendering
// ═══════════════════════════════════════════════════════════════════════════════

describe("LostDealsTab — row rendering", () => {
  async function openLostDeals() {
    renderPage();
    await waitForPageReady();
    fireEvent.mouseDown(screen.getByTestId("tab-fye-lost-deals"));
    await waitFor(() => expect(screen.getByTestId("table-fye-lost-deals")).toBeTruthy());
  }

  it("renders the mock lost deal row", async () => {
    await openLostDeals();
    expect(screen.getByText("Pretoria Office Park")).toBeTruthy();
  });

  it("renders delete button for each lost deal row", async () => {
    await openLostDeals();
    expect(screen.getByTestId("btn-delete-lost-deal-7")).toBeTruthy();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// LostDealsTab — add-row flow
// ═══════════════════════════════════════════════════════════════════════════════

describe("LostDealsTab — add-row flow", () => {
  async function openLostDeals() {
    renderPage();
    await waitForPageReady();
    fireEvent.mouseDown(screen.getByTestId("tab-fye-lost-deals"));
    await waitFor(() => expect(screen.getByTestId("btn-add-lost-deal")).toBeTruthy());
  }

  it("Add Lost Deal button is visible when canEdit=true", async () => {
    await openLostDeals();
    expect(screen.getByTestId("btn-add-lost-deal")).toBeTruthy();
  });

  it("clicking Add Lost Deal reveals deal name input", async () => {
    await openLostDeals();
    fireEvent.click(screen.getByTestId("btn-add-lost-deal"));
    await waitFor(() => expect(screen.getByTestId("input-lost-deal-name")).toBeTruthy());
  });

  it("Save is disabled when deal name is empty", async () => {
    await openLostDeals();
    fireEvent.click(screen.getByTestId("btn-add-lost-deal"));
    await waitFor(() => expect(screen.getByTestId("btn-lost-deal-add-save")).toBeTruthy());
    const saveBtn = screen.getByTestId("btn-lost-deal-add-save") as HTMLButtonElement;
    expect(saveBtn.disabled).toBe(true);
  });

  it("clicking Cancel hides the add-row form", async () => {
    await openLostDeals();
    fireEvent.click(screen.getByTestId("btn-add-lost-deal"));
    await waitFor(() => expect(screen.getByTestId("btn-lost-deal-add-cancel")).toBeTruthy());
    fireEvent.click(screen.getByTestId("btn-lost-deal-add-cancel"));
    await waitFor(() => {
      expect(screen.queryByTestId("input-lost-deal-name")).toBeNull();
    });
  });

  it("clicking Save calls apiRequest for lost-deals create", async () => {
    await openLostDeals();
    fireEvent.click(screen.getByTestId("btn-add-lost-deal"));
    await waitFor(() => expect(screen.getByTestId("input-lost-deal-name")).toBeTruthy());
    fireEvent.change(screen.getByTestId("input-lost-deal-name"), {
      target: { value: "Lost Deal X" },
    });
    fireEvent.click(screen.getByTestId("btn-lost-deal-add-save"));
    await waitFor(() => expect(mockedApiRequest).toHaveBeenCalledWith(
      "POST",
      "/api/fye-revenue-tracking/lost-deals",
      expect.objectContaining({ dealName: "Lost Deal X" }),
    ));
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// LostDealsTab — delete flow
// ═══════════════════════════════════════════════════════════════════════════════

describe("LostDealsTab — delete flow", () => {
  async function openLostDeals() {
    renderPage();
    await waitForPageReady();
    fireEvent.mouseDown(screen.getByTestId("tab-fye-lost-deals"));
    await waitFor(() => expect(screen.getByTestId("btn-delete-lost-deal-7")).toBeTruthy());
  }

  it("clicking delete opens the confirmation dialog", async () => {
    await openLostDeals();
    fireEvent.click(screen.getByTestId("btn-delete-lost-deal-7"));
    await waitFor(() => {
      expect(screen.getByTestId("btn-confirm-delete")).toBeTruthy();
    });
  });

  it("confirming delete calls apiRequest DELETE for the lost deal", async () => {
    await openLostDeals();
    fireEvent.click(screen.getByTestId("btn-delete-lost-deal-7"));
    await waitFor(() => expect(screen.getByTestId("btn-confirm-delete")).toBeTruthy());
    fireEvent.click(screen.getByTestId("btn-confirm-delete"));
    await waitFor(() => {
      expect(mockedApiRequest).toHaveBeenCalledWith(
        "DELETE",
        "/api/fye-revenue-tracking/lost-deals/7",
      );
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// ProjectsTab — sort headers
// ═══════════════════════════════════════════════════════════════════════════════

describe("ProjectsTab — sort header accessibility", () => {
  async function openProjects() {
    renderPage();
    await waitForPageReady();
    fireEvent.mouseDown(screen.getByTestId("tab-fye-projects"));
    await waitFor(() => expect(screen.getByTestId("table-fye-projects")).toBeTruthy());
  }

  it("non-active sort headers have aria-sort=none", async () => {
    await openProjects();
    const budgetRevTh = screen.getByTestId("th-sort-budgetRevenue");
    expect(budgetRevTh.getAttribute("aria-sort")).toBe("none");
  });

  it("default sort column (projectName) has aria-sort=ascending", async () => {
    await openProjects();
    const nameTh = screen.getByTestId("th-sort-projectName");
    expect(nameTh.getAttribute("aria-sort")).toBe("ascending");
  });

  it("clicking a sort header changes aria-sort to ascending", async () => {
    await openProjects();
    const budgetRevTh = screen.getByTestId("th-sort-budgetRevenue");
    fireEvent.click(budgetRevTh);
    expect(budgetRevTh.getAttribute("aria-sort")).toBe("ascending");
  });

  it("clicking the same sort header again changes aria-sort to descending", async () => {
    await openProjects();
    const budgetRevTh = screen.getByTestId("th-sort-budgetRevenue");
    fireEvent.click(budgetRevTh);
    fireEvent.click(budgetRevTh);
    expect(budgetRevTh.getAttribute("aria-sort")).toBe("descending");
  });

  it("cutoff month input has correct id for label association", async () => {
    await openProjects();
    const cutoffInput = document.getElementById("cutoff-month");
    expect(cutoffInput).toBeTruthy();
    const label = document.querySelector("label[for='cutoff-month']");
    expect(label).toBeTruthy();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// ProjectsTab — InlineEditCell
// ═══════════════════════════════════════════════════════════════════════════════

describe("ProjectsTab — InlineEditCell", () => {
  async function openProjects() {
    renderPage();
    await waitForPageReady();
    fireEvent.mouseDown(screen.getByTestId("tab-fye-projects"));
    await waitFor(() => expect(screen.getByTestId("table-fye-projects")).toBeTruthy());
  }

  it("province cell renders the trigger button when canEdit=true", async () => {
    await openProjects();
    expect(screen.getByTestId("cell-province-101-trigger")).toBeTruthy();
  });

  it("clicking the province trigger reveals an input field", async () => {
    await openProjects();
    fireEvent.click(screen.getByTestId("cell-province-101-trigger"));
    await waitFor(() => {
      expect(screen.getByTestId("cell-province-101-input")).toBeTruthy();
    });
  });

  it("pressing Escape on the input reverts to trigger button", async () => {
    await openProjects();
    fireEvent.click(screen.getByTestId("cell-province-101-trigger"));
    await waitFor(() => expect(screen.getByTestId("cell-province-101-input")).toBeTruthy());
    fireEvent.keyDown(screen.getByTestId("cell-province-101-input"), { key: "Escape" });
    await waitFor(() => {
      expect(screen.getByTestId("cell-province-101-trigger")).toBeTruthy();
    });
  });

  it("pressing Enter on the input calls apiRequest for inline-edit", async () => {
    await openProjects();
    fireEvent.click(screen.getByTestId("cell-province-101-trigger"));
    await waitFor(() => expect(screen.getByTestId("cell-province-101-input")).toBeTruthy());
    fireEvent.change(screen.getByTestId("cell-province-101-input"), {
      target: { value: "GP" },
    });
    fireEvent.keyDown(screen.getByTestId("cell-province-101-input"), { key: "Enter" });
    await waitFor(() => {
      expect(mockedApiRequest).toHaveBeenCalledWith(
        "PUT",
        "/api/fye-revenue-tracking/detail/inline-edit",
        expect.objectContaining({ projectName: "Project Alpha", field: "province", value: "GP" }),
      );
    });
  });

  it("InlineEditCell shows span (not button) when canEdit=false", async () => {
    mockedUsePermission.mockReturnValue({ allowed: false, loading: false });
    mockedUsePermission.mockImplementation((_, action) => ({
      allowed: action !== "edit",
      loading: false,
    }));
    renderPage();
    await waitForPageReady();
    fireEvent.mouseDown(screen.getByTestId("tab-fye-projects"));
    await waitFor(() => expect(screen.getByTestId("table-fye-projects")).toBeTruthy());
    expect(screen.queryByTestId("cell-province-101-trigger")).toBeNull();
  });
});
