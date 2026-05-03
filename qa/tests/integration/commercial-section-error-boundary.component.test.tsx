// @vitest-environment jsdom
// Task #124 — Commercial section ErrorBoundary contract.
import * as React from "react";
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { ErrorBoundary } from "@/components/ErrorBoundary";

afterEach(() => cleanup());

function ThrowingChild({ shouldThrow }: { shouldThrow: boolean }) {
  if (shouldThrow) throw new Error("simulated commercial child crash");
  return <div data-testid="healthy-child">healthy</div>;
}

function CommercialBoundary({ children }: { children: React.ReactNode }) {
  return (
    <ErrorBoundary
      fallback={({ error, reset }) => (
        <div data-testid="commercial-section-error">
          <div>Commercial section failed to render</div>
          <div>{error?.message ?? "Unknown render error"}</div>
          <button type="button" onClick={reset} data-testid="button-commercial-retry">
            Try again
          </button>
        </div>
      )}
    >
      {children}
    </ErrorBoundary>
  );
}

describe("Commercial section ErrorBoundary", () => {
  it("renders the section-scoped fallback when a child throws", () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    render(
      <CommercialBoundary>
        <ThrowingChild shouldThrow={true} />
      </CommercialBoundary>,
    );
    const fallback = screen.getByTestId("commercial-section-error");
    expect(fallback.textContent).toContain("simulated commercial child crash");
    expect(screen.getByTestId("button-commercial-retry")).toBeTruthy();
    expect(screen.queryByTestId("healthy-child")).toBeNull();
    errSpy.mockRestore();
  });

  it("clears its error state when the user clicks Try again", () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    function Harness() {
      const [shouldThrow, setShouldThrow] = React.useState(true);
      return (
        <div>
          <button type="button" data-testid="button-recover" onClick={() => setShouldThrow(false)}>
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
    fireEvent.click(screen.getByTestId("button-recover"));
    fireEvent.click(screen.getByTestId("button-commercial-retry"));
    expect(screen.queryByTestId("commercial-section-error")).toBeNull();
    expect(screen.getByTestId("healthy-child")).toBeTruthy();
    errSpy.mockRestore();
  });
});
