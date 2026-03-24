import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { FileText, FileSpreadsheet, BarChart3 } from "lucide-react";

export function ReportCard({ name, description, type, lastGenerated, onView, onGenerate, onDownload }: {
  name: string;
  description: string;
  type: "pdf" | "excel" | "chart";
  lastGenerated: string;
  onView?: () => void;
  onGenerate?: () => void;
  onDownload?: () => void;
}) {
  const Icon = type === "pdf" ? FileText : type === "excel" ? FileSpreadsheet : BarChart3;
  return (
    <Card className="border-border shadow-sm">
      <CardContent className="p-6 space-y-3">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-2"><Icon className="h-4 w-4 text-blue-500" /><h3 className="font-semibold">{name}</h3></div>
          <Badge variant="outline">{type.toUpperCase()}</Badge>
        </div>
        <p className="text-sm text-muted-foreground">{description}</p>
        <p className="text-xs text-muted-foreground">Last generated: {lastGenerated}</p>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={onGenerate}>Generate</Button>
          <Button size="sm" variant="outline" onClick={onDownload}>Download</Button>
          <Button size="sm" onClick={onView}>View</Button>
        </div>
      </CardContent>
    </Card>
  );
}
