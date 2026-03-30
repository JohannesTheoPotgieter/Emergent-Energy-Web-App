import { useMemo, useState } from "react";
import { useGatesCommitments } from "@/hooks/use-collaboration-workflow";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { useLocation } from "wouter";
import { Search, Handshake, AlertCircle } from "lucide-react";
import { PageError, PageSkeleton } from "@/components/ui/page-states";
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

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search commitments..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        {openCount > 0 && (
          <Badge className="bg-amber-100 text-amber-700">
            <Handshake className="mr-1 h-3 w-3" /> {openCount} open commitments
          </Badge>
        )}
      </div>

      <div className="rounded-lg border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/50">
              <th className="px-3 py-2 text-left font-medium">Commitment</th>
              <th className="px-3 py-2 text-left font-medium">Created At Stage</th>
              <th className="px-3 py-2 text-left font-medium">Delivery Stage</th>
              <th className="px-3 py-2 text-left font-medium">Date</th>
              <th className="px-3 py-2 text-left font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((c: ClientCommitment) => {
              const badge = STATUS_BADGES[c.status] || STATUS_BADGES.open;
              return (
                <tr
                  key={c.id}
                  className="border-b hover:bg-muted/30 cursor-pointer"
                  onClick={() => navigate(`/project/${c.projectId}`)}
                >
                  <td className="px-3 py-2">
                    <div className="font-medium">{c.commitmentText}</div>
                    {c.notes && <div className="text-xs text-muted-foreground line-clamp-1">{c.notes}</div>}
                  </td>
                  <td className="px-3 py-2 text-xs">{formatStage(c.stageCodeCreated)}</td>
                  <td className="px-3 py-2 text-xs">{c.deliveryStageCode ? formatStage(c.deliveryStageCode) : "—"}</td>
                  <td className="px-3 py-2 text-xs">
                    {c.committedDate ? new Date(c.committedDate).toLocaleDateString() : "—"}
                  </td>
                  <td className="px-3 py-2">
                    <Badge className={badge.color}>{badge.label}</Badge>
                  </td>
                </tr>
              );
            })}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={5} className="px-3 py-8 text-center text-muted-foreground">
                  No open commitments found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
