import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, ChevronUp, Database, Clock, AlertTriangle, Server, Table2, Bug } from "lucide-react";

interface DataSourceInfo {
  endpoint: string;
  tables: string[];
  description?: string;
}

interface DataSourceDebugProps {
  pageName: string;
  dataSources: DataSourceInfo[];
}

function StaleWarning({ lastImport }: { lastImport: string | null }) {
  if (!lastImport) return <span className="text-amber-500 text-[10px]">No import recorded</span>;
  const importDate = new Date(lastImport);
  const daysSince = Math.floor((Date.now() - importDate.getTime()) / (1000 * 60 * 60 * 24));
  const isStale = daysSince > 14;
  return (
    <span className={`text-[10px] ${isStale ? "text-red-500 font-semibold" : "text-emerald-600"}`}>
      {isStale && <AlertTriangle className="inline h-3 w-3 mr-0.5" />}
      {daysSince}d ago {isStale ? "(STALE)" : ""}
    </span>
  );
}

export default function DataSourceDebug({ pageName, dataSources }: DataSourceDebugProps) {
  const [open, setOpen] = useState(false);

  if (import.meta.env.PROD) return null;

  const { data: importMeta } = useQuery<{ lastImportAt: string | null; importCount: number }>({
    queryKey: ["/api/smart-import/runs"],
    queryFn: async () => {
      const token = localStorage.getItem("auth_token");
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (token) headers["Authorization"] = `Bearer ${token}`;
      const res = await fetch("/api/smart-import/runs", { headers, credentials: "include" });
      if (!res.ok) return { lastImportAt: null, importCount: 0 };
      const data = await res.json();
      const runs = Array.isArray(data) ? data : data?.runs || [];
      const lastRun = runs.length > 0 ? runs[0] : null;
      return {
        lastImportAt: lastRun?.createdAt || lastRun?.created_at || null,
        importCount: runs.length,
      };
    },
    staleTime: 60_000,
  });

  return (
    <div
      className="fixed bottom-2 right-2 z-[9999] max-w-sm"
      data-testid="debug-panel"
    >
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-gray-900 text-gray-100 text-[11px] font-mono shadow-lg hover:bg-gray-800 transition-colors border border-gray-700"
        data-testid="debug-panel-toggle"
      >
        <Bug className="h-3.5 w-3.5 text-amber-400" />
        <span>Debug: {pageName}</span>
        {open ? <ChevronDown className="h-3 w-3" /> : <ChevronUp className="h-3 w-3" />}
      </button>

      {open && (
        <div className="mt-1 rounded-lg bg-gray-900 text-gray-200 border border-gray-700 shadow-2xl overflow-hidden font-mono text-[11px] max-h-[60vh] overflow-y-auto" data-testid="debug-panel-content">
          <div className="px-3 py-2 border-b border-gray-700 flex items-center gap-2">
            <Database className="h-3.5 w-3.5 text-blue-400" />
            <span className="font-semibold text-blue-300">Data Sources</span>
          </div>

          <div className="px-3 py-2 border-b border-gray-700 space-y-1">
            <div className="flex items-center gap-1.5 text-gray-400">
              <Clock className="h-3 w-3" />
              <span>Last Import:</span>
              <StaleWarning lastImport={importMeta?.lastImportAt || null} />
            </div>
            <div className="flex items-center gap-1.5 text-gray-400">
              <Server className="h-3 w-3" />
              <span>Total Import Runs: {importMeta?.importCount ?? "—"}</span>
            </div>
          </div>

          <div className="divide-y divide-gray-800">
            {dataSources.map((ds, i) => (
              <div key={i} className="px-3 py-2 space-y-1 hover:bg-gray-800/50">
                <div className="flex items-start gap-1.5">
                  <Server className="h-3 w-3 text-emerald-400 mt-0.5 shrink-0" />
                  <div>
                    <code className="text-emerald-300 break-all">{ds.endpoint}</code>
                    {ds.description && (
                      <p className="text-muted-foreground text-[10px] mt-0.5">{ds.description}</p>
                    )}
                  </div>
                </div>
                <div className="flex items-start gap-1.5 ml-4">
                  <Table2 className="h-3 w-3 text-violet-400 mt-0.5 shrink-0" />
                  <div className="flex flex-wrap gap-1">
                    {ds.tables.map((t) => (
                      <span key={t} className="px-1.5 py-0.5 rounded bg-violet-900/40 text-violet-300 text-[10px]">
                        {t}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
