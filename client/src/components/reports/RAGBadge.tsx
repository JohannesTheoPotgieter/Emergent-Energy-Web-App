import { Badge } from "@/components/ui/badge";

export default function RAGBadge({ status }: { status: string | null }) {
  if (!status) return <span className="text-muted-foreground">—</span>;

  const upper = status.toUpperCase();
  const colors: Record<string, string> = {
    RED: "text-red-700 border-red-200 bg-red-50",
    AMBER: "text-amber-700 border-amber-200 bg-amber-50",
    GREEN: "text-emerald-700 border-emerald-200 bg-emerald-50",
  };

  return (
    <Badge variant="outline" className={`text-[10px] ${colors[upper] || "text-slate-500"}`}>
      {status}
    </Badge>
  );
}
