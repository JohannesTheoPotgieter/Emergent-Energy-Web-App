/**
 * QuickBooks Online mock fixtures (Phase 7)
 *
 * Minimal realistic dataset so local dev can exercise the cost-line
 * allocation UI, reconciliation views, and P&L charts without an Intuit
 * OAuth2 account. Dates are recent-past so "last 90 days" queries hit.
 */

function iso(daysAgo: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - daysAgo);
  return d.toISOString().slice(0, 10);
}

export function mockQuickBooksConnectionStatus() {
  return {
    connected: true,
    realmId: "mock-realm-123",
    companyName: "Emergent Energy (Mock)",
    lastRefreshedAt: new Date().toISOString(),
    lastSuccessfulSyncAt: new Date().toISOString(),
    tokenExpiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    isStale: false,
    classification: "ok",
  };
}

export function mockQuickBooksAccessToken() {
  return { accessToken: "mock-qb-access-token", realmId: "mock-realm-123" };
}

export function mockCompanyInfo() {
  return {
    CompanyInfo: {
      CompanyName: "Emergent Energy (Mock)",
      LegalName: "Emergent Energy (Mock) Pty Ltd",
      Country: "ZA",
      FiscalYearStartMonth: "September",
    },
  };
}

export function mockCustomers() {
  return {
    QueryResponse: {
      Customer: [
        { Id: "cust-1", DisplayName: "Sandton Properties", CompanyName: "Sandton Properties Pty Ltd", Active: true },
        { Id: "cust-2", DisplayName: "Umhlanga Holdings", CompanyName: "Umhlanga Holdings Ltd", Active: true },
        { Id: "cust-3", DisplayName: "Randburg Industrial", CompanyName: "Randburg Industrial Pty Ltd", Active: true },
      ],
    },
  };
}

export function mockVendors() {
  return {
    QueryResponse: {
      Vendor: [
        { Id: "vend-1", DisplayName: "Acme Solar Supplies", CompanyName: "Acme Solar Supplies Pty Ltd", Active: true },
        { Id: "vend-2", DisplayName: "XYZ Electrical", CompanyName: "XYZ Electrical Services CC", Active: true },
        { Id: "vend-3", DisplayName: "Atlas Construction", CompanyName: "Atlas Construction (Pty) Ltd", Active: true },
      ],
    },
  };
}

export function mockInvoices(startDate?: string, endDate?: string) {
  const all = [
    {
      Id: "inv-1",
      DocNumber: "INV-2026-0411",
      TxnDate: iso(12),
      DueDate: iso(-18),
      TotalAmt: 287500,
      Balance: 0,
      CustomerRef: { value: "cust-1", name: "Sandton Properties" },
      CurrencyRef: { value: "ZAR" },
      Status: "Paid",
      Line: [
        { Amount: 250000, Description: "Milestone 2 — Design complete" },
        { Amount: 37500, Description: "VAT 15%" },
      ],
    },
    {
      Id: "inv-2",
      DocNumber: "INV-2026-0412",
      TxnDate: iso(5),
      DueDate: iso(-25),
      TotalAmt: 517500,
      Balance: 517500,
      CustomerRef: { value: "cust-2", name: "Umhlanga Holdings" },
      CurrencyRef: { value: "ZAR" },
      Status: "Open",
      Line: [
        { Amount: 450000, Description: "Milestone 3 — Site establishment" },
        { Amount: 67500, Description: "VAT 15%" },
      ],
    },
  ];
  const start = startDate ? new Date(startDate).getTime() : -Infinity;
  const end = endDate ? new Date(endDate).getTime() : Infinity;
  const filtered = all.filter((inv) => {
    const t = new Date(inv.TxnDate).getTime();
    return t >= start && t <= end;
  });
  return { QueryResponse: { Invoice: filtered } };
}

export function mockBills(startDate?: string, endDate?: string) {
  const all = [
    {
      Id: "bill-1",
      DocNumber: "ACME-4711",
      TxnDate: iso(18),
      DueDate: iso(-12),
      TotalAmt: 48875,
      Balance: 0,
      VendorRef: { value: "vend-1", name: "Acme Solar Supplies" },
      CurrencyRef: { value: "ZAR" },
      TxnTaxDetail: { TotalTax: 6375 },
      Line: [
        { Amount: 42500, Description: "Jinko Tiger 545W panels ×12" },
        { Amount: 6375, Description: "VAT 15%" },
      ],
    },
    {
      Id: "bill-2",
      DocNumber: "XYZ-0412",
      TxnDate: iso(3),
      DueDate: iso(-27),
      TotalAmt: 147200,
      Balance: 147200,
      VendorRef: { value: "vend-2", name: "XYZ Electrical" },
      CurrencyRef: { value: "ZAR" },
      TxnTaxDetail: { TotalTax: 19200 },
      Line: [
        { Amount: 128000, Description: "Site electrical install — Umhlanga" },
        { Amount: 19200, Description: "VAT 15%" },
      ],
    },
    {
      Id: "bill-3",
      DocNumber: "ATLAS-778",
      TxnDate: iso(9),
      DueDate: iso(-21),
      TotalAmt: 345000,
      Balance: 345000,
      VendorRef: { value: "vend-3", name: "Atlas Construction" },
      CurrencyRef: { value: "ZAR" },
      TxnTaxDetail: { TotalTax: 45000 },
      Line: [
        { Amount: 300000, Description: "Civil works — Sandton" },
        { Amount: 45000, Description: "VAT 15%" },
      ],
    },
    // Scoring fixture: tier 2 (95) — invoice number exact + amount within R0.01.
    // App line invoiceNumber="ACME-4711-DUP", amountExVat=42500 → exact hit.
    {
      Id: "bill-4",
      DocNumber: "ACME-4711-DUP",
      TxnDate: iso(20),
      DueDate: iso(-10),
      TotalAmt: 48875,
      Balance: 0,
      VendorRef: { value: "vend-1", name: "Acme Solar Supplies" },
      CurrencyRef: { value: "ZAR" },
      TxnTaxDetail: { TotalTax: 6375 },
      Line: [{ Amount: 42500, Description: "Duplicate invoice — for scoring demo" }],
    },
    // Scoring fixture: tier 3 (85) + amount_mismatch warning.
    // Same invoice number as an app line but QB amount differs.
    {
      Id: "bill-5",
      DocNumber: "XYZ-MISMATCH",
      TxnDate: iso(4),
      DueDate: iso(-26),
      TotalAmt: 109250,
      Balance: 109250,
      VendorRef: { value: "vend-2", name: "XYZ Electrical" },
      CurrencyRef: { value: "ZAR" },
      TxnTaxDetail: { TotalTax: 14250 },
      Line: [{ Amount: 95000, Description: "Electrical supply — revised quote" }],
    },
    // Scoring fixture: qb_payment_inconsistent warning.
    // QB balance is 0.008 (rounds to 0.01 after toMoney), which is ≤ 0.01
    // so the route computes status="paid", yet the stored balance is 0.01 > 0.
    // This simulates a rounding residual after full payment application.
    {
      Id: "bill-6",
      DocNumber: "ATLAS-PAID-RESIDUAL",
      TxnDate: iso(11),
      DueDate: iso(-19),
      TotalAmt: 150000,
      Balance: 0.008,
      VendorRef: { value: "vend-3", name: "Atlas Construction" },
      CurrencyRef: { value: "ZAR" },
      TxnTaxDetail: { TotalTax: 19565.22 },
      Line: [{ Amount: 130434.78, Description: "Civil works — Randburg (payment residual demo)" }],
    },
  ];
  const start = startDate ? new Date(startDate).getTime() : -Infinity;
  const end = endDate ? new Date(endDate).getTime() : Infinity;
  const filtered = all.filter((b) => {
    const t = new Date(b.TxnDate).getTime();
    return t >= start && t <= end;
  });
  return { QueryResponse: { Bill: filtered } };
}

export function mockBillById(id: string) {
  const { QueryResponse } = mockBills();
  return QueryResponse.Bill.find((b) => b.Id === id) ?? null;
}

export function mockInvoiceById(id: string) {
  const { QueryResponse } = mockInvoices();
  return QueryResponse.Invoice.find((inv) => inv.Id === id) ?? null;
}

export function mockProfitAndLossReport(_startDate: string, _endDate: string) {
  return {
    Header: { ReportName: "ProfitAndLoss", Currency: "ZAR", StartPeriod: _startDate, EndPeriod: _endDate },
    Columns: {
      Column: [{ ColTitle: "", ColType: "Account" }, { ColTitle: "Total", ColType: "Money" }],
    },
    Rows: {
      Row: [
        { group: "Income", Summary: { ColData: [{ value: "Total Income" }, { value: "805000.00" }] } },
        { group: "COS", Summary: { ColData: [{ value: "Total Cost of Sales" }, { value: "541075.00" }] } },
        { group: "GrossProfit", Summary: { ColData: [{ value: "Gross Profit" }, { value: "263925.00" }] } },
      ],
    },
  };
}

export function mockMonthlyPnLReport(startDate: string, endDate: string) {
  return {
    Header: { ReportName: "MonthlyPnL", Currency: "ZAR", StartPeriod: startDate, EndPeriod: endDate },
    Columns: { Column: [{ ColTitle: "Month" }, { ColTitle: "Revenue" }, { ColTitle: "COS" }, { ColTitle: "GP" }] },
    Rows: {
      Row: [
        { ColData: [{ value: "2026-02" }, { value: "287500.00" }, { value: "193875.00" }, { value: "93625.00" }] },
        { ColData: [{ value: "2026-03" }, { value: "0.00" }, { value: "48875.00" }, { value: "-48875.00" }] },
        { ColData: [{ value: "2026-04" }, { value: "517500.00" }, { value: "298325.00" }, { value: "219175.00" }] },
      ],
    },
  };
}
