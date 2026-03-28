import { Treemap, ResponsiveContainer, Tooltip } from "recharts";

export function PortfolioHeatmap({ data, onSelect }: { data: Array<{ id: number; name: string; rag: string; budget: number }>; onSelect?: (id: number) => void }) {
  return (
    <div className="h-72 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <Treemap
          data={data.map((d) => ({ ...d, size: Math.max(1, Number(d.budget || 1)) }))}
          dataKey="size"
          stroke="#fff"
          fill="#10b981"
          content={({ root, depth, x, y, width, height, index, payload, colors }: any) => {
            if (depth !== 1) return null;
            const rag = payload?.rag || "Amber";
            const fill = rag.toLowerCase().includes("red") ? "#ef4444" : rag.toLowerCase().includes("green") ? "#22c55e" : "#f59e0b";
            return <g onClick={() => payload?.id && onSelect?.(payload.id)}><rect x={x} y={y} width={width} height={height} fill={fill} stroke="#fff" /><text x={x + 6} y={y + 16} fontSize={12} fill="#fff">{payload?.name}</text></g>;
          }}
        >
          <Tooltip />
        </Treemap>
      </ResponsiveContainer>
    </div>
  );
}
