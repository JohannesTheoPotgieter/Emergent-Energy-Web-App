import { useMemo, useState } from "react";
import { useGatesCommitments } from "@/hooks/use-collaboration-workflow";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { useLocation } from "wouter";
import { Search, Handshake } from "lucide-react";
import { PageError, PageSkeleton } from "@/components/ui/page-states";
import { PageHeader } from "@/components/ui/page-header";
import { PageLayout, TableLayout } from "@/components/layout";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { ClientCommitment } from "@shared/schema";

const STATUS_BADGES: Record<string, { label: string; color: string }> = {
  open: { label: "Open", color: "bg-blue-100 text-blue-700" },
  delivered: { label: "Delivered", color: "bg-green-100 text-green-700" },
  overdue: { label: "Overdue", color: "bg-red-100 text-red-700" },
  cancelled: { label: "Cancelled", color: "bg-gray-100 text-gray-500" },
};

function formatStage(code: string) {
  return code.replace(/_/g, " ").replace(/^S\d+\s/, "");
}

export default function GatesCommitmentsPage() {
  const { data, isLoading, error } = useGatesCommitments();
  const [search, setSearch] = useState("");
  const [, navigate] = useLocation();

  const commitments = useMemo(() => {
    if (!data?.commitments) return [];
    return data.commitments;
  }, [data?.commitments]);

  const filtered = useMemo(() => {
    if (!search) return commitments;
    const term = search.toLowerCase();
    return commitments.filter((c: ClientCommitment) =>
      (c.commitmentText || "").toLowerCase().includes(term) ||
      (c.stageCodeCreated || "").toLowerCase().includes(term)
    );
  }, [commitments, search]);

  if (isLoading) return <PageSkeleton />;
  if (error) return <PageError message="Failed to load commitments" />;

  const openCount = filtered.filter((c: ClientCommitment) => c.status === "open").length;
  const subtitle = filtered.length === 0
    ? "No open commitments found"
    : `${filtered.length} commitment${filtered.length !== 1 ? "s" : ""}${openCount > 0 ? ` · ${openCount} open` : ""}`;

  const toolbar = (
    <div className="flex items-center gap-3 w-full">
      <div className="relative flex-1 max-w-sm">
        <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search commitments..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9"
          data-testid="input-search-gates-commitments"
        />
      </div>
      {openCount > 0 && (
        <Badge className="bg-amber-100 text-amber-700" data-testid="badge-open-commitments">
          <Handshake className="mr-1 h-3 w-3" /> {openCount} open
        </Badge>
      )}
    </div>
  );

  const emptyRow = (
    <TableRow>
      <TableCell colSpan={5} className="py-12 text-center">
        <div className="flex flex-col items-center gap-2 text-muted-foreground">
          <Handshake className="h-8 w-8" />
          <p className="text-sm font-medium">No open commitments found</p>
        </div>
      </TableCell>
    </TableRow>
  );

  const table = (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Commitment</TableHead>
          <TableHead>Created At Stage</TableHead>
          <TableHead>Delivery Stage</TableHead>
          <TableHead>Date</TableHead>
          <TableHead>Status</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {filtered.length === 0 ? emptyRow : filtered.map((c: ClientCommitment) => {
          const badge = STATUS_BADGES[c.status] || STATUS_BADGES.open;
          return (
            <TableRow
              key={c.id}
              className="cursor-pointer"
              onClick={() => navigate(`/project/${c.projectId}`)}
              data-testid={`row-commitment-${c.id}`}
            >
              <TableCell>
                <div className="font-medium">{c.commitmentText}</div>
                {c.notes && <div className="text-xs text-muted-foreground line-clamp-1">{c.notes}</div>}
              </TableCell>
              <TableCell className="text-xs">{formatStage(c.stageCodeCreated)}</TableCell>
              <TableCell className="text-xs">{c.deliveryStageCode ? formatStage(c.deliveryStageCode) : "—"}</TableCell>
              <TableCell className="text-xs">
                {c.committedDate ? new Date(c.committedDate).toLocaleDateString() : "—"}
              </TableCell>
              <TableCell>
                <Badge className={badge.color}>{badge.label}</Badge>
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );

  return (
    <PageLayout
      data-testid="gates-commitments-page"
      header={
        <PageHeader
          title="Client Commitments"
          subtitle={subtitle}
        />
      }
    >
      <TableLayout
        toolbar={toolbar}
        table={table}
      />
    </PageLayout>
  );
}
