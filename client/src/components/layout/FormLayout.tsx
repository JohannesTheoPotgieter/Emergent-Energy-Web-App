import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * FormLayout — canonical W5a single-screen form composition.
 *
 * Additive Phase 1 primitive. Two-column layout (form body + context panel)
 * on desktop; stacks on mobile. Pure layout — does not own form state. The
 * caller composes a react-hook-form Form inside.
 *
 * Contract (docs/overhaul/01-design-system.md §3 L7, wireframe W5a):
 *   - form: the Form component with fields (2/3 width on desktop)
 *   - context: optional right-side help / tips / related info (1/3 width)
 *   - actions: footer action row (Cancel / Save draft / Primary)
 *   - draftKey / saved label owned by caller; primitive provides the slot
 */

export interface FormLayoutProps {
  /** The form body content. */
  form: React.ReactNode;
  /**
   * Optional help / tips panel. When omitted, the form takes full width.
   */
  context?: React.ReactNode;
  /** Footer action row (right-aligned on desktop). */
  actions?: React.ReactNode;
  /**
   * Optional "saved N seconds ago" label rendered left of actions.
   * Caller manages the timer; primitive just renders the node.
   */
  savedLabel?: React.ReactNode;
  className?: string;
}

export function FormLayout({
  form,
  context,
  actions,
  savedLabel,
  className,
}: FormLayoutProps) {
  return (
    <div
      data-testid="form-layout"
      className={cn("flex flex-col gap-6", className)}
    >
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div
          data-testid="form-layout-body"
          className={cn("space-y-4", context ? "lg:col-span-2" : "lg:col-span-3")}
        >
          {form}
        </div>
        {context && (
          <aside
            data-testid="form-layout-context"
            aria-label="Form context"
            className="lg:col-span-1"
          >
            <div className="ee-surface-muted p-4 text-sm text-muted-foreground space-y-3">
              {context}
            </div>
          </aside>
        )}
      </div>

      {actions && (
        <footer
          data-testid="form-layout-actions"
          className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between border-t border-border pt-4"
        >
          <div
            data-testid="form-layout-saved-label"
            className="text-xs text-muted-foreground"
          >
            {savedLabel}
          </div>
          <div className="flex items-center gap-2 sm:justify-end">
            {actions}
          </div>
        </footer>
      )}
    </div>
  );
}
