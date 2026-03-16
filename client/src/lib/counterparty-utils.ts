export const COUNTERPARTIES_ROUTE = "/counterparties";

export type CounterpartySummary = {
  id: number;
  nameCanonical: string;
  typeDefault: "SUPPLIER" | "INSTALLER" | "OTHER";
  isCore: boolean;
  isActive?: boolean;
  roleTags?: string[];
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
  activeContactCount?: number;
  directAssignmentCount?: number;
  contactAssignmentCount?: number;
  assignmentEntityTypes?: string[];
};

export type CounterpartyContact = {
  id: number;
  counterpartyId: number;
  name: string;
  email?: string | null;
  phone?: string | null;
  title?: string | null;
  roleTags?: string[];
  isActive: boolean;
  notes?: string | null;
};

export type CounterpartyDetail = CounterpartySummary & {
  summary?: {
    usageCount: number;
    linkedProjectCount: number;
    totalSpendExVat: number;
    openAmountExVat: number;
    directAssignmentCount: number;
    contactAssignmentCount: number;
    assignmentEntityTypes: string[];
  };
  contacts: CounterpartyContact[];
  activeAssignments?: Array<{
    id: number;
    entityType: string;
    entityId: number;
    assignmentRole: string;
    assigneeType: string;
    assigneeId: number;
    displayLabelSnapshot: string;
    assignedAt: string;
  }>;
};

export function deriveCounterpartyStatus(counterparty: CounterpartySummary): "active" | "inactive" {
  return counterparty.isActive === false ? "inactive" : "active";
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
      ...(cp.roleTags || []),
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
