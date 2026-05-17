// Task #107 — Change history slide-over reachable from the page header.
//
// Wraps the existing AuditSection so the log is identical to the one in
// /admin/settings — single source of truth, no duplicated logic.

import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { History } from "lucide-react";
import { AuditSection } from "../admin-settings/audit/audit-section";

interface AuditLogDrawerProps {
  open: boolean;
  onOpenChange: (o: boolean) => void;
}

export function AuditLogDrawer({ open, onOpenChange }: AuditLogDrawerProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-full overflow-y-auto sm:max-w-2xl"
        data-testid="audit-log-drawer"
      >
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <History className="h-5 w-5 text-emerald-600" />
            Audit log
          </SheetTitle>
          <p className="text-xs text-muted-foreground">
            Every role, permission and access-control change, newest first. Filter by event type, person, or free text.
          </p>
        </SheetHeader>
        <div className="mt-4">
          <AuditSection />
        </div>
      </SheetContent>
    </Sheet>
  );
}
