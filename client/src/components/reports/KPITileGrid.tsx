import { Card, CardContent } from "@/components/ui/card";

export interface KPITile {
  label: string;
  value: string | number;
  color?: "green" | "red" | "amber" | "default";
}

export default function KPITileGrid({ tiles }: { tiles: KPITile[] }) {
  const colorClasses: Record<string, string> = {
    green: "bg-emerald-700 text-white",
    red: "bg-red-600 text-white",
    amber: "bg-amber-500 text-white",
    default: "bg-emerald-700 text-white",
  };

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3" role="list" aria-label="Key Performance Indicators">
      {tiles.map((tile, i) => (
        <Card key={i} className={`${colorClasses[tile.color || "default"]} border-0`} role="listitem" aria-label={`${tile.label}: ${tile.value}`}>
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-bold leading-tight" aria-hidden="true">{tile.value}</p>
            <p className="text-xs mt-1 opacity-90" aria-hidden="true">{tile.label}</p>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
