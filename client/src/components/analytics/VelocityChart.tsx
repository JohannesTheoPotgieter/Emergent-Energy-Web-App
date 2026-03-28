import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine } from "recharts";

export function VelocityChart({ data, average }: { data: Array<{ week: string; completed: number }>; average: number }) {
  return <div className="h-64"><ResponsiveContainer width="100%" height="100%"><LineChart data={data}><XAxis dataKey="week" /><YAxis /><Tooltip /><ReferenceLine y={average} stroke="#94a3b8" strokeDasharray="4 4" /><Line dataKey="completed" stroke="#22c55e" /><Line dataKey="trend" stroke="#3b82f6" /></LineChart></ResponsiveContainer></div>;
}
