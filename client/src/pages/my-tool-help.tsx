import { useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import MyToolLayout from "@/components/mytool/MyToolLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  HelpCircle,
  BookOpen,
  Calendar,
  ListTodo,
  Settings,
  Mail,
  AlertTriangle,
  Bug,
  Loader2,
} from "lucide-react";

export default function MyToolHelpPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [summary, setSummary] = useState("");
  const [steps, setSteps] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const handleSubmitReport = async () => {
    if (!summary.trim() || !steps.trim()) return;
    setSubmitting(true);
    const correlationId = crypto.randomUUID();
    try {
      await apiRequest("POST", "/api/mytool/support-ticket", {
        summary: summary.trim(),
        stepsToReproduce: steps.trim(),
        route: window.location.pathname,
        userAgent: navigator.userAgent,
        timestamp: new Date().toISOString(),
        correlationId,
      });
      toast({
        title: "Problem reported successfully",
        description: `Reference: ${correlationId}`,
      });
      setDialogOpen(false);
      setSummary("");
      setSteps("");
    } catch {
      toast({
        title: "Failed to submit report. Please try again.",
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  };

  const sections = [
    {
      icon: HelpCircle,
      iconColor: "text-blue-600",
      title: "What My Tool Is",
      content: (
        <>
          <p>My Tool is your personal execution cockpit — a private workspace for planning your day, tracking your own tasks, and staying on top of company priorities that matter to you. It helps you organise what you need to get done, block out focused time, and reflect on progress at the end of each day.</p>
          <p className="mt-2 text-amber-700 dark:text-amber-400 font-medium">Important: My Tool is not a replacement for the company project tracking system. Projects, milestones, and team deliverables still live in the main dashboard. My Tool is your personal layer on top of that — a place to pull in what's relevant to you and manage your own workflow.</p>
        </>
      ),
    },
    {
      icon: BookOpen,
      iconColor: "text-indigo-600",
      title: "How Today Works",
      content: (
        <>
          <p>The Today view is your daily command centre. It's designed around a simple rhythm:</p>
          <ul className="list-disc list-inside space-y-1 mt-2 text-sm">
            <li><strong>Quick-add bar</strong> at the top — type a task title and press Enter to instantly add it to today's plan.</li>
            <li><strong>In Progress</strong> — tasks you're actively working on right now. Move a task here when you start it.</li>
            <li><strong>Planned</strong> — everything you intend to tackle today, ordered by priority.</li>
            <li><strong>Blocked / Waiting</strong> — tasks that can't move forward. Add a reason so you remember what you're waiting on.</li>
            <li><strong>Done</strong> — completed tasks (collapsed by default so they don't clutter your view).</li>
            <li><strong>Time Blocks</strong> (right column) — schedule focused work sessions by setting a start time, end time, and label. These blocks sync to your Outlook calendar if connected.</li>
            <li><strong>Company Priorities</strong> panel — see the priorities that leadership has flagged. You can convert any priority into a personal task with one click.</li>
            <li><strong>Auto Rollover</strong> — any unfinished tasks from previous days automatically appear in today's view, so nothing slips through the cracks.</li>
          </ul>
        </>
      ),
    },
    {
      icon: Calendar,
      iconColor: "text-teal-600",
      title: "How Week Works",
      content: (
        <>
          <p>The Week view gives you a 7-day horizon so you can spread tasks across the coming days and see your workload at a glance.</p>
          <ul className="list-disc list-inside space-y-1 mt-2 text-sm">
            <li><strong>7-day columns</strong> — each day shows tasks planned for that date, with status indicators and priority dots.</li>
            <li><strong>Navigate between weeks</strong> using the arrow buttons to look ahead or review past weeks.</li>
            <li><strong>Quick-add to any day</strong> — click the + button on any day column to add a task directly to that date.</li>
            <li><strong>Drag tasks between days</strong> — if plans change, drag a task from one day to another to reschedule it.</li>
            <li><strong>Today is highlighted</strong> so you always know where you are in the week.</li>
          </ul>
        </>
      ),
    },
    {
      icon: ListTodo,
      iconColor: "text-purple-600",
      title: "How Backlog Works",
      content: (
        <>
          <p>The Backlog is your complete task inventory — every task you've created, regardless of planned date or status.</p>
          <ul className="list-disc list-inside space-y-1 mt-2 text-sm">
            <li><strong>Search and filter</strong> — use the search bar to find tasks by title, or filter by status, priority, or tag.</li>
            <li><strong>Sort by any column</strong> — click column headers to sort by title, status, priority, date, or project.</li>
            <li><strong>Bulk actions</strong> — select multiple tasks and change their status, priority, or planned date all at once.</li>
            <li><strong>Company Priorities management</strong> — the top section of Backlog lets you create, edit, and archive company priorities. Set severity (critical, important, normal), assign a department, and link to a project.</li>
            <li><strong>No date required</strong> — backlog tasks don't need a planned date. They sit here until you're ready to schedule them.</li>
          </ul>
        </>
      ),
    },
    {
      icon: Settings,
      iconColor: "text-muted-foreground",
      title: "How Settings Works",
      content: (
        <>
          <p>Settings lets you personalise My Tool to match your workflow.</p>
          <ul className="list-disc list-inside space-y-1 mt-2 text-sm">
            <li><strong>Default view</strong> — choose whether My Tool opens to Today, Week, or Backlog when you navigate to it.</li>
            <li><strong>Workday start / end times</strong> — set your typical working hours (e.g., 08:00–17:00). This determines the time range shown in your time-block schedule.</li>
            <li><strong>Show / hide company priorities</strong> — toggle whether the company priorities panel appears on Today and Backlog views.</li>
            <li><strong>Outlook connection</strong> — connect or disconnect your Microsoft Outlook account to enable calendar sync. When connected, meetings appear in your Today and Week views.</li>
          </ul>
        </>
      ),
    },
    {
      icon: Mail,
      iconColor: "text-sky-600",
      title: "Outlook Integration",
      content: (
        <>
          <p>When you connect your Outlook account in Settings, two things happen:</p>
          <ul className="list-disc list-inside space-y-1 mt-2 text-sm">
            <li><strong>Meetings appear read-only</strong> — your Outlook calendar meetings are pulled into the Today and Week views so you can see your full schedule alongside your tasks. These meetings are display-only; My Tool never modifies them.</li>
            <li><strong>Time blocks sync outward</strong> — when you create a time block in My Tool, it's pushed to a dedicated Outlook calendar called <em>"EE – My Tool Blocks"</em>. This lets colleagues see when you've blocked out focus time, without cluttering your main calendar.</li>
          </ul>
          <p className="mt-2 font-medium">My Tool never edits or deletes meetings created by other people. It only reads your calendar and writes to its own dedicated calendar.</p>
        </>
      ),
    },
    {
      icon: AlertTriangle,
      iconColor: "text-amber-600",
      title: "Troubleshooting",
      content: (
        <>
          <p>If something isn't working as expected, try these steps:</p>
          <div className="space-y-3 mt-2 text-sm">
            <div>
              <p className="font-semibold">Task doesn't save</p>
              <p>Check your internet connection and try again. If the problem persists, refresh the page. Your data is saved to the server, so anything that was successfully created will still be there after a refresh.</p>
            </div>
            <div>
              <p className="font-semibold">Page doesn't load or shows an error</p>
              <p>Refresh the browser tab. If the issue continues, make sure you're still logged in — the session may have expired. Try logging out and back in. If the problem remains, use the Report a Problem button below.</p>
            </div>
            <div>
              <p className="font-semibold">Outlook calendar not syncing</p>
              <p>Go to Settings and disconnect your Outlook account, then reconnect it. This re-establishes the authentication token. If meetings still don't appear after a few minutes, confirm that your Outlook account has the correct permissions enabled.</p>
            </div>
          </div>
        </>
      ),
    },
  ];

  return (
    <MyToolLayout>
      <div className="space-y-5" data-testid="mytool-help-page">

      <div className="flex items-center justify-between" data-testid="help-header">
        <p className="text-sm text-muted-foreground dark:text-gray-400">
          Everything you need to know about using My Tool effectively.
        </p>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button variant="outline" data-testid="button-report-problem">
              <Bug className="h-4 w-4 mr-2" />
              Report a Problem
            </Button>
          </DialogTrigger>
          <DialogContent data-testid="dialog-report-problem">
            <DialogHeader>
              <DialogTitle>Report a Problem</DialogTitle>
              <DialogDescription>
                Describe what went wrong and how to reproduce it. A reference ID will be generated automatically.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-2">
              <div className="space-y-2">
                <label className="text-sm font-medium" htmlFor="report-summary">
                  Summary <span className="text-red-500">*</span>
                </label>
                <Input
                  id="report-summary"
                  placeholder="Brief description of the issue"
                  value={summary}
                  onChange={(e) => setSummary(e.target.value)}
                  data-testid="input-report-summary"
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium" htmlFor="report-steps">
                  Steps to Reproduce <span className="text-red-500">*</span>
                </label>
                <Textarea
                  id="report-steps"
                  placeholder="1. Go to...&#10;2. Click on...&#10;3. Observe that..."
                  rows={5}
                  value={steps}
                  onChange={(e) => setSteps(e.target.value)}
                  data-testid="input-report-steps"
                />
              </div>
            </div>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setDialogOpen(false)}
                data-testid="button-cancel-report"
              >
                Cancel
              </Button>
              <Button
                onClick={handleSubmitReport}
                disabled={!summary.trim() || !steps.trim() || submitting}
                data-testid="button-submit-report"
              >
                {submitting ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Bug className="h-4 w-4 mr-2" />
                )}
                Submit Report
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <div className="space-y-4">
        {sections.map((section) => (
          <Card key={section.title} data-testid={`card-help-${section.title.toLowerCase().replace(/\s+/g, "-")}`}>
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <section.icon className={`h-4 w-4 ${section.iconColor}`} />
                {section.title}
              </CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-foreground dark:text-gray-300 leading-relaxed">
              {section.content}
            </CardContent>
          </Card>
        ))}
      </div>
      </div>
    </MyToolLayout>
  );
}
