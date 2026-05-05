/**
 * Per-link cascade proposals panel.
 *
 * Renders the list of `qb_link_proposed_cascades` rows in `pending` status
 * for a given QuickBooks invoice link, with Accept / Decline buttons per
 * row. Surfaced inside the Find / Workbench drawers immediately after
 * approve and reusable on any link-detail surface.
 *
 * Contract: nothing on the app side mutates without an explicit Accept
 * click here — every proposal type (vendor mapping, paid_date overwrite,
 * VAT decomposition, recon-ignore clear, etc.) is a separate review item.
 * Decline records the reviewer's choice so the inbox doesn't re-nag.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  CheckCircle2,
  Loader2,
  ShieldQuestion,
  ThumbsDown,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";

interface CascadeProposal {
  id: number;
  linkId: number;
  projectId: number | null;
  targetTable: string;
  targetId: number | null;
  proposalType: string;
  fieldName: string | null;
  appValue: string | null;
  qbValue: string | null;
  reason: string | null;
  status: "pending" | "accepted" | "declined";
  createdAt: string;
}

interface QbCascadeProposalsPanelProps {
  /** Link to load proposals for. When null, the panel renders nothing. */
  linkId: number | null;
  /**
   * Optional initial proposals payload — passed by the approve / bulk-approve
   * response so the panel can render immediately without an extra round-trip.
   */
  initialProposals?: CascadeProposal[];
}

const PROPOSAL_TYPE_LABEL: Record<string, string> = {
  vendor_mapping: "Vendor mapping",
  customer_mapping: "Customer mapping",
  counterparty_id: "Counterparty on cost line",
  project_id: "Project assignment",
  paid_date: "Paid date",
  invoice_date: "Invoice date",
  invoice_number: "Invoice number",
  amount_ex_vat: "Amount ex-VAT",
  vat_amount: "VAT amount",
  name_alias: "Counterparty alias",
  recon_ignore_clear: "Clear recon-ignore",
  cost_category: "Cost category",
  pattern_rule_create: "Learn invoice-number pattern",
  description_pattern_create: "Learn memo fingerprint",
};

function formatProposalType(type: string): string {
  return PROPOSAL_TYPE_LABEL[type] ?? type;
}

export function QbCascadeProposalsPanel({
  linkId,
  initialProposals,
}: QbCascadeProposalsPanelProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const proposalsQuery = useQuery<{ linkId: number; proposals: CascadeProposal[] }>({
    queryKey: ["/api/quickbooks/invoice-matches/links", linkId, "proposals"],
    queryFn: async () => {
      const res = await apiRequest(
        "GET",
        `/api/quickbooks/invoice-matches/links/${linkId}/proposals`,
      );
      return res.json();
    },
    enabled: linkId !== null,
    initialData:
      initialProposals && linkId !== null
        ? { linkId, proposals: initialProposals }
        : undefined,
  });

  const acceptMut = useMutation({
    mutationFn: async (proposalId: number) => {
      const res = await apiRequest(
        "POST",
        `/api/quickbooks/invoice-matches/proposals/${proposalId}/accept`,
        {},
      );
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Proposal accepted", description: "App data updated from QuickBooks." });
      queryClient.invalidateQueries({
        queryKey: ["/api/quickbooks/invoice-matches/links", linkId, "proposals"],
      });
    },
    onError: (err: Error) => {
      toast({ title: "Accept failed", description: err.message, variant: "destructive" });
    },
  });

  const declineMut = useMutation({
    mutationFn: async (proposalId: number) => {
      const res = await apiRequest(
        "POST",
        `/api/quickbooks/invoice-matches/proposals/${proposalId}/decline`,
        {},
      );
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Proposal declined" });
      queryClient.invalidateQueries({
        queryKey: ["/api/quickbooks/invoice-matches/links", linkId, "proposals"],
      });
    },
    onError: (err: Error) => {
      toast({ title: "Decline failed", description: err.message, variant: "destructive" });
    },
  });

  if (linkId === null) return null;

  if (proposalsQuery.isLoading) {
    return (
      <Card className="border-emerald-200 bg-emerald-50/50">
        <CardContent className="p-4 flex items-center gap-2 text-sm text-emerald-700">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading proposed updates…
        </CardContent>
      </Card>
    );
  }

  const proposals = proposalsQuery.data?.proposals ?? [];
  if (proposals.length === 0) {
    return (
      <Card className="border-emerald-200 bg-emerald-50/30">
        <CardContent className="p-4 text-sm text-emerald-800 flex items-center gap-2">
          <CheckCircle2 className="h-4 w-4" />
          QuickBooks and the app already agree — no proposed updates for this link.
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-amber-300 bg-amber-50/40">
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center gap-2 text-sm font-medium text-amber-900">
          <AlertTriangle className="h-4 w-4" />
          Review proposed updates ({proposals.length})
        </div>
        <p className="text-xs text-amber-800">
          QuickBooks is the source of truth for these fields. The app value
          stays as-is until you Accept.
        </p>
        <div className="space-y-2">
          {proposals.map((p) => (
            <div
              key={p.id}
              className="rounded-md border border-amber-200 bg-white p-3 flex flex-col gap-2"
            >
              <div className="flex items-center gap-2 text-sm">
                <Badge variant="outline" className="border-amber-300 text-amber-900">
                  <ShieldQuestion className="h-3.5 w-3.5 mr-1" />
                  {formatProposalType(p.proposalType)}
                </Badge>
                {p.fieldName ? (
                  <span className="text-xs font-mono text-slate-500">{p.fieldName}</span>
                ) : null}
              </div>
              {p.reason ? (
                <p className="text-sm text-slate-700">{p.reason}</p>
              ) : null}
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="rounded border border-slate-200 bg-slate-50 p-2">
                  <div className="text-[10px] uppercase tracking-wide text-slate-500">
                    App
                  </div>
                  <div className="font-mono text-slate-800 break-all">
                    {p.appValue ?? <span className="italic text-slate-400">empty</span>}
                  </div>
                </div>
                <div className="rounded border border-emerald-200 bg-emerald-50 p-2">
                  <div className="text-[10px] uppercase tracking-wide text-emerald-700">
                    QuickBooks
                  </div>
                  <div className="font-mono text-emerald-900 break-all">
                    {p.qbValue ?? <span className="italic text-slate-400">empty</span>}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2 justify-end">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => declineMut.mutate(p.id)}
                  disabled={declineMut.isPending || acceptMut.isPending}
                  data-testid={`button-decline-proposal-${p.id}`}
                >
                  <ThumbsDown className="h-3.5 w-3.5 mr-1" />
                  Decline
                </Button>
                <Button
                  size="sm"
                  className="bg-emerald-600 hover:bg-emerald-700"
                  onClick={() => acceptMut.mutate(p.id)}
                  disabled={acceptMut.isPending || declineMut.isPending}
                  data-testid={`button-accept-proposal-${p.id}`}
                >
                  <CheckCircle2 className="h-3.5 w-3.5 mr-1" />
                  Accept QB value
                </Button>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

export default QbCascadeProposalsPanel;
