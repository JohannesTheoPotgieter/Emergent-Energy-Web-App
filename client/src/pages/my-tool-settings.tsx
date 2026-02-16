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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useLocation } from "wouter";
import MyToolNav from "@/components/my-tool-nav";
import {
  Settings,
  Loader2,
  Save,
} from "lucide-react";

interface UserPreferences {
  defaultView: "today" | "week" | "backlog";
  workdayStartTime: string;
  workdayEndTime: string;
  showCompanyPriorities: boolean;
}

export default function MyToolSettingsPage() {
  const { user } = useAuth();
  const [location] = useLocation();
  const { toast } = useToast();

  const [form, setForm] = useState<UserPreferences>({
    defaultView: "today",
    workdayStartTime: "08:00",
    workdayEndTime: "17:00",
    showCompanyPriorities: true,
  });

  const { data: preferences, isLoading } = useQuery<UserPreferences>({
    queryKey: ["/api/mytool/preferences"],
  });

  useEffect(() => {
    if (preferences) {
      setForm(preferences);
    }
  }, [preferences]);

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
    saveMutation.mutate(form);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20" data-testid="loading-spinner">
        <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
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
                type="text"
                placeholder="HH:MM"
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
                type="text"
                placeholder="HH:MM"
                value={form.workdayEndTime}
                onChange={(e) => setForm({ ...form, workdayEndTime: e.target.value })}
                data-testid="input-workday-end"
                className="max-w-[140px]"
              />
            </div>
          </div>

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
              disabled={saveMutation.isPending}
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
    </div>
  );
}
