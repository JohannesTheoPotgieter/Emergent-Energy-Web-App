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
import { Link, useLocation } from "wouter";
import {
  Target,
  CalendarDays,
  ListTodo,
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

const navTabs = [
  { label: "Today", path: "/my-tool", icon: Target },
  { label: "Week", path: "/my-tool/week", icon: CalendarDays },
  { label: "Backlog", path: "/my-tool/backlog", icon: ListTodo },
  { label: "Settings", path: "/my-tool/settings", icon: Settings },
];

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
    <div className="space-y-6 max-w-[1400px] mx-auto" data-testid="mytool-settings-page">
      <header className="space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-2">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-gray-900 dark:text-gray-50" data-testid="text-page-title">
              My Tool
            </h1>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Settings &amp; Preferences</p>
          </div>
          {user && (
            <p className="text-sm text-gray-400" data-testid="text-user-greeting">
              Hey, {user.name}
            </p>
          )}
        </div>
        <nav className="flex gap-1 border-b border-gray-200 dark:border-gray-700" data-testid="nav-tabs">
          {navTabs.map((tab) => {
            const isActive = location === tab.path;
            return (
              <Link
                key={tab.path}
                href={tab.path}
                data-testid={`nav-tab-${tab.label.toLowerCase()}`}
                className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                  isActive
                    ? "border-blue-600 text-blue-600"
                    : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
                }`}
              >
                <tab.icon className="h-4 w-4" />
                {tab.label}
              </Link>
            );
          })}
        </nav>
      </header>

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
