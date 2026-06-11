/**
 * Finance source-cell provenance — READ-ONLY, NO NUMBERS.
 *
 * The drill-down's invoice leaves must link back to the tracker source cell
 * (sheet ▸ row ▸ column) for traceability. The canonical line-level
 * repository (`finance-line-level-repository.ts`) is FROZEN (§ 3B S10) and
 * does not expose the workbook provenance columns, so we read them here in a
 * separate, additive repository instead of touching the frozen file.
 *
 * This repository selects ONLY `source_sheet` / `source_row` / `source_cell`
 * — it never reads or derives an amount, a date, or a realisation flag, so it
 * cannot affect any REV / COS / GP / cash figure. The snapshot guard
 * (§ 3.1, `effective_to IS NULL`) is applied to both tables.
 */

import { and, inArray, isNull } from "drizzle-orm";
import { normalizedCostLineActuals, normalizedCostLines } from "@shared/schema";
import { db } from "../db";

export interface LineProvenance {
  sourceSheet: string | null;
  sourceRow: number | null;
  sourceCell: string | null;
}

export interface ProvenanceMaps {
  /** Keyed by `normalized_cost_line_actuals.id` (positive leaf ids). */
  byActualsId: Map<number, LineProvenance>;
  /** Keyed by `normalized_cost_lines.id` — fallback for synthesized leaves
   * (negative id = -parentId) and actuals rows with no own provenance. */
  byParentId: Map<number, LineProvenance>;
}

export class FinanceProvenanceRepository {
  private _dbInstance?: typeof db;

  constructor(dbInstance?: typeof db) {
    this._dbInstance = dbInstance;
  }

  private get dbInstance(): typeof db {
    return this._dbInstance || db;
  }

  async getProvenanceForProjects(projectIds: number[]): Promise<ProvenanceMaps> {
    const byActualsId = new Map<number, LineProvenance>();
    const byParentId = new Map<number, LineProvenance>();
    if (projectIds.length === 0) return { byActualsId, byParentId };

    const dbi = this.dbInstance;
    const [actualsRows, parentRows] = await Promise.all([
      dbi
        .select({
          id: normalizedCostLineActuals.id,
          sourceSheet: normalizedCostLineActuals.sourceSheet,
          sourceRow: normalizedCostLineActuals.sourceRow,
          sourceCell: normalizedCostLineActuals.sourceCell,
        })
        .from(normalizedCostLineActuals)
        .where(
          and(
            inArray(normalizedCostLineActuals.projectId, projectIds),
            isNull(normalizedCostLineActuals.effectiveTo),
            isNull(normalizedCostLineActuals.deletedAt),
          ),
        ),
      dbi
        .select({
          id: normalizedCostLines.id,
          sourceSheet: normalizedCostLines.sourceSheet,
          sourceRow: normalizedCostLines.sourceRow,
        })
        .from(normalizedCostLines)
        .where(
          and(
            inArray(normalizedCostLines.projectId, projectIds),
            isNull(normalizedCostLines.effectiveTo),
            isNull(normalizedCostLines.deletedAt),
          ),
        ),
    ]);

    for (const r of actualsRows) {
      byActualsId.set(r.id, {
        sourceSheet: r.sourceSheet ?? null,
        sourceRow: r.sourceRow ?? null,
        sourceCell: r.sourceCell ?? null,
      });
    }
    for (const r of parentRows) {
      byParentId.set(r.id, {
        sourceSheet: r.sourceSheet ?? null,
        sourceRow: r.sourceRow ?? null,
        sourceCell: null,
      });
    }
    return { byActualsId, byParentId };
  }
}

const EMPTY_PROVENANCE: LineProvenance = { sourceSheet: null, sourceRow: null, sourceCell: null };

/**
 * Resolve a leaf's provenance: prefer the actuals child's own cell; fall back
 * to the parent cost line. Synthesized leaves carry a negative `lineId`
 * (-parentId) and resolve directly against the parent map.
 */
export function resolveLeafProvenance(
  maps: ProvenanceMaps,
  lineId: number,
  parentLineId: number,
): LineProvenance {
  if (lineId > 0) {
    const own = maps.byActualsId.get(lineId);
    if (own && (own.sourceCell || own.sourceSheet || own.sourceRow != null)) return own;
  }
  return maps.byParentId.get(parentLineId) ?? EMPTY_PROVENANCE;
}
