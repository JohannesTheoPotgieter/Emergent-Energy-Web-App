import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useLocation, useSearch } from "wouter";
import MyToolNav from "@/components/my-tool-nav";
import {
  Settings,
  Loader2,
  Save,
  Mail,
  AlertCircle,
  CheckCircle2,
} from "lucide-react";

interface UserPreferences {
  defaultView: "today" | "week" | "backlog";
  workdayStartTime: string;
  workdayEndTime: string;
  showCompanyPriorities: boolean;
}

interface OutlookConnection {
  configured: boolean;
  connected: boolean;
  email?: string;
  connectedAt?: string;
  lastSyncAt?: string;
}

function parseTime(t: string): number | null {
  const m = t.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const h = parseInt(m[1], 10);
  const min = parseInt(m[2], 10);
  if (h < 0 || h > 23 || min < 0 || min > 59) return null;
  return h * 60 + min;
}

export default function MyToolSettingsPage() {
  const { user } = useAuth();
  const [location, setLocation] = useLocation();
  const searchString = useSearch();
  const { toast } = useToast();
  const [validationError, setValidationError] = useState<string | null>(null);

  const [form, setForm] = useState<UserPreferences>({
    defaultView: "today",
    workdayStartTime: "08:00",
    workdayEndTime: "17:00",
    showCompanyPriorities: true,
  });

  const { data: preferences, isLoading } = useQuery<UserPreferences>({
    queryKey: ["/api/mytool/preferences"],
  });

  const { data: outlookStatus, refetch: refetchOutlook } = useQuery<OutlookConnection>({
    queryKey: ["/api/outlook/status"],
    retry: false,
  });

  useEffect(() => {
    const params = new URLSearchParams(searchString);
    if (params.get("outlook_error")) {
      const err = params.get("outlook_error");
      const messages: Record<string, string> = {
        connect_failed: "Could not connect to Outlook. Please try again.",
        auth_denied: "Outlook authorisation was cancelled or denied.",
        callback_failed: "Something went wrong during Outlook sign-in.",
      };
      toast({ title: "Outlook error", description: messages[err!] || "An error occurred.", variant: "destructive" });
      setLocation("/my-tool/settings", { replace: true });
    }
  }, [searchString]);

  useEffect(() => {
    if (preferences) {
      setForm(preferences);
    }
  }, [preferences]);

  useEffect(() => {
    const start = parseTime(form.workdayStartTime);
    const end = parseTime(form.workdayEndTime);
    if (start !== null && end !== null && end <= start) {
      setValidationError("End time must be later than start time.");
    } else if (form.workdayStartTime && parseTime(form.workdayStartTime) === null) {
      setValidationError("Start time must be in HH:MM format (e.g. 08:00).");
    } else if (form.workdayEndTime && parseTime(form.workdayEndTime) === null) {
      setValidationError("End time must be in HH:MM format (e.g. 17:00).");
    } else {
      setValidationError(null);
    }
  }, [form.workdayStartTime, form.workdayEndTime]);

  const saveMutation = useMutation({
    mutationFn: async (body: UserPreferences) => {
      await apiRequest("PUT", "/api/mytool/preferences", body);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/mytool/preferences"] });
      toast({
        title: "Settings saved",
        description: "Your preferences have been updated successfully.",
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to save preferences. Please try again.",
        variant: "destructive",
      });
    },
  });

  const handleSave = () => {
    if (validationError) {
      toast({ title: "Validation error", description: validationError, variant: "destructive" });
      return;
    }
    saveMutation.mutate(form);
  };

  if (isLoading) {
    return (
      <div className="max-w-[1400px] mx-auto space-y-5" data-testid="mytool-settings-skeleton">
        <MyToolNav subtitle="Settings &amp; Preferences" />
        <Card>
          <CardHeader>
            <Skeleton className="h-5 w-32" />
          </CardHeader>
          <CardContent className="space-y-6">
            <Skeleton className="h-10 w-64" />
            <div className="grid grid-cols-2 gap-4 max-w-md">
              <Skeleton className="h-10 w-32" />
              <Skeleton className="h-10 w-32" />
            </div>
            <Skeleton className="h-6 w-48" />
            <Skeleton className="h-10 w-40" />
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="max-w-[1400px] mx-auto space-y-5" data-testid="mytool-settings-page">
      <MyToolNav subtitle="Settings &amp; Preferences" />

      <Card data-testid="card-preferences">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Settings className="h-4 w-4 text-blue-600" />
            Preferences
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-2">
            <Label htmlFor="default-view" data-testid="label-default-view">Default View</Label>
            <Select
              value={form.defaultView}
              onValueChange={(val) => setForm({ ...form, defaultView: val as UserPreferences["defaultView"] })}
            >
              <SelectTrigger id="default-view" data-testid="select-default-view" className="w-full max-w-xs">
                <SelectValue placeholder="Select default view" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="today" data-testid="option-today">Today</SelectItem>
                <SelectItem value="week" data-testid="option-week">Week</SelectItem>
                <SelectItem value="backlog" data-testid="option-backlog">Backlog</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-md">
            <div className="space-y-2">
              <Label htmlFor="workday-start" data-testid="label-workday-start">Workday Start Time</Label>
              <Input
                id="workday-start"
                type="time"
                value={form.workdayStartTime}
                onChange={(e) => setForm({ ...form, workdayStartTime: e.target.value })}
                data-testid="input-workday-start"
                className="max-w-[140px]"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="workday-end" data-testid="label-workday-end">Workday End Time</Label>
              <Input
                id="workday-end"
                type="time"
                value={form.workdayEndTime}
                onChange={(e) => setForm({ ...form, workdayEndTime: e.target.value })}
                data-testid="input-workday-end"
                className="max-w-[140px]"
              />
            </div>
          </div>

          {validationError && (
            <div className="flex items-center gap-2 text-sm text-red-600" data-testid="text-validation-error">
              <AlertCircle className="h-4 w-4 shrink-0" />
              {validationError}
            </div>
          )}

          <div className="flex items-center gap-3">
            <Switch
              id="show-priorities"
              checked={form.showCompanyPriorities}
              onCheckedChange={(checked) => setForm({ ...form, showCompanyPriorities: checked })}
              data-testid="switch-show-priorities"
            />
            <Label htmlFor="show-priorities" data-testid="label-show-priorities">
              Show company priorities
            </Label>
          </div>

          <div className="pt-2">
            <Button
              onClick={handleSave}
              disabled={saveMutation.isPending || !!validationError}
              data-testid="button-save-preferences"
            >
              {saveMutation.isPending ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Save className="h-4 w-4 mr-2" />
              )}
              Save Preferences
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card data-testid="card-outlook">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Mail className="h-4 w-4 text-blue-600" />
            Outlook Integration
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-gray-600 dark:text-gray-400">
            Your Microsoft Outlook account is managed through the platform connection.
            Calendar events, time block sync, and approval emails use this connection.
          </p>

          {outlookStatus?.connected ? (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                <span className="text-sm font-medium text-emerald-700 dark:text-emerald-400">Connected</span>
                {outlookStatus.email && (
                  <Badge variant="secondary" className="text-xs">{outlookStatus.email}</Badge>
                )}
              </div>
              <p className="text-xs text-gray-500">
                Your Outlook account is connected and ready. Calendar events will appear in Today and Week views.
              </p>
            </div>
          ) : outlookStatus?.configured === false ? (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <AlertCircle className="h-4 w-4 text-amber-500" />
                <span className="text-sm text-amber-600 dark:text-amber-400">Not configured</span>
              </div>
              <p className="text-xs text-gray-500">
                The Outlook connector has not been set up yet. Please ask your administrator to configure the Outlook connection in the platform settings.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <AlertCircle className="h-4 w-4 text-amber-500" />
                <span className="text-sm text-amber-600 dark:text-amber-400">Connection issue</span>
              </div>
              <p className="text-xs text-gray-500">
                The Outlook connector is configured but the connection may need to be refreshed. Please ask your administrator to check the Outlook connection in platform settings.
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
