import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRoute } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

async function api(url: string, options?: RequestInit) {
  const token = localStorage.getItem("auth_token");
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(url, { ...options, headers, credentials: "include" });
  return res.json();
}

export default function NcrDetailPage() {
  const [, params] = useRoute("/quality/ncr/:id");
  const id = Number(params?.id || 0);
  const [comment, setComment] = useState("");
  const queryClient = useQueryClient();
  const { data } = useQuery({ queryKey: ["ncr-detail", id], queryFn: () => api(`/api/quality/ncrs/${id}`), enabled: !!id });
  const addComment = useMutation({ mutationFn: () => api(`/api/quality/ncrs/${id}/comments`, { method: "POST", body: JSON.stringify({ comment }) }), onSuccess: () => { setComment(""); queryClient.invalidateQueries({ queryKey: ["ncr-detail", id] }); } });
  const transition = useMutation({ mutationFn: (status: string) => api(`/api/quality/ncrs/${id}`, { method: "PUT", body: JSON.stringify({ status }) }), onSuccess: () => queryClient.invalidateQueries({ queryKey: ["ncr-detail", id] }) });

  return <div className="p-4 md:p-6 space-y-4"><h1 className="text-2xl font-semibold">NCR Detail</h1>
    <Card><CardHeader><CardTitle>{data?.ncr?.title || "Loading..."}</CardTitle></CardHeader><CardContent className="space-y-2 text-sm">
      <div>Status: {data?.ncr?.status}</div><div>Severity: {data?.ncr?.severity}</div><div>Description: {data?.ncr?.description}</div>
      <div className="flex gap-2"><Button size="sm" onClick={() => transition.mutate("investigating")}>Investigating</Button><Button size="sm" variant="outline" onClick={() => transition.mutate("corrective_action")}>Corrective</Button><Button size="sm" variant="outline" onClick={() => transition.mutate("verification")}>Verification</Button><Button size="sm" variant="outline" onClick={() => transition.mutate("closed")}>Close</Button></div>
    </CardContent></Card>
    <Card><CardHeader><CardTitle>Comments</CardTitle></CardHeader><CardContent className="space-y-2">
      {(data?.comments || []).map((c: any) => <div key={c.id} className="border rounded p-2 text-sm"><strong>{c.user_name || c.user_id}:</strong> {c.comment}</div>)}
      <Textarea value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Add comment" />
      <Button onClick={() => addComment.mutate()}>Post Comment</Button>
    </CardContent></Card>
  </div>;
}
