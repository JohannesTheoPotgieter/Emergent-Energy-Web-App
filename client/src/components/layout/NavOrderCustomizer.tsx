import { useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { ArrowUp, ArrowDown, RotateCcw, Settings2 } from "lucide-react";
import { useNavPreferences } from "@/hooks/use-nav-preferences";
import type { TopSection } from "@/config/app-navigation";

interface NavOrderCustomizerProps {
  visibleSections: TopSection[];
}

export function NavOrderCustomizer({ visibleSections }: NavOrderCustomizerProps) {
  const { sectionOrder, setSectionOrder, resetOrder } = useNavPreferences();

  const orderedLabels = useMemo(() => {
    const labels = visibleSections.map((s) => s.label);
    if (sectionOrder.length === 0) return labels;

    // Sort based on saved order, appending any new sections at the end
    const sorted = [...labels].sort((a, b) => {
      const aIdx = sectionOrder.indexOf(a);
      const bIdx = sectionOrder.indexOf(b);
      if (aIdx === -1 && bIdx === -1) return 0;
      if (aIdx === -1) return 1;
      if (bIdx === -1) return -1;
      return aIdx - bIdx;
    });
    return sorted;
  }, [visibleSections, sectionOrder]);

  const moveUp = (index: number) => {
    if (index <= 0) return;
    const newOrder = [...orderedLabels];
    [newOrder[index - 1], newOrder[index]] = [newOrder[index], newOrder[index - 1]];
    setSectionOrder(newOrder);
  };

  const moveDown = (index: number) => {
    if (index >= orderedLabels.length - 1) return;
    const newOrder = [...orderedLabels];
    [newOrder[index], newOrder[index + 1]] = [newOrder[index + 1], newOrder[index]];
    setSectionOrder(newOrder);
  };

  return (
    <Dialog>
      <DialogTrigger asChild>
        <button className="flex items-center gap-2 w-full px-2 py-1.5 text-sm text-left rounded-sm hover:bg-accent hover:text-accent-foreground transition-colors">
          <Settings2 className="h-4 w-4" />
          Customize Navigation
        </button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Customize Navigation Order</DialogTitle>
        </DialogHeader>
        <div className="space-y-1 mt-2">
          {orderedLabels.map((label, index) => (
            <div
              key={label}
              className="flex items-center gap-2 px-3 py-2 rounded-md border border-border/60 bg-background"
            >
              <span className="text-sm font-medium flex-1">{label}</span>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6"
                onClick={() => moveUp(index)}
                disabled={index === 0}
              >
                <ArrowUp className="h-3.5 w-3.5" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6"
                onClick={() => moveDown(index)}
                disabled={index === orderedLabels.length - 1}
              >
                <ArrowDown className="h-3.5 w-3.5" />
              </Button>
            </div>
          ))}
        </div>
        <div className="flex justify-end mt-3">
          <Button variant="outline" size="sm" onClick={resetOrder} className="gap-1.5">
            <RotateCcw className="h-3.5 w-3.5" />
            Reset to default
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
