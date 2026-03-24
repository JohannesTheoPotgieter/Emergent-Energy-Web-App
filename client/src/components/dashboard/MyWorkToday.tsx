import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Link } from "wouter";

type WorkItem = { id: number; title: string; link: string; dueDate?: string };
export type MyWorkResponse = {
  overdueTasks: WorkItem[];
  dueTodayTasks: WorkItem[];
  upcomingTasks: WorkItem[];
  pendingApprovals: WorkItem[];
  recentMentions: WorkItem[];
  assignedProjects: WorkItem[];
  roleView?: string;
};

function ItemList({ title, items, tone }: { title: string; items: WorkItem[]; tone?: string }) {
  return (
    <div>
      <h4 className="text-sm font-semibold mb-2">{title}</h4>
      {items.length === 0 ? <p className="text-xs text-muted-foreground">No items</p> : (
        <div className="space-y-2">
          {items.map((item) => <Link key={item.id} href={item.link} className={`block text-sm hover:underline ${tone || ""}`}>{item.title}</Link>)}
        </div>
      )}
    </div>
  );
}

export function MyWorkToday({ data }: { data?: MyWorkResponse }) {
  const allCount = (data?.overdueTasks.length || 0) + (data?.dueTodayTasks.length || 0) + (data?.upcomingTasks.length || 0) + (data?.pendingApprovals.length || 0) + (data?.recentMentions.length || 0);
  if (!data || allCount === 0) {
    return <Card><CardContent className="p-6 text-center text-muted-foreground">You're all caught up!</CardContent></Card>;
  }

  return (
    <Card className="shadow-sm border-border">
      <CardContent className="p-6 grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold">My Work</h3>
            <Badge variant="outline">{data.roleView || "General"}</Badge>
          </div>
          <ItemList title="Overdue" items={data.overdueTasks} tone="text-red-600" />
          <ItemList title="Due Today" items={data.dueTodayTasks} tone="text-amber-600" />
          <ItemList title="Upcoming (7 days)" items={data.upcomingTasks} />
        </div>
        <div className="space-y-4">
          <ItemList title="Pending Approvals" items={data.pendingApprovals} />
          <ItemList title="Recent Mentions" items={data.recentMentions} />
          <ItemList title="Assigned Projects" items={data.assignedProjects} />
        </div>
      </CardContent>
    </Card>
  );
}
