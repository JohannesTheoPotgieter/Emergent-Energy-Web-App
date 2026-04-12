import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { Settings, Bell, Clock, Monitor } from "lucide-react";
import { PageShell, SectionHeader } from "@/components/layout/page-shell";

function authHeaders() {
  const token = localStorage.getItem("auth_token");
  const h: Record<string, string> = {};
  if (token) h["Authorization"] = `Bearer ${token}`;
  return h;
}

interface UserPreferences {
  timezone?: string;
  emailNotifications?: boolean;
  inAppNotifications?: boolean;
  weekStartDay?: string;
  compactMode?: boolean;
}

export default function MyWorkSettingsPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: prefs, isLoading } = useQuery<UserPreferences>({
    queryKey: ["/api/user/preferences"],
    queryFn: async () => {
      const res = await fetch("/api/user/preferences", { headers: authHeaders() });
      if (!res.ok) return {};
      return res.json();
    },
  });

  const [localPrefs, setLocalPrefs] = useState<UserPreferences>({});
  const merged = { ...prefs, ...localPrefs };

  const saveMutation = useMutation({
    mutationFn: async (newPrefs: UserPreferences) => {
      const res = await fetch("/api/user/preferences", {
        method: "PATCH",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify(newPrefs),
      });
      if (!res.ok) throw new Error("Failed to save preferences");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/user/preferences"] });
      setLocalPrefs({});
      toast({ title: "Settings saved", description: "Your preferences have been updated." });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to save preferences.", variant: "destructive" });
    },
  });

  const handleToggle = (key: keyof UserPreferences) => {
    setLocalPrefs((prev) => ({ ...prev, [key]: !merged[key] }));
  };

  const handleSave = () => {
    saveMutation.mutate({ ...prefs, ...localPrefs });
  };

  const hasChanges = Object.keys(localPrefs).length > 0;

  return (
    <PageShell>
      <SectionHeader icon={<Settings />} title="Settings & Preferences" />

      <div className="grid gap-6 max-w-2xl">
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2">
              <Bell className="h-4 w-4 text-muted-foreground" />
              <h3 className="font-semibold">Notifications</h3>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <Label htmlFor="emailNotifications">Email notifications</Label>
              <Switch
                id="emailNotifications"
                checked={merged.emailNotifications ?? true}
                onCheckedChange={() => handleToggle("emailNotifications")}
              />
            </div>
            <div className="flex items-center justify-between">
              <Label htmlFor="inAppNotifications">In-app notifications</Label>
              <Switch
                id="inAppNotifications"
                checked={merged.inAppNotifications ?? true}
                onCheckedChange={() => handleToggle("inAppNotifications")}
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2">
              <Monitor className="h-4 w-4 text-muted-foreground" />
              <h3 className="font-semibold">Display</h3>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <Label htmlFor="compactMode">Compact mode</Label>
              <Switch
                id="compactMode"
                checked={merged.compactMode ?? false}
                onCheckedChange={() => handleToggle("compactMode")}
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2">
              <Clock className="h-4 w-4 text-muted-foreground" />
              <h3 className="font-semibold">Regional</h3>
            </div>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between">
              <Label>Timezone</Label>
              <span className="text-sm text-muted-foreground">
                {merged.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone}
              </span>
            </div>
          </CardContent>
        </Card>

        {hasChanges && (
          <div className="flex justify-end">
            <Button onClick={handleSave} disabled={saveMutation.isPending}>
              {saveMutation.isPending ? "Saving..." : "Save Changes"}
            </Button>
          </div>
        )}
      </div>
    </PageShell>
  );
}
