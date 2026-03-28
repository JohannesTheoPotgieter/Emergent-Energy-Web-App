import React, { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { Check, X, Minus, GitCompareArrows } from "lucide-react";
import { ENTITY_PERMISSION_DEFAULTS } from "@shared/schema";
import type { RoleSummary } from "../settings-types";
import { ACTIONS, ENTITY_CATEGORIES, formatEntityName } from "../settings-types";

interface RoleComparisonDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  roles: RoleSummary[];
}

function getPermissionAllowed(entity: string, action: string, role: RoleSummary): boolean {
  const ep = (role.entityPermissions || {}) as Record<string, Record<string, boolean>>;
  const dbOverride = ep[entity]?.[action];
  if (typeof dbOverride === "boolean") return dbOverride;
  const defaultRule = ENTITY_PERMISSION_DEFAULTS.find((r) => r.entity === entity);
  if (defaultRule) {
    const roleList = (defaultRule as any)[`${action}_roles`] as string[] | undefined;
    if (roleList?.includes(role.role)) return true;
  }
  return false;
}

export function RoleComparisonDialog({ open, onOpenChange, roles }: RoleComparisonDialogProps) {
  const [roleA, setRoleA] = useState("");
  const [roleB, setRoleB] = useState("");
  const [showOnlyDifferences, setShowOnlyDifferences] = useState(true);

  const roleAData = roles.find((r) => r.role === roleA);
  const roleBData = roles.find((r) => r.role === roleB);

  const comparison = useMemo(() => {
    if (!roleAData || !roleBData) return null;

    const allEntities = Object.values(ENTITY_CATEGORIES).flatMap((c) => c.entities);
    let differences = 0;
    const rows: Array<{
      entity: string;
      category: string;
      actions: Array<{ action: string; a: boolean; b: boolean; diff: boolean }>;
      hasDiff: boolean;
    }> = [];

    for (const [catKey, cat] of Object.entries(ENTITY_CATEGORIES)) {
      for (const entity of cat.entities) {
        const actionResults = ACTIONS.map((action) => {
          const a = getPermissionAllowed(entity, action, roleAData);
          const b = getPermissionAllowed(entity, action, roleBData);
          const diff = a !== b;
          if (diff) differences++;
          return { action, a, b, diff };
        });
        const hasDiff = actionResults.some((ar) => ar.diff);
        rows.push({ entity, category: cat.label, actions: actionResults, hasDiff });
      }
    }

    // Navigation section differences
    const navDiffs: Array<{ section: string; a: boolean; b: boolean }> = [];
    const allSections = new Set([...(roleAData.sections || []), ...(roleBData.sections || [])]);
    allSections.forEach((s) => {
      const a = (roleAData.sections || []).includes(s);
      const b = (roleBData.sections || []).includes(s);
      if (a !== b) navDiffs.push({ section: s, a, b });
    });

    return { rows, differences, navDiffs };
  }, [roleAData, roleBData]);

  const filteredRows = comparison?.rows.filter((r) => !showOnlyDifferences || r.hasDiff) || [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-4xl max-h-[85vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <GitCompareArrows className="h-5 w-5 text-violet-600" />
            Compare Roles
          </DialogTitle>
        </DialogHeader>

        <div className="flex gap-4 py-2">
          <div className="flex-1">
            <span className="text-xs font-medium text-gray-600 block mb-1">Role A</span>
            <SearchableSelect
              options={roles.map((r) => ({ value: r.role, label: r.label }))}
              value={roleA}
              onValueChange={setRoleA}
              placeholder="Select first role..."
            />
          </div>
          <div className="flex-1">
            <span className="text-xs font-medium text-gray-600 block mb-1">Role B</span>
            <SearchableSelect
              options={roles.filter((r) => r.role !== roleA).map((r) => ({ value: r.role, label: r.label }))}
              value={roleB}
              onValueChange={setRoleB}
              placeholder="Select second role..."
            />
          </div>
        </div>

        {comparison && (
          <>
            <div className="flex items-center justify-between py-2 border-t border-gray-200">
              <div className="flex items-center gap-3">
                <Badge variant={comparison.differences > 0 ? "default" : "secondary"} className={comparison.differences > 0 ? "bg-amber-100 text-amber-700 border-amber-200" : ""}>
                  {comparison.differences} permission difference{comparison.differences !== 1 ? "s" : ""}
                </Badge>
                {comparison.navDiffs.length > 0 && (
                  <Badge variant="secondary" className="bg-blue-100 text-blue-700 border-blue-200">
                    {comparison.navDiffs.length} nav difference{comparison.navDiffs.length !== 1 ? "s" : ""}
                  </Badge>
                )}
              </div>
              <label className="flex items-center gap-2 text-xs cursor-pointer">
                <input type="checkbox" checked={showOnlyDifferences} onChange={(e) => setShowOnlyDifferences(e.target.checked)} className="h-3.5 w-3.5 rounded text-violet-600" />
                Show only differences
              </label>
            </div>

            {/* Navigation Differences */}
            {comparison.navDiffs.length > 0 && (
              <div className="rounded-lg border border-blue-200 bg-blue-50/50 p-3 mb-2">
                <h4 className="text-xs font-semibold text-blue-800 mb-2">Navigation Section Differences</h4>
                <div className="flex flex-wrap gap-2">
                  {comparison.navDiffs.map((nd) => (
                    <div key={nd.section} className="flex items-center gap-1.5 text-xs bg-white rounded-md border border-blue-200 px-2 py-1">
                      <code className="text-[10px] font-mono text-gray-600">{nd.section}</code>
                      <span className={nd.a ? "text-emerald-600" : "text-red-500"}>{roleAData?.label}: {nd.a ? "Yes" : "No"}</span>
                      <Minus className="h-2.5 w-2.5 text-gray-400" />
                      <span className={nd.b ? "text-emerald-600" : "text-red-500"}>{roleBData?.label}: {nd.b ? "Yes" : "No"}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Permission Matrix Comparison */}
            <div className="border border-gray-200 rounded-lg overflow-auto flex-1">
              <table className="w-full text-sm">
                <thead className="sticky top-0 z-10 bg-gray-50">
                  <tr className="border-b border-gray-200">
                    <th className="text-left px-3 py-2 text-xs font-semibold text-gray-600 w-[180px]">Entity</th>
                    {ACTIONS.map((a) => (
                      <th key={a} colSpan={2} className="text-center px-1 py-2 text-xs font-semibold text-gray-600 capitalize border-l border-gray-200">
                        {a}
                      </th>
                    ))}
                  </tr>
                  <tr className="border-b border-gray-200 bg-gray-50">
                    <th />
                    {ACTIONS.map((a) => (
                      <React.Fragment key={a}>
                        <th className="text-center px-0.5 py-1 text-[9px] text-gray-400 border-l border-gray-200 w-8">{roleAData?.label?.slice(0, 4)}</th>
                        <th className="text-center px-0.5 py-1 text-[9px] text-gray-400 w-8">{roleBData?.label?.slice(0, 4)}</th>
                      </React.Fragment>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filteredRows.length === 0 && (
                    <tr><td colSpan={ACTIONS.length * 2 + 1} className="text-center py-8 text-sm text-muted-foreground">
                      {showOnlyDifferences ? "No differences found between these roles" : "Select two roles to compare"}
                    </td></tr>
                  )}
                  {filteredRows.map((row) => (
                    <tr key={row.entity} className={`border-t border-gray-100 ${row.hasDiff ? "bg-amber-50/30" : ""}`}>
                      <td className="px-3 py-1.5 text-xs font-medium text-gray-800">{formatEntityName(row.entity)}</td>
                      {row.actions.map((ar) => (
                        <React.Fragment key={ar.action}>
                          <td className={`text-center px-0.5 py-1.5 border-l border-gray-200 ${ar.diff ? "bg-amber-100/50" : ""}`}>
                            {ar.a ? <Check className="h-3 w-3 text-emerald-600 mx-auto" /> : <X className="h-3 w-3 text-gray-300 mx-auto" />}
                          </td>
                          <td className={`text-center px-0.5 py-1.5 ${ar.diff ? "bg-amber-100/50" : ""}`}>
                            {ar.b ? <Check className="h-3 w-3 text-emerald-600 mx-auto" /> : <X className="h-3 w-3 text-gray-300 mx-auto" />}
                          </td>
                        </React.Fragment>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}

        {!comparison && (
          <div className="text-center py-12 text-muted-foreground text-sm">
            Select two roles above to compare their permissions side by side.
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
