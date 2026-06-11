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
  const now = Date.now();
  return {
    connected: true,
    realmId: "mock-realm-123",
    companyName: "Emergent Energy (Mock)",
    tokenExpiry: new Date(now + 55 * 60 * 1000).toISOString(),
    refreshTokenExpiry: new Date(now + 85 * 24 * 60 * 60 * 1000).toISOString(),
    health: "healthy",
    lastSuccessfulSyncAt: new Date(now - 10 * 60 * 1000).toISOString(),
    lastFailedSyncAt: null,
    lastFailureCode: null,
    lastFailureReason: null,
    isStale: false,
    ageMs: 10 * 60 * 1000,
    staleAfterMs: 2 * 60 * 60 * 1000,
    daysUntilRefreshTokenExpiry: 85,
    refreshTokenExpiryState: "ok",
    reconnectRequired: false,
    reconnectPath: "/api/quickbooks/auth",
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
        {
          Amount: 42500,
          Description: "Jinko Tiger 545W panels ×12",
          DetailType: "AccountBasedExpenseLineDetail",
          AccountBasedExpenseLineDetail: { AccountRef: { value: "acc-cos-mat", name: "Cost of Sales — Materials" } },
        },
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
        {
          Amount: 128000,
          Description: "Site electrical install — Umhlanga",
          DetailType: "AccountBasedExpenseLineDetail",
          AccountBasedExpenseLineDetail: { AccountRef: { value: "acc-cos-sub", name: "Cost of Sales — Subcontractor" } },
        },
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
        {
          Amount: 300000,
          Description: "Civil works — Sandton",
          DetailType: "AccountBasedExpenseLineDetail",
          AccountBasedExpenseLineDetail: { AccountRef: { value: "acc-cos-sub", name: "Cost of Sales — Subcontractor" } },
        },
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
      Line: [
        {
          Amount: 42500,
          Description: "Duplicate invoice — for scoring demo",
          DetailType: "AccountBasedExpenseLineDetail",
          AccountBasedExpenseLineDetail: { AccountRef: { value: "acc-cos-mat", name: "Cost of Sales — Materials" } },
        },
      ],
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
      Line: [
        {
          Amount: 95000,
          Description: "Electrical supply — revised quote",
          DetailType: "AccountBasedExpenseLineDetail",
          AccountBasedExpenseLineDetail: { AccountRef: { value: "acc-cos-mat", name: "Cost of Sales — Materials" } },
        },
      ],
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
      Line: [
        {
          Amount: 130434.78,
          Description: "Civil works — Randburg (payment residual demo)",
          DetailType: "AccountBasedExpenseLineDetail",
          AccountBasedExpenseLineDetail: { AccountRef: { value: "acc-cos-sub", name: "Cost of Sales — Subcontractor" } },
        },
      ],
    },
    // Whitelist demo: NON-COS bill tagged to a project class. With the
    // COS account-name whitelist active (QB_COS_ACCOUNT_NAME_PATTERNS
    // including "cost of sales"), this Bill is excluded from project
    // COS even though its vendor + class would otherwise pull it in.
    // Use case: project rent / shared overhead miscoded to a project.
    {
      Id: "bill-7",
      DocNumber: "RENT-2026-04",
      TxnDate: iso(7),
      DueDate: iso(-23),
      TotalAmt: 28750,
      Balance: 28750,
      VendorRef: { value: "vend-1", name: "Acme Solar Supplies" },
      CurrencyRef: { value: "ZAR" },
      TxnTaxDetail: { TotalTax: 3750 },
      Line: [
        {
          Amount: 25000,
          Description: "Site office rent — April",
          DetailType: "AccountBasedExpenseLineDetail",
          AccountBasedExpenseLineDetail: { AccountRef: { value: "acc-rent", name: "Rent & Site Office" } },
        },
      ],
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
  // Shaped like a real QuickBooks ProfitAndLoss report with
  // summarize_column_by=Month: account rows nested inside the standard
  // "Income" and "Cost of Sales" sections, one money column per month
  // (StartDate in the column MetaData). This is the shape the section /
  // account-detail extractors in quickbooks-service.ts expect, so the dev
  // QB Revenue/COS/GP comparison columns are exercised without a real realm.
  // Account numbers mirror the live chart (Income 200x, COS 1000x) but
  // classification is by section, not number.
  const col = (start: string, title: string) => ({
    ColTitle: title,
    ColType: "Money",
    MetaData: [{ Name: "StartDate", Value: start }],
  });
  const acct = (id: string, name: string, sep: string, oct: string, nov: string) => ({
    type: "Data",
    ColData: [
      { id, value: `${id} ${name}` },
      { value: sep },
      { value: oct },
      { value: nov },
      { value: (Number(sep) + Number(oct) + Number(nov)).toFixed(2) },
    ],
  });
  return {
    Header: { ReportName: "ProfitAndLoss", Currency: "ZAR", StartPeriod: startDate, EndPeriod: endDate },
    Columns: {
      Column: [
        { ColTitle: "", ColType: "Account" },
        col("2025-09-01", "Sep 2025"),
        col("2025-10-01", "Oct 2025"),
        col("2025-11-01", "Nov 2025"),
        { ColTitle: "Total", ColType: "Money" },
      ],
    },
    Rows: {
      Row: [
        {
          type: "Section",
          group: "Income",
          Header: { ColData: [{ value: "Income" }] },
          Rows: {
            Row: [
              acct("200000", "Solar EPC Revenue", "250000.00", "480000.00", "320000.00"),
              acct("200100", "O&M Revenue", "37500.00", "37500.00", "37500.00"),
            ],
          },
          Summary: { ColData: [{ value: "Total Income" }, { value: "287500.00" }, { value: "517500.00" }, { value: "357500.00" }, { value: "1162500.00" }] },
        },
        {
          type: "Section",
          group: "COGS",
          Header: { ColData: [{ value: "Cost of Sales" }] },
          Rows: {
            Row: [
              acct("1000000", "Materials", "150000.00", "290000.00", "195000.00"),
              acct("1000100", "Subcontractors", "43875.00", "8325.00", "60000.00"),
            ],
          },
          Summary: { ColData: [{ value: "Total Cost of Sales" }, { value: "193875.00" }, { value: "298325.00" }, { value: "255000.00" }, { value: "747200.00" }] },
        },
        {
          type: "Section",
          group: "GrossProfit",
          Summary: { ColData: [{ value: "Gross Profit" }, { value: "93625.00" }, { value: "219175.00" }, { value: "102500.00" }, { value: "415300.00" }] },
        },
      ],
    },
  };
}
