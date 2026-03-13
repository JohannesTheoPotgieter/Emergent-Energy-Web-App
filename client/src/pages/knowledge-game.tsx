import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function KnowledgeGamePage() {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Knowledge Game</h1>
        <p className="text-sm text-slate-600">Engagement zone for knowledge challenges, team participation, and continuous learning momentum.</p>
      </div>
      <Card className="border-slate-200 shadow-sm">
        <CardHeader>
          <CardTitle className="text-base">Game Arena</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-slate-700">
          <p>Track active rounds, challenge completion progress, and participation signals.</p>
          <p>Use this area to keep learning activity visible and aligned to operational priorities.</p>
        </CardContent>
      </Card>
    </div>
  );
}
