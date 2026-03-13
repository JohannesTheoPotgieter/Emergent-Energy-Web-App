import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export default function TrainingPage() {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Training</h1>
        <p className="text-sm text-slate-600">Learning modules, walkthroughs, and onboarding resources for operational excellence.</p>
      </div>
      <Card className="border-slate-200 shadow-sm">
        <CardHeader>
          <CardTitle className="text-base">Learning Space</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-lg border border-slate-200 p-3">
            <p className="text-sm font-medium">Core Modules</p>
            <p className="text-xs text-slate-500 mt-1">Process fundamentals, role-specific standards, and compliance refreshers.</p>
          </div>
          <div className="rounded-lg border border-slate-200 p-3">
            <p className="text-sm font-medium">Interactive Walkthroughs</p>
            <p className="text-xs text-slate-500 mt-1">Guided product tours and practical checklists for day-to-day workflows.</p>
          </div>
        </CardContent>
      </Card>
      <Badge className="bg-emerald-100 text-emerald-700">Knowledge Section</Badge>
    </div>
  );
}
