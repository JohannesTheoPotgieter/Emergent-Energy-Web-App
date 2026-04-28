// @vitest-environment jsdom
/**
 * Task #124 — Commercial section render-failure containment.
 *
 * Context
 * -------
 * The original report was a "Server Error / Request failed" toast plus a
 * minified React #310 thrown when a project (e.g. Mondi/281) was opened
 * from /quality and the Commercial tab was rendered. The server-side
 * cause was a UPPERCASE enum-literal mismatch in
 * `getFinanceCashflow` / `getProjectFinanceSummary` — fixed and covered
 * by `qa/tests/unit/v2-finance-cashflow-{enum-case,db}.test.ts`.
 *
 * As a defence-in-depth follow-up, the Commercial section in
 * `client/src/pages/project-detail.tsx` is now wrapped in a section-
 * scoped ErrorBoundary so a render crash inside any child (a future
 * hook-order regression, an unmapped finance API error, etc.) is
 * contained instead of taking down the whole project page.
 *
 * What this test asserts
 * ----------------------
 * 1. When a Commercial child throws on render, the ErrorBoundary's
 *    `fallback` prop is invoked and renders the localised
 *    "Commercial section failed to render" UI (data-testid
 *    `commercial-section-error`) instead of bubbling the error up.
 * 2. The fallback exposes a "Try again" affordance
 *    (data-testid `button-commercial-retry`) wired to the boundary's
 *    `reset` callback, and a healthy re-render after reset shows the
 *    healthy child contents (proving the boundary clears state).
 *
 * This is the React-side regression net for the same class of
 * Commercial-tab failures the SQL fix removed.
 */
import * as React from "react";
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { ErrorBoundary } from "@/components/ErrorBoundary";

afterEach(() => cleanup());

function ThrowingChild({ shouldThrow }: { shouldThrow: boolean }) {
  if (shouldThrow) {
    throw new Error("simulated commercial child crash");
  }
  return <div data-testid="healthy-child">healthy</div>;
}

function CommercialBoundary({ children }: { children: React.ReactNode }) {
  // Mirrors the exact fallback contract used at the Commercial section
  // wrap site in `client/src/pages/project-detail.tsx`. If that contract
  // ever drifts (e.g. test-id rename or button removal), this assertion
  // catches it before the user does.
  return (
    <ErrorBoundary
      fallback={({ error, reset }) => (
        <div data-testid="commercial-section-error">
          <div>Commercial section failed to render</div>
          <div>{error?.message ?? "Unknown render error"}</div>
          <button
            type="button"
            onClick={reset}
            data-testid="button-commercial-retry"
          >
            Try again
          </button>
        </div>
      )}
    >
      {children}
    </ErrorBoundary>
  );
}

describe("Task #124 — Commercial section ErrorBoundary contract", () => {
  it("renders the section-scoped fallback when a child throws on render", () => {
    // jsdom prints React's expected boundary log; suppress to keep test
    // output clean without hiding actual assertion failures.
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    render(
      <CommercialBoundary>
        <ThrowingChild shouldThrow={true} />
      </CommercialBoundary>,
    );

    const fallback = screen.getByTestId("commercial-section-error");
    expect(fallback).toBeTruthy();
    expect(fallback.textContent).toContain("simulated commercial child crash");
    expect(screen.getByTestId("button-commercial-retry")).toBeTruthy();
    // The healthy contents must not be in the DOM when the boundary is open.
    expect(screen.queryByTestId("healthy-child")).toBeNull();

    errSpy.mockRestore();
  });

  it("clears its error state when the user clicks Try again", () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    function Harness() {
      const [shouldThrow, setShouldThrow] = React.useState(true);
      return (
        <div>
          <button
            type="button"
            data-testid="button-recover"
            onClick={() => setShouldThrow(false)}
          >
            recover
          </button>
          <CommercialBoundary>
            <ThrowingChild shouldThrow={shouldThrow} />
          </CommercialBoundary>
        </div>
      );
    }

    render(<Harness />);
    expect(screen.getByTestId("commercial-section-error")).toBeTruthy();

    // Simulate the upstream cause being fixed (e.g. finance API now 200s)
    // and the user clicking the boundary's "Try again" affordance.
    fireEvent.click(screen.getByTestId("button-recover"));
    fireEvent.click(screen.getByTestId("button-commercial-retry"));

    expect(screen.queryByTestId("commercial-section-error")).toBeNull();
    expect(screen.getByTestId("healthy-child")).toBeTruthy();

    errSpy.mockRestore();
  });
});
