import { Button } from "@/components/ui/button";
import type { CompanyRootSummary } from "./types";

interface Props {
  // Company scope — browses a company_sharepoint_roots root. Per-project
  // documents are now bound per discipline (browse-and-bind), not browsed here.
  company: CompanyRootSummary[];
  selectedCompanyRootId: number | null;
  onCompanyRootSelect: (rootId: number) => void;
}

export function RootSelector({
  company,
  selectedCompanyRootId,
  onCompanyRootSelect,
}: Props) {
  return (
    <div className="flex flex-col gap-1">
      {company.length === 0 && (
        <p className="text-xs text-muted-foreground px-2 py-3">
          No company-wide SharePoint roots configured yet.
        </p>
      )}
      {company.map((r) => (
        <Button
          key={`company-${r.id}`}
          variant={selectedCompanyRootId === r.id ? "secondary" : "ghost"}
          className="justify-start text-left h-auto py-2"
          onClick={() => onCompanyRootSelect(r.id)}
          data-testid={`documents-root-company-${r.id}`}
        >
          <div className="flex flex-col items-start">
            <span className="text-sm font-medium">{r.displayName}</span>
            <span className="text-xs text-muted-foreground">{r.rootPath}</span>
          </div>
        </Button>
      ))}
    </div>
  );
}
