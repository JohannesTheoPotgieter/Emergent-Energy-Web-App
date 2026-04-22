import { useState } from "react";
import { useProjectDocumentSummary, type ProjectDocumentSummary } from "@/hooks/use-controlled-documents";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  FileText, Upload, ExternalLink, CheckCircle2, Clock, History, FolderOpen,
} from "lucide-react";
import { DocumentSubmitDialog } from "./DocumentSubmitDialog";
import { formatDistanceToNow } from "date-fns";
import type { ControlledDocumentType } from "@shared/schema";

interface Props {
  projectId: number;
  title?: string;
  /** When true, renders compact (no CardHeader) — useful inside project tabs. */
  embedded?: boolean;
}

/**
 * Per-project documents strip. Renders one row per controlled document
 * type, showing Approved status + pending/history counts. Submit button
 * on each row opens the DocumentSubmitDialog.
 */
export function DocumentStrip({ projectId, title = "Controlled documents", embedded = false }: Props) {
  const { data, isLoading, error } = useProjectDocumentSummary(projectId);
  const [submitFor, setSubmitFor] = useState<ControlledDocumentType | null>(null);

  const rows = data?.summary ?? [];

  const body = (
    <>
      {isLoading ? (
        <p className="text-xs text-muted-foreground py-6 text-center">Loading documents…</p>
      ) : error ? (
        <p className="text-xs text-destructive py-6 text-center">Failed to load documents</p>
      ) : rows.length === 0 ? (
        <div className="flex flex-col items-center gap-1.5 py-8 text-muted-foreground">
          <FolderOpen className="h-6 w-6 opacity-40" />
          <p className="text-xs">No document types configured.</p>
        </div>
      ) : (
        <ul className="divide-y divide-border/50" data-testid="document-strip-rows">
          {rows.map((row) => (
            <DocumentRow
              key={row.type.typeKey}
              row={row}
              onSubmit={() => setSubmitFor(row.type)}
            />
          ))}
        </ul>
      )}
    </>
  );

  if (embedded) {
    return (
      <>
        <div data-testid="document-strip" className="rounded-lg border bg-card">
          <div className="p-3">{body}</div>
        </div>
        {submitFor && (
          <DocumentSubmitDialog
            open={submitFor !== null}
            onOpenChange={(o) => { if (!o) setSubmitFor(null); }}
            projectId={projectId}
            documentType={submitFor}
          />
        )}
      </>
    );
  }

  return (
    <>
      <Card data-testid="document-strip">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <FileText className="h-4 w-4 text-primary" />
            {title}
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-0">{body}</CardContent>
      </Card>
      {submitFor && (
        <DocumentSubmitDialog
          open={submitFor !== null}
          onOpenChange={(o) => { if (!o) setSubmitFor(null); }}
          projectId={projectId}
          documentType={submitFor}
        />
      )}
    </>
  );
}

function DocumentRow({ row, onSubmit }: { row: ProjectDocumentSummary; onSubmit: () => void }) {
  const { type, approved, pendingCount, historyCount } = row;

  return (
    <li className="py-3 flex items-start gap-3" data-testid={`document-row-${type.typeKey}`}>
      <div className="flex-1 min-w-0 space-y-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-medium text-foreground">{type.displayName}</span>
          {approved ? (
            <Badge variant="outline" className="text-[10px] bg-emerald-50 text-emerald-700 border-emerald-200">
              <CheckCircle2 className="h-3 w-3 mr-0.5" />
              v{approved.versionNumber ?? 1} approved
            </Badge>
          ) : (
            <Badge variant="outline" className="text-[10px] text-muted-foreground">
              No approved version yet
            </Badge>
          )}
          {pendingCount > 0 && (
            <Badge variant="outline" className="text-[10px] bg-amber-50 text-amber-700 border-amber-200">
              <Clock className="h-3 w-3 mr-0.5" />
              {pendingCount} pending
            </Badge>
          )}
          {historyCount > 0 && (
            <Badge variant="outline" className="text-[10px] text-muted-foreground">
              <History className="h-3 w-3 mr-0.5" />
              {historyCount} history
            </Badge>
          )}
        </div>
        {approved ? (
          <>
            <p className="text-xs text-muted-foreground truncate" title={approved.fileName}>
              {approved.fileName}
            </p>
            {approved.updatedAt && (
              <p className="text-[11px] text-muted-foreground">
                Updated {formatDistanceToNow(new Date(approved.updatedAt), { addSuffix: true })}
              </p>
            )}
          </>
        ) : (
          <p className="text-xs text-muted-foreground">
            Drafts are uploaded to SharePoint; submit one here to start the approval flow.
          </p>
        )}
      </div>
      <div className="flex items-center gap-1.5 shrink-0">
        {approved?.sharepointPath && (
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs"
            asChild
            data-testid={`btn-open-${type.typeKey}`}
          >
            <a
              href={approved.sharepointPath.startsWith("http") ? approved.sharepointPath : "#"}
              target="_blank"
              rel="noopener noreferrer"
            >
              Open <ExternalLink className="h-3 w-3 ml-1" />
            </a>
          </Button>
        )}
        <Button
          size="sm"
          variant="default"
          className="h-7 text-xs"
          onClick={onSubmit}
          data-testid={`btn-submit-${type.typeKey}`}
        >
          <Upload className="h-3 w-3 mr-1" /> Submit
        </Button>
      </div>
    </li>
  );
}
