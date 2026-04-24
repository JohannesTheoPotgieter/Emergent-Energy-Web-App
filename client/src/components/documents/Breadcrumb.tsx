import { ChevronRight, Home } from "lucide-react";
import { Button } from "@/components/ui/button";

export interface Crumb {
  id: string | null; // null = root
  name: string;
}

interface Props {
  rootLabel: string;
  crumbs: Crumb[];
  onNavigate: (index: number) => void; // index in the crumbs array; -1 = back to root
}

export function DocumentsBreadcrumb({ rootLabel, crumbs, onNavigate }: Props) {
  return (
    <div className="flex items-center flex-wrap gap-1 text-xs text-muted-foreground" data-testid="documents-breadcrumb">
      <Button
        variant="ghost"
        size="sm"
        className="h-7 px-2"
        onClick={() => onNavigate(-1)}
      >
        <Home className="h-3 w-3 mr-1" />
        {rootLabel}
      </Button>
      {crumbs.map((c, idx) => (
        <div key={`${c.id ?? "root"}-${idx}`} className="flex items-center gap-1">
          <ChevronRight className="h-3 w-3" />
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2"
            onClick={() => onNavigate(idx)}
          >
            {c.name}
          </Button>
        </div>
      ))}
    </div>
  );
}
