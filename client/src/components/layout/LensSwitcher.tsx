/**
 * COO Lens Switcher — allows COO super admin to switch lens views.
 *
 * Visible only to users whose DB role maps to COO_SUPER_ADMIN lens.
 * Provides read-only simulation and full-power view modes.
 */

import { useState } from "react";
import { useLensContext } from "@/hooks/use-lens-context";
import { LENS_ROLE_LABELS, type LensRole } from "@shared/schema/role-based-upgrade";
import { Eye, EyeOff, ChevronDown, Shield, User } from "lucide-react";

export function LensSwitcher() {
  const {
    naturalLens,
    activeLens,
    activeLensLabel,
    isCooSuperAdmin,
    simulation,
    startSimulation,
    stopSimulation,
    availableLenses,
  } = useLensContext();

  const [isOpen, setIsOpen] = useState(false);

  if (!isCooSuperAdmin) return null;

  const isSimulating = simulation !== null;

  return (
    <div className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={`
          flex items-center gap-2 px-3 py-1.5 rounded-md text-xs font-medium
          transition-colors border
          ${isSimulating
            ? "bg-amber-50 border-amber-300 text-amber-800 dark:bg-amber-900/30 dark:border-amber-600 dark:text-amber-200"
            : "bg-emerald-50 border-emerald-300 text-emerald-800 dark:bg-emerald-900/30 dark:border-emerald-600 dark:text-emerald-200"
          }
        `}
      >
        {isSimulating ? <Eye className="h-3.5 w-3.5" /> : <Shield className="h-3.5 w-3.5" />}
        <span className="hidden sm:inline">
          {isSimulating ? `Viewing as: ${activeLensLabel}` : "Super Admin"}
        </span>
        <ChevronDown className="h-3 w-3" />
      </button>

      {isOpen && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setIsOpen(false)} />
          <div className="absolute right-0 top-full mt-1 z-50 w-72 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg overflow-hidden">
            <div className="p-3 border-b border-gray-100 dark:border-gray-700">
              <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Lens Switcher</p>
              <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">Simulate another role's view</p>
            </div>

            {isSimulating && (
              <button
                onClick={() => { stopSimulation(); setIsOpen(false); }}
                className="w-full flex items-center gap-2 px-3 py-2 text-sm text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-900/20 hover:bg-amber-100 dark:hover:bg-amber-900/30 border-b border-gray-100 dark:border-gray-700"
              >
                <EyeOff className="h-4 w-4" />
                <span>Exit Simulation — Return to COO</span>
              </button>
            )}

            <div className="max-h-64 overflow-y-auto">
              {availableLenses.map((lens) => {
                const isActive = activeLens === lens;
                const isNatural = naturalLens === lens;
                return (
                  <button
                    key={lens}
                    onClick={() => {
                      if (isNatural) {
                        stopSimulation();
                      } else {
                        startSimulation(lens, "read_only");
                      }
                      setIsOpen(false);
                    }}
                    className={`
                      w-full flex items-center gap-2 px-3 py-2 text-sm text-left
                      hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors
                      ${isActive ? "bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-300" : "text-gray-700 dark:text-gray-300"}
                    `}
                  >
                    <User className="h-3.5 w-3.5 flex-shrink-0" />
                    <span className="flex-1">{LENS_ROLE_LABELS[lens]}</span>
                    {isNatural && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-100 dark:bg-emerald-800 text-emerald-700 dark:text-emerald-300">
                        You
                      </span>
                    )}
                    {isActive && !isNatural && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-100 dark:bg-amber-800 text-amber-700 dark:text-amber-300">
                        Active
                      </span>
                    )}
                  </button>
                );
              })}
            </div>

            {isSimulating && (
              <div className="p-3 border-t border-gray-100 dark:border-gray-700">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-gray-500 dark:text-gray-400">Mode:</span>
                  <button
                    onClick={() => {
                      startSimulation(
                        simulation!.simulatedLens,
                        simulation!.mode === "read_only" ? "full_power" : "read_only",
                      );
                    }}
                    className={`
                      text-xs px-2 py-1 rounded border transition-colors
                      ${simulation?.mode === "read_only"
                        ? "bg-blue-50 border-blue-200 text-blue-700 dark:bg-blue-900/20 dark:border-blue-700 dark:text-blue-300"
                        : "bg-red-50 border-red-200 text-red-700 dark:bg-red-900/20 dark:border-red-700 dark:text-red-300"
                      }
                    `}
                  >
                    {simulation?.mode === "read_only" ? "Read-Only" : "Full Power"}
                  </button>
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
