import * as React from "react";
import * as Tooltip from "@radix-ui/react-tooltip";
import { Info } from "lucide-react";

interface FieldHintProps {
  hint: string;
}

export function FieldHint({ hint }: FieldHintProps) {
  return (
    <Tooltip.Provider delayDuration={150}>
      <Tooltip.Root>
        <Tooltip.Trigger asChild>
          <button
            type="button"
            className="inline-flex h-4 w-4 items-center justify-center align-middle text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded-sm"
            aria-label="Field help"
          >
            <Info className="h-3.5 w-3.5" />
          </button>
        </Tooltip.Trigger>
        <Tooltip.Portal>
          <Tooltip.Content
            sideOffset={6}
            className="z-50 max-w-xs rounded-md bg-primary px-2.5 py-1.5 text-xs text-primary-foreground shadow-md"
          >
            {hint}
            <Tooltip.Arrow className="fill-primary" />
          </Tooltip.Content>
        </Tooltip.Portal>
      </Tooltip.Root>
    </Tooltip.Provider>
  );
}
