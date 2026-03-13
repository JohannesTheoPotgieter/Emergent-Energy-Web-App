import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function DepartmentScoresPage() {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Department Scores</h1>
        <p className="text-sm text-slate-600">Department-level performance and scoring visibility for leadership review.</p>
      </div>
      <Card className="border-slate-200 shadow-sm">
        <CardHeader>
          <CardTitle className="text-base">Performance Snapshot</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-3">
          {[
            "Engineering Readiness",
            "Quality Compliance",
            "Delivery Discipline",
          ].map((metric) => (
            <div key={metric} className="rounded-lg border border-slate-200 p-3">
              <p className="text-sm font-medium">{metric}</p>
              <p className="text-xs text-slate-500 mt-1">Scorecards and trend context are surfaced here for rapid review.</p>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
