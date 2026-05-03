/**
 * Merge two clients into one (Task #73).
 *
 * Pick a survivor for the given loser, preview how many rows across
 * every linked table will be re-pointed, then commit. The dialog never
 * lets you pick the loser as its own survivor and only shows live
 * (non-deleted) clients in the picker.
 */

import { useState, useMemo, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, AlertTriangle, Check, ChevronsUpDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";

interface ClientLite {
  id: number;
  clientId: string;
  name: string;
}

export interface MergeClientDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  loser: ClientLite | null;
  candidateClients: ClientLite[];
  /** Optional pre-selected survivor id (used when the delete dialog
   *  pivots into "merge instead"). */
  initialSurvivorId?: number | null;
  onMerged?: () => void;
}

interface MergePreviewResponse {
  loser: ClientLite;
  survivor: ClientLite;
  repointedCounts: Record<string, number>;
  totalRepointed: number;
}

const PRETTY_TABLE_LABELS: Record<string, string> = {
  project_info: "Projects",
  opportunities: "Opportunities",
  engineering_tickets: "Engineering tickets",
  work_items: "Work items",
  sites: "Sites",
  quickbooks_customer_mappings: "QuickBooks customer mappings",
  email_project_links: "Email links",
};

function prettyTable(name: string): string {
  return PRETTY_TABLE_LABELS[name] ?? name;
}

// All fetches go through `apiRequest` so they pick up the bearer
// token + CSRF + correlation-id that the rest of the app sends. Raw
// `fetch` with only `credentials: include` would fail under
// token-only sessions.
async function getJson<T>(url: string): Promise<T> {
  const res = await apiRequest("GET", url);
  return res.json() as Promise<T>;
}
async function postJson<T>(url: string, body: unknown): Promise<T> {
  const res = await apiRequest("POST", url, body);
  return res.json() as Promise<T>;
}

export function MergeClientDialog(props: MergeClientDialogProps) {
  const { open, onOpenChange, loser, candidateClients, initialSurvivorId, onMerged } = props;
  const { toast } = useToast();
  const qc = useQueryClient();

  const [survivorId, setSurvivorId] = useState<number | null>(initialSurvivorId ?? null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [reason, setReason] = useState("");

  // Reset internal state every time the dialog opens for a new loser.
  useEffect(() => {
    if (open) {
      setSurvivorId(initialSurvivorId ?? null);
      setConfirmed(false);
      setReason("");
    }
  }, [open, loser?.id, initialSurvivorId]);

  const survivors = useMemo(
    () => candidateClients.filter((c) => c.id !== loser?.id),
    [candidateClients, loser?.id],
  );
  const selectedSurvivor = useMemo(
    () => survivors.find((s) => s.id === survivorId) ?? null,
    [survivors, survivorId],
  );

  const previewQuery = useQuery<MergePreviewResponse>({
    queryKey: ["merge-preview", loser?.id, survivorId],
    enabled: !!(open && loser?.id && survivorId),
    queryFn: () =>
      getJson<MergePreviewResponse>(
        `/api/pd/clients/${loser!.id}/merge-preview?into=${survivorId}`,
      ),
  });

  const mergeMutation = useMutation({
    mutationFn: () =>
      postJson(`/api/pd/clients/${loser!.id}/merge`, {
        survivorClientId: survivorId,
        reason: reason.trim() || undefined,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["clients"] });
      qc.invalidateQueries({ queryKey: ["clients-project-counts"] });
      qc.invalidateQueries({ queryKey: ["projects-summary-for-clients"] });
      qc.invalidateQueries({ queryKey: ["/api/projects-summary"] });
      qc.invalidateQueries({ queryKey: ["/api/pd/clients"] });
      qc.invalidateQueries({ queryKey: ["/api/clients"] });
      toast({ title: `Merged ${loser?.name} into ${selectedSurvivor?.name}` });
      onOpenChange(false);
      onMerged?.();
    },
    onError: (err: Error) => {
      toast({ title: "Merge failed", description: err.message, variant: "destructive" });
    },
  });

  const previewCounts = previewQuery.data?.repointedCounts ?? {};
  const totalRepointed = previewQuery.data?.totalRepointed ?? 0;

  const canConfirm =
    !!loser &&
    !!selectedSurvivor &&
    confirmed &&
    !mergeMutation.isPending &&
    !previewQuery.isFetching;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl" data-testid="dialog-merge-client">
        <DialogHeader>
          <DialogTitle>Merge client</DialogTitle>
          <DialogDescription>
            Move every project, opportunity, ticket and link from <strong>{loser?.name}</strong> onto a chosen
            survivor client. The loser will be soft-deleted and removed from pickers.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5 py-2">
          {/* Loser → Survivor visual */}
          <div className="flex items-center gap-3 rounded-lg border bg-muted/30 px-4 py-3">
            <div className="flex-1 min-w-0">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Loser (will be deleted)</p>
              <p className="font-medium truncate" data-testid="text-merge-loser-name">{loser?.name}</p>
              <Badge variant="outline" className="mt-1 text-xs">{loser?.clientId}</Badge>
            </div>
            <ArrowRight className="h-5 w-5 text-muted-foreground shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Survivor</p>
              <p className="font-medium truncate" data-testid="text-merge-survivor-name">
                {selectedSurvivor?.name ?? <span className="text-muted-foreground">Pick a survivor below</span>}
              </p>
              {selectedSurvivor && (
                <Badge variant="outline" className="mt-1 text-xs">{selectedSurvivor.clientId}</Badge>
              )}
            </div>
          </div>

          {/* Survivor picker */}
          <div className="space-y-2">
            <label className="text-sm font-medium">Survivor client</label>
            <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  role="combobox"
                  className="w-full justify-between font-normal"
                  data-testid="select-merge-survivor"
                >
                  {selectedSurvivor
                    ? `${selectedSurvivor.name} (${selectedSurvivor.clientId})`
                    : "Search and pick a survivor client..."}
                  <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
                <Command>
                  <CommandInput placeholder="Search clients..." data-testid="input-merge-survivor-search" />
                  <CommandList>
                    <CommandEmpty>No clients found.</CommandEmpty>
                    <CommandGroup>
                      {survivors.map((c) => (
                        <CommandItem
                          key={c.id}
                          value={`${c.name} ${c.clientId}`}
                          onSelect={() => {
                            setSurvivorId(c.id);
                            setPickerOpen(false);
                          }}
                          data-testid={`option-merge-survivor-${c.id}`}
                        >
                          <Check className={`mr-2 h-4 w-4 ${survivorId === c.id ? "opacity-100" : "opacity-0"}`} />
                          <div className="flex-1 truncate">{c.name}</div>
                          <Badge variant="outline" className="ml-2 text-xs">{c.clientId}</Badge>
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>
          </div>

          {/* Impact preview */}
          {selectedSurvivor && (
            <div className="space-y-2">
              <p className="text-sm font-medium">What will move</p>
              {previewQuery.isLoading ? (
                <p className="text-sm text-muted-foreground">Calculating impact…</p>
              ) : previewQuery.isError ? (
                <p className="text-sm text-destructive">Could not compute preview: {(previewQuery.error as Error).message}</p>
              ) : (
                <div className="grid grid-cols-2 gap-2 rounded-md border p-3 text-sm" data-testid="preview-merge-counts">
                  {Object.entries(previewCounts)
                    .sort(([a], [b]) => a.localeCompare(b))
                    .map(([table, count]) => (
                      <div key={table} className="flex justify-between gap-2">
                        <span className="text-muted-foreground">{prettyTable(table)}</span>
                        <span className="font-mono font-medium" data-testid={`count-merge-${table}`}>{count}</span>
                      </div>
                    ))}
                  <div className="col-span-2 mt-1 flex justify-between border-t pt-2 text-sm font-semibold">
                    <span>Total rows re-pointed</span>
                    <span className="font-mono" data-testid="count-merge-total">{totalRepointed}</span>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Optional reason */}
          <div className="space-y-2">
            <label className="text-sm font-medium" htmlFor="merge-reason">Reason (optional)</label>
            <Textarea
              id="merge-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Duplicate created during Pipedrive sync"
              rows={2}
              data-testid="input-merge-reason"
            />
          </div>

          {/* Confirmation gate */}
          <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm dark:border-amber-900/50 dark:bg-amber-950/30">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
            <div className="flex-1">
              <label className="flex cursor-pointer items-start gap-2">
                <Checkbox
                  checked={confirmed}
                  onCheckedChange={(v) => setConfirmed(v === true)}
                  data-testid="checkbox-merge-confirm"
                  className="mt-0.5"
                />
                <span>
                  I understand this cannot be undone from the UI. The loser will be soft-deleted and every
                  linked record will permanently belong to the survivor.
                </span>
              </label>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} data-testid="button-merge-cancel">
            Cancel
          </Button>
          <Button
            onClick={() => mergeMutation.mutate()}
            disabled={!canConfirm}
            data-testid="button-merge-confirm"
          >
            {mergeMutation.isPending ? "Merging…" : "Merge clients"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
