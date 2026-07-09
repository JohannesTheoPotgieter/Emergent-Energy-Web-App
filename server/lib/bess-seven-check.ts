/**
 * BESS 7-check commissioning checklist (pure definitions + sign-off rules).
 *
 * Every hybrid / battery-energy-storage (BESS) job runs a mandatory BESS
 * 7-check at commissioning. Each check is a `commissioning_items` row
 * (itemType `bess_commissioning`, category `BESS 7-Check`) so it flows
 * through the existing commissioning status machine + evidence engine.
 *
 * Sign-off chain: the Engineering Lead signs each item off (the item reaches
 * `approved` via the normal review/approval flow); the Construction Manager
 * countersigns (`countersigned_by_user_id`) before the item may close; the
 * COO is notified when an item closes. All 7 must close for the checklist to
 * be complete.
 *
 * Gating: seeded only for projects flagged `project_info.is_bess_hybrid`.
 */

export const BESS_ITEM_TYPE = "bess_commissioning";
export const BESS_CATEGORY = "BESS 7-Check";

export interface BessCheckDefinition {
  key: string;
  title: string;
  description: string;
}

/** The seven mandatory checks, in order. */
export const BESS_SEVEN_CHECKS: BessCheckDefinition[] = [
  {
    key: "motorised_breaker_soc",
    title: "1. Motorised-breaker SOC threshold on Eskom-fail",
    description:
      "Confirm the motorised breaker trips/holds against the correct battery state-of-charge threshold when Eskom fails.",
  },
  {
    key: "eskom_fail_alarm_direct",
    title: "2. Alarm on Eskom-fail configured directly (not SOC-derived)",
    description:
      "Confirm the Eskom-fail alarm is driven directly from the grid-fail signal, not inferred from state-of-charge.",
  },
  {
    key: "battery_charge_rate_setpoint",
    title: "3. Battery charge-rate setpoint vs PV + load",
    description:
      "Confirm the battery charge-rate setpoint is correct relative to available PV generation and site load.",
  },
  {
    key: "phantom_pv_load_ct",
    title: "4. Phantom PV / load metering — CT polarity + scaling",
    description:
      "Verify CT polarity and scaling on the phantom PV / load metering so generation and consumption read correctly.",
  },
  {
    key: "huawei_active_grid_ct_placement",
    title: "5. Huawei vs Active-Grid-Power CT placement",
    description:
      "Confirm CT placement reconciles the Huawei reading against the Active-Grid-Power measurement point.",
  },
  {
    key: "battery_overvolt_mppt",
    title: "6. Battery overvolt — MPPT vs max-charge check",
    description:
      "Confirm the battery over-voltage guard reconciles the MPPT voltage against the maximum charge voltage.",
  },
  {
    key: "gen_eskom_transfer_priority",
    title: "7. Generator vs Eskom auto-transfer priority",
    description:
      "Confirm the auto-transfer priority between generator and Eskom is set correctly for the site.",
  },
];

export const BESS_SEVEN_CHECK_COUNT = BESS_SEVEN_CHECKS.length;

export function isBessCommissioningItem(item: { itemType?: string | null }): boolean {
  return item.itemType === BESS_ITEM_TYPE;
}

/**
 * A BESS check may only close once the Construction Manager has
 * countersigned the Engineering-Lead sign-off. Returns a human-readable
 * reason when closure is blocked, else null. Non-BESS items are never gated
 * by this rule.
 */
export function bessItemCloseBlockedReason(
  item: { itemType?: string | null; countersignedByUserId?: number | null },
  targetStatus: string,
): string | null {
  if (item.itemType !== BESS_ITEM_TYPE) return null;
  if (targetStatus !== "closed") return null;
  if (item.countersignedByUserId == null) {
    return "BESS 7-check items require a Construction Manager countersignature before closure.";
  }
  return null;
}

/** The checklist is complete when all seven checks have closed. */
export function isBessSevenCheckComplete(items: Array<{ status: string }>): boolean {
  const closed = items.filter((i) => i.status === "closed").length;
  return closed >= BESS_SEVEN_CHECK_COUNT;
}

/** Progress summary for the checklist header. */
export function bessSevenCheckProgress(items: Array<{ status: string; countersignedByUserId?: number | null }>): {
  total: number;
  closed: number;
  countersigned: number;
  complete: boolean;
} {
  const closed = items.filter((i) => i.status === "closed").length;
  const countersigned = items.filter((i) => i.countersignedByUserId != null).length;
  return {
    total: items.length,
    closed,
    countersigned,
    complete: closed >= BESS_SEVEN_CHECK_COUNT,
  };
}
