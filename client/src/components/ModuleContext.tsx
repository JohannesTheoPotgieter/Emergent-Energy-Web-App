import { useState } from "react";
import { Info, ArrowRight, ChevronDown, ChevronUp } from "lucide-react";

interface ModuleConfig {
  purpose: string;
  upstream: string[];
  downstream: string[];
}

const MODULE_DATA: Record<string, ModuleConfig> = {
  procurement: {
    purpose: "Commercial execution hub — track needs, orders, deliveries, and invoices",
    upstream: ["Plan Tasks"],
    downstream: ["Expenditure", "COS", "GP"],
  },
  expenditure: {
    purpose: "Track all project expenses against budget",
    upstream: ["Procurement", "Invoices"],
    downstream: ["COS", "GP", "Cashflow"],
  },
  "task-grid": {
    purpose: "Plan and schedule project work with WBS structure",
    upstream: [],
    downstream: ["Procurement", "RAID"],
  },
  raid: {
    purpose: "Track risks, assumptions, issues, and decisions",
    upstream: ["Plan", "Procurement"],
    downstream: ["Changes"],
  },
  "change-control": {
    purpose: "Manage scope, cost, and schedule changes",
    upstream: ["RAID", "Procurement"],
    downstream: ["Plan", "Budget"],
  },
  commissioning: {
    purpose: "Track system commissioning and project closeout",
    upstream: ["Procurement", "Plan"],
    downstream: ["Handover"],
  },
  "revenue-tracking": {
    purpose: "Track project revenue inflows",
    upstream: ["Contracts"],
    downstream: ["GP", "Cashflow"],
  },
  cashflow: {
    purpose: "Monitor project cash position over time",
    upstream: ["Revenue", "Expenditure"],
    downstream: [],
  },
};

interface ModuleContextProps {
  module: string;
  projectId: number;
  counts?: Record<string, number>;
}

export function ModuleContext({ module, projectId, counts }: ModuleContextProps) {
  const [expanded, setExpanded] = useState(false);
  const config = MODULE_DATA[module];

  if (!config) return null;

  const countEntries = counts ? Object.entries(counts).filter(([, v]) => v > 0) : [];

  return (
    <div className="relative mb-2" data-testid={`module-context-${module}`}>
      {!expanded && (
        <div className="flex justify-end">
          <button
            onClick={() => setExpanded(true)}
            className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] text-emerald-600 hover:bg-emerald-50 transition-colors"
            data-testid={`module-context-toggle-${module}`}
            title="Show module context"
          >
            <Info className="h-3 w-3" />
          </button>
        </div>
      )}

      <div
        className={`overflow-hidden transition-all duration-200 ease-in-out ${expanded ? "max-h-40 opacity-100" : "max-h-0 opacity-0"}`}
      >
        <div className="bg-emerald-50/50 border border-emerald-100 rounded-lg px-3 py-2" data-testid={`module-context-panel-${module}`}>
          <div className="flex items-start justify-between gap-2">
            <div className="flex-1 min-w-0 space-y-1.5">
              <p className="text-xs text-gray-700" data-testid={`module-context-purpose-${module}`}>
                {config.purpose}
              </p>

              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                {config.upstream.length > 0 && (
                  <div className="flex items-center gap-1 text-[10px] text-gray-500" data-testid={`module-context-upstream-${module}`}>
                    <span className="font-medium text-gray-600">From:</span>
                    {config.upstream.map((u, i) => (
                      <span key={u} className="flex items-center gap-0.5">
                        <span className="bg-white border border-emerald-200 rounded px-1 py-px text-emerald-700">{u}</span>
                        {i < config.upstream.length - 1 && <span className="text-gray-400">,</span>}
                      </span>
                    ))}
                    <ArrowRight className="h-2.5 w-2.5 text-emerald-400" />
                    <span className="font-semibold text-emerald-700">This</span>
                  </div>
                )}

                {config.downstream.length > 0 && (
                  <div className="flex items-center gap-1 text-[10px] text-gray-500" data-testid={`module-context-downstream-${module}`}>
                    <span className="font-semibold text-emerald-700">This</span>
                    <ArrowRight className="h-2.5 w-2.5 text-emerald-400" />
                    <span className="font-medium text-gray-600">To:</span>
                    {config.downstream.map((d, i) => (
                      <span key={d} className="flex items-center gap-0.5">
                        <span className="bg-white border border-emerald-200 rounded px-1 py-px text-emerald-700">{d}</span>
                        {i < config.downstream.length - 1 && <span className="text-gray-400">,</span>}
                      </span>
                    ))}
                  </div>
                )}

                {countEntries.length > 0 && (
                  <div className="flex items-center gap-1.5" data-testid={`module-context-counts-${module}`}>
                    {countEntries.map(([label, value]) => (
                      <span key={label} className="bg-emerald-100 text-emerald-700 text-[10px] font-medium rounded px-1.5 py-px">
                        {value} {label}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <button
              onClick={() => setExpanded(false)}
              className="shrink-0 p-0.5 rounded hover:bg-emerald-100 text-emerald-500 transition-colors"
              data-testid={`module-context-collapse-${module}`}
              title="Hide context"
            >
              <ChevronUp className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
