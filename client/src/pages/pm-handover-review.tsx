import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";

export default function PmHandoverReviewPage() {
  const { data } = useQuery<{ items: any[] }>({
    queryKey: ["pm-handover-review"],
    queryFn: async () => {
      const res = await fetch("/api/pd-pm-handover/submitted", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load handover queue");
      return res.json();
    },
  });

  return (
    <div className="space-y-3">
      <h1 className="text-2xl font-semibold">PM Handover Review Queue</h1>
      {(data?.items || []).map((i) => (
        <div key={i.project_id} className="border rounded p-3 flex items-center justify-between">
          <div>
            <p className="font-medium">{i.project_name}</p>
            <p className="text-xs text-muted-foreground">Status: {i.status} · PD: {i.pd || "—"} · PM: {i.pm || "—"}</p>
          </div>
          <Link href={`/pd/handover/${i.project_id}`} className="text-blue-600 underline">Review handover</Link>
        </div>
      ))}
    </div>
  );
}
