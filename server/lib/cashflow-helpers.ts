/**
 * Shared helper functions for cashflow and financial route calculations.
 * Extracted from server/routes.ts to enable reuse across domain route modules.
 */

/**
 * Check whether a date field is "confirmed" (black font = confirmed, red = unconfirmed).
 */
export function isDateConfirmedCheck(
  confirmed: boolean | null | undefined,
  fontColor: string | null | undefined
): boolean {
  if (fontColor === 'red') return false;
  if (fontColor === 'black') return true;
  if (confirmed === true) return true;
  return false;
}

/**
 * Merge legacy expense and inflow arrays.
 * Currently a passthrough — kept as a seam for future enrichment logic.
 */
export async function getMergedExpensesAndInflows(
  expenses: any[],
  inflows: any[]
): Promise<{ expenses: any[]; inflows: any[] }> {
  return { expenses, inflows };
}

/**
 * Resolve effective dates for all inflows by applying the Revenue tab date hierarchy:
 *   1. adminDateOverride (manual override from admin)
 *   2. paymentReceivedDate (actual bank receipt — never overridden)
 *   3. dateOverride from milestone_task_links (manual override)
 *   4. Linked operational/plan task dueDate
 *   5. Canonical computed forecast date (computedForecastReceiptDate)
 *   6. Legacy fallback planned date (plannedPaymentDate)
 *
 * NOTE: plannedPaymentDate is retained only as a hybrid compatibility fallback
 * while older imports are normalized. Do not remove without migration proof that
 * computedForecastReceiptDate is backfilled for all active revenue lines.
 */
export function resolveInflowEffectiveDates(
  inflows: any[],
  taskLinks: any[],
  operationalTasks: any[],
  planTasks: any[]
): any[] {
  const normalizeProjectName = (value: unknown): string => String(value || "").trim().toLowerCase();

  if (taskLinks.length === 0) {
    return inflows.map(inf => ({
      ...inf,
      effectiveDate: inf.adminDateOverride || inf.paymentReceivedDate || inf.computedForecastReceiptDate || inf.plannedPaymentDate || null,
    }));
  }

  const linkMap = new Map<string, any>();
  const normalizedLinkMap = new Map<string, any>();
  const linksByRowNumber = new Map<number, any[]>();
  for (const link of taskLinks) {
    linkMap.set(`${link.projectName}::${link.milestoneRowNumber}`, link);
    normalizedLinkMap.set(`${normalizeProjectName(link.projectName)}::${link.milestoneRowNumber}`, link);
    const rowNumber = Number(link.milestoneRowNumber);
    if (Number.isFinite(rowNumber)) {
      const existing = linksByRowNumber.get(rowNumber) || [];
      existing.push(link);
      linksByRowNumber.set(rowNumber, existing);
    }
  }

  const opTaskMap = new Map<number, any>();
  for (const t of operationalTasks) {
    opTaskMap.set(t.id, t);
  }

  const planTaskMap = new Map<number, any>();
  for (const t of planTasks) {
    planTaskMap.set(t.id, t);
  }

  return inflows.map(inf => {
    // Admin date override takes highest priority
    if (inf.adminDateOverride && /^\d{4}-\d{2}-\d{2}/.test(inf.adminDateOverride)) {
      return { ...inf, effectiveDate: inf.adminDateOverride };
    }

    const key = `${inf.projectName}::${inf.rowNumber}`;
    const normalizedKey = `${normalizeProjectName(inf.projectName)}::${inf.rowNumber}`;
    const link =
      linkMap.get(key) ||
      normalizedLinkMap.get(normalizedKey) ||
      (() => {
        const sameRowLinks = linksByRowNumber.get(Number(inf.rowNumber)) || [];
        return sameRowLinks.length === 1 ? sameRowLinks[0] : null;
      })();

    if (inf.paymentReceivedDate && /^\d{4}-\d{2}-\d{2}/.test(inf.paymentReceivedDate)) {
      return { ...inf, effectiveDate: inf.paymentReceivedDate };
    }

    if (link) {
      if (link.dateOverride && /^\d{4}-\d{2}-\d{2}/.test(link.dateOverride)) {
        return { ...inf, effectiveDate: link.dateOverride };
      }

      const taskId = link.taskId;
      if (taskId > 0) {
        const opTask = opTaskMap.get(taskId);
        if (opTask?.dueDate && /^\d{4}-\d{2}-\d{2}/.test(opTask.dueDate)) {
          return { ...inf, effectiveDate: opTask.dueDate };
        }
      } else if (taskId < 0) {
        const planTask = planTaskMap.get(Math.abs(taskId));
        const dueDate = (planTask as any)?.actualEnd || (planTask as any)?.baselineEnd || null;
        if (dueDate && /^\d{4}-\d{2}-\d{2}/.test(dueDate)) {
          return { ...inf, effectiveDate: dueDate };
        }
      }
    }

    return {
      ...inf,
      effectiveDate: inf.computedForecastReceiptDate || inf.plannedPaymentDate || null,
    };
  });
}
