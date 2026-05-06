// @vitest-environment jsdom
/**
 * EE-QA-025 — EmptyState contract.
 *
 * The canonical empty-state component is the only way to render a
 * "nothing-to-see-here" state in user-facing surfaces. It guarantees a
 * consistent shell, a default Inbox icon, and an optional next-step CTA
 * so empty surfaces always tell the user what to do next.
 */
import * as React from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { EmptyState } from "@/components/ui/empty-state";
import { Calendar } from "lucide-react";

describe("EmptyState", () => {
  it("renders title + description", () => {
    cleanup();
    render(<EmptyState title="No projects" description="Add your first project to get started." />);
    expect(screen.getByText("No projects")).toBeTruthy();
    expect(screen.getByText("Add your first project to get started.")).toBeTruthy();
  });

  it("renders the action button when provided and fires onClick", () => {
    cleanup();
    const onClick = vi.fn();
    render(
      <EmptyState
        title="No invoices"
        description="No invoices captured this month."
        action={{ label: "Capture invoice", onClick }}
      />,
    );
    const btn = screen.getByText("Capture invoice");
    fireEvent.click(btn);
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("does not render an action button when no action is given", () => {
    cleanup();
    render(<EmptyState title="No data" description="Nothing here yet." />);
    // No buttons at all
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("uses the supplied icon", () => {
    cleanup();
    const { container } = render(
      <EmptyState icon={Calendar} title="No meetings" description="Your week is clear." />,
    );
    // lucide-calendar is the rendered class for the Calendar icon
    expect(container.querySelector("svg.lucide-calendar")).toBeTruthy();
  });

  it("respects extra className", () => {
    cleanup();
    const { container } = render(
      <EmptyState title="x" description="y" className="my-custom-class" />,
    );
    expect(container.firstChild).toHaveProperty("className");
    expect((container.firstChild as HTMLElement).className).toContain("my-custom-class");
  });
});
