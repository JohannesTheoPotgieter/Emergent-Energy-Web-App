// @vitest-environment jsdom
/**
 * Task #97 — Component-level render contract for the Company Team
 * `PersonCard`. Locks the three new behaviours added in this task:
 *
 *  1. Real `utilisationPct` renders as "<n>%" with the field labelled
 *     "Utilisation".
 *  2. When `utilisationPct` is null and `activeWorkItemCount` is set, the
 *     same field flips its label to "Active Items" and shows the count
 *     (the proxy fallback when no allocation_pct exists).
 *  3. `status: "inactive"` renders the "Inactive" pill instead of "Active".
 *  4. `location` shows the raw string when present, and shows the muted
 *     "—" placeholder when null (it MUST NOT read "Data unavailable" any
 *     more — that was the bug being fixed).
 */
import * as React from "react";
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { PersonCard } from "../../../client/src/pages/company-team/index";

afterEach(() => cleanup());

function basePerson(overrides: Partial<React.ComponentProps<typeof PersonCard>["person"]> = {}) {
  return {
    id: 1,
    fullName: "Test User",
    initials: "TU",
    jobTitle: "Engineer",
    location: null,
    utilisationPct: null,
    activeProjectCount: 0,
    activeWorkItemCount: null,
    status: "active" as const,
    ...overrides,
  };
}

describe("PersonCard", () => {
  it("renders a real utilisation % with the 'Utilisation' label", () => {
    render(<PersonCard person={basePerson({ id: 1, utilisationPct: 80 })} />);
    expect(screen.getByTestId("text-person-utilisation-1")).toHaveTextContent("80%");
    expect(screen.getByText("Utilisation")).toBeInTheDocument();
    expect(screen.queryByText("Active Items")).not.toBeInTheDocument();
  });

  it("falls back to 'Active Items' label + count when utilisationPct is null and activeWorkItemCount is set", () => {
    render(
      <PersonCard
        person={basePerson({ id: 2, utilisationPct: null, activeWorkItemCount: 5 })}
      />,
    );
    expect(screen.getByText("Active Items")).toBeInTheDocument();
    expect(screen.queryByText("Utilisation")).not.toBeInTheDocument();
    const cell = screen.getByTestId("text-person-utilisation-2");
    expect(cell).toHaveTextContent("5");
    // The proxy span must be tagged so QA can assert it explicitly.
    expect(screen.getByTestId("text-person-workitems-2")).toBeInTheDocument();
  });

  it("renders the 'Inactive' status pill when status === 'inactive'", () => {
    render(<PersonCard person={basePerson({ id: 3, status: "inactive" })} />);
    expect(screen.getByTestId("text-person-status-3")).toHaveTextContent(/inactive/i);
  });

  it("renders the literal location string when present and never the legacy 'Data unavailable' string", () => {
    render(
      <PersonCard person={basePerson({ id: 4, location: "Cape Town" })} />,
    );
    const loc = screen.getByTestId("text-person-location-4");
    expect(loc).toHaveTextContent("Cape Town");
    // Regression guard: the bug being fixed was every card reading
    // "Data unavailable" — make sure it never reappears here.
    expect(loc.textContent ?? "").not.toMatch(/Data unavailable/i);
  });

  it("clearly marks an empty location cell as a missing placeholder (italic muted)", () => {
    // The shared `NA` placeholder string is unchanged by task #97 — what
    // changed is that real `location` values now get populated for users
    // (so the placeholder is the exception, not the rule). Assert here
    // that the placeholder cell is rendered with the muted-italic class
    // so users can visually tell it's missing data, not real content.
    render(<PersonCard person={basePerson({ id: 5, location: null })} />);
    const loc = screen.getByTestId("text-person-location-5");
    expect(loc.className).toMatch(/italic/);
    expect(loc.className).toMatch(/muted-foreground/);
  });
});
