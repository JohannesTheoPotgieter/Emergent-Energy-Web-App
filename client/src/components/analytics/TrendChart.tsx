import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";

export function TrendChart({ data, color = "#10b981", xKey = "label", yKey = "value" }: { data: any[]; color?: string; xKey?: string; yKey?: string }) {
  return <div className="h-64"><ResponsiveContainer width="100%" height="100%"><AreaChart data={data}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey={xKey} /><YAxis /><Tooltip /><Area dataKey={yKey} stroke={color} fill={color} fillOpacity={0.2} /></AreaChart></ResponsiveContainer></div>;
}
