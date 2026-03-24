import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

async function api(url: string) {
  const token = localStorage.getItem("auth_token");
  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(url, { headers, credentials: "include" });
  return res.json();
}

export default function NcrListPage() {
  const [status, setStatus] = useState("open");
  const [severity, setSeverity] = useState("");
  const { data } = useQuery<{ items: any[] }>({ queryKey: ["ncr-list", status, severity], queryFn: () => api(`/api/quality/ncrs?status=${status}${severity ? `&severity=${severity}` : ""}`) });

  return <div className="p-4 md:p-6 space-y-4"><h1 className="text-2xl font-semibold">NCR List</h1>
    <Card><CardHeader><CardTitle>Filters</CardTitle></CardHeader><CardContent className="grid md:grid-cols-2 grid-cols-1 gap-3">
      <div><Label>Status</Label><Input value={status} onChange={(e) => setStatus(e.target.value)} /></div>
      <div><Label>Severity</Label><Input value={severity} onChange={(e) => setSeverity(e.target.value)} placeholder="critical" /></div>
    </CardContent></Card>
    <Card><CardContent className="pt-4 space-y-2">{(data?.items || []).map((row) => <div key={row.id} className="border rounded p-2 text-sm"><div className="font-medium">{row.title}</div><div>{row.status} • {row.severity} • {row.age_days} days • {row.assignee_name || "Unassigned"}</div></div>)}</CardContent></Card>
  </div>;
}
