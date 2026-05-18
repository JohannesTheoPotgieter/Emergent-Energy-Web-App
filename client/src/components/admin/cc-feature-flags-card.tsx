import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useAdminFetch } from "@/hooks/use-admin-fetch";
import { AdminQueryState } from "@/components/admin/admin-shell";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ToggleLeft } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { getQueryError } from "./cc-utils";
import type { FeatureFlag, RolloutFoundationFlag } from "./cc-types";

export function CcFeatureFlagsCard() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [overrideDraft, setOverrideDraft] = useState<{ key: string; value: boolean; suggestedValue: boolean; reason: string } | null>(null);

  const flagsQuery = useAdminFetch<FeatureFlag[]>(
    "/api/admin/control-center/feature-flags",
    ["admin-control-flags"],
  );
  const rolloutQuery = useAdminFetch<{ flags: RolloutFoundationFlag[] }>(
    "/api/admin/control-center/rollout-foundation",
    ["admin-control-rollout-foundation"],
  );

  const flags = flagsQuery.data ?? [];
  const rolloutFoundation = rolloutQuery.data ?? { flags: [] };
  const cleanedAdminVisibilityEnabled = flags.find((f) => f.key === "cleaned_admin_visibility")?.value === true;

  const toggleFlag = useMutation({
    mutationFn: async ({ key, value, reason, suggestedValue }: { key: string; value: boolean; reason?: string; suggestedValue?: boolean | null }) => {
      const token = localStorage.getItem("auth_token");
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (token) headers["Authorization"] = `Bearer ${token}`;
      const res = await fetch(`/api/admin/control-center/feature-flags/${key}`, {
        method: "PUT",
        headers,
        credentials: "include",
        body: JSON.stringify({ value, reason, suggestedValue }),
      });
      if (!res.ok) throw new Error("Failed to toggle flag");
      return res.json();
    },
    onSuccess: (_, vars) => {
      queryClient.invalidateQueries({ queryKey: ["admin-control-flags"] });
      toast({ title: "Feature flag updated", description: `${vars.key} set to ${vars.value ? "ON" : "OFF"}` });
      setOverrideDraft(null);
    },
    onError: (err: Error) => {
      toast({ title: "Update failed", description: err?.message || "Failed to update flag", variant: "destructive" });
    },
  });

  return (
    <>
      <Card data-testid="card-feature-flags">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <ToggleLeft className="h-4 w-4 text-cyan-600" />
            Feature Flags
          </CardTitle>
          <CardDescription>Toggle system features</CardDescription>
        </CardHeader>
        <CardContent>
          <AdminQueryState
            isLoading={flagsQuery.isLoading}
            error={flagsQuery.error ? getQueryError(flagsQuery.error, "Feature flag controls could not be loaded.") : null}
            onRetry={() => { void flagsQuery.refetch(); void rolloutQuery.refetch(); }}
            empty={flags.length === 0}
            emptyTitle="No feature flags configured"
            emptyDescription="Feature governance flags will appear here once configured."
            loadingLabel="Loading feature flags..."
          >
            <div className="space-y-3">
              {flags.map((flag) => (
                <div key={flag.key} className="flex items-center justify-between p-3 rounded-lg border border-border">
                  <div className="space-y-0.5">
                    <p className="text-sm font-medium font-mono" data-testid={`text-flag-key-${flag.key}`}>{flag.key}</p>
                    {flag.updatedBy && (
                      <p className="text-xs text-muted-foreground">
                        Updated by {flag.updatedBy}
                        {flag.updatedAt && ` · ${new Date(flag.updatedAt).toLocaleDateString()}`}
                      </p>
                    )}
                  </div>
                  <Switch
                    checked={flag.value}
                    onCheckedChange={(checked) => {
                      const rolloutFlag = rolloutFoundation.flags?.find((item) => item.key === flag.key);
                      if (cleanedAdminVisibilityEnabled && rolloutFlag && rolloutFlag.defaultValue !== checked) {
                        setOverrideDraft({ key: flag.key, value: checked, suggestedValue: rolloutFlag.defaultValue, reason: "" });
                        return;
                      }
                      toggleFlag.mutate({ key: flag.key, value: checked, suggestedValue: rolloutFlag?.defaultValue ?? null });
                    }}
                    data-testid={`switch-flag-${flag.key}`}
                  />
                </div>
              ))}
            </div>
          </AdminQueryState>
        </CardContent>
      </Card>

      <Dialog open={!!overrideDraft} onOpenChange={(open) => { if (!open) setOverrideDraft(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Override suggested flag value</DialogTitle>
            <DialogDescription>
              A reason is required when overriding the recommended value. This is audit logged with suggested and final values.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="flag-override-reason">Reason</Label>
            <Input
              id="flag-override-reason"
              value={overrideDraft?.reason ?? ""}
              onChange={(e) => setOverrideDraft((prev) => (prev ? { ...prev, reason: e.target.value } : prev))}
              placeholder="Describe why the suggested value is being overridden"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOverrideDraft(null)}>Cancel</Button>
            <Button
              onClick={() => {
                if (!overrideDraft) return;
                toggleFlag.mutate({
                  key: overrideDraft.key,
                  value: overrideDraft.value,
                  suggestedValue: overrideDraft.suggestedValue,
                  reason: overrideDraft.reason,
                });
              }}
              disabled={!overrideDraft?.reason.trim() || toggleFlag.isPending}
            >
              Save override
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
