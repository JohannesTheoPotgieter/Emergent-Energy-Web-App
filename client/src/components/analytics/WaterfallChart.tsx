import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from "recharts";

export function WaterfallChart({ data }: { data: Array<{ name: string; value: number; type: string }> }) {
  return <div className="h-64"><ResponsiveContainer width="100%" height="100%"><BarChart data={data}><XAxis dataKey="name" /><YAxis /><Tooltip /><Bar dataKey="value">{data.map((d, i) => <Cell key={i} fill={d.type === "actual" ? "#ef4444" : d.type === "remaining" ? "#22c55e" : "#2563eb"} />)}</Bar></BarChart></ResponsiveContainer></div>;
}
