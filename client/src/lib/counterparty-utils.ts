export const COUNTERPARTIES_ROUTE = "/counterparties";

export type CounterpartySummary = {
  id: number;
  nameCanonical: string;
  typeDefault: "SUPPLIER" | "INSTALLER" | "OTHER";
  isCore: boolean;
  contactPerson?: string | null;
  contactPhone?: string | null;
  contactEmail?: string | null;
  address?: string | null;
  vatNumber?: string | null;
  registrationNumber?: string | null;
  paymentTerms?: string | null;
  notes?: string | null;
  lastSeenAt?: string | null;
  linkedProjectCount?: number;
  usageCount?: number;
  totalSpendExVat?: number;
  openAmountExVat?: number;
};

export function deriveCounterpartyStatus(counterparty: CounterpartySummary): "active" | "inactive" {
  return (counterparty.usageCount || 0) > 0 ? "active" : "inactive";
}

export function filterCounterparties(
  counterparties: CounterpartySummary[],
  searchTerm: string,
  typeFilter: "all" | "SUPPLIER" | "INSTALLER" | "OTHER",
  statusFilter: "all" | "active" | "inactive",
): CounterpartySummary[] {
  const query = searchTerm.trim().toLowerCase();

  return counterparties.filter((cp) => {
    if (typeFilter !== "all" && cp.typeDefault !== typeFilter) return false;

    const status = deriveCounterpartyStatus(cp);
    if (statusFilter !== "all" && status !== statusFilter) return false;

    if (!query) return true;

    const fields = [
      cp.nameCanonical,
      cp.typeDefault,
      cp.contactPerson,
      cp.contactEmail,
      cp.contactPhone,
      cp.notes,
    ]
      .filter(Boolean)
      .map((v) => String(v).toLowerCase());

    return fields.some((v) => v.includes(query));
  });
}

export function canEditCounterparties(canEditPermission: boolean): boolean {
  return canEditPermission;
}
