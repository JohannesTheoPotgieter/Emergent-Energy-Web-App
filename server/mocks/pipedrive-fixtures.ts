/**
 * Pipedrive mock fixtures (Phase 7)
 *
 * Synthetic deals + stages + owners so `syncPipedriveDeals` can return a
 * realistic result without a real API token. Used for local QA of the
 * Opportunities list, the pipeline view, and the deal-upsert-on-sync flow.
 */

function iso(daysAgo: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - daysAgo);
  return d.toISOString();
}

export function mockPipedriveOwners() {
  return [
    { id: 1, name: "Johannes Potgieter", email: "johannes@mock.ee.local" },
    { id: 2, name: "Eon PM", email: "eon@mock.ee.local" },
    { id: 3, name: "Dean QM", email: "dean@mock.ee.local" },
  ];
}

export function mockPipedriveStages() {
  return [
    { id: 1, name: "Qualified Lead", pipeline_id: 1, order_nr: 1 },
    { id: 2, name: "Proposal Sent", pipeline_id: 1, order_nr: 2 },
    { id: 3, name: "Negotiation", pipeline_id: 1, order_nr: 3 },
    { id: 4, name: "Signed", pipeline_id: 1, order_nr: 4 },
    { id: 5, name: "Lost", pipeline_id: 1, order_nr: 5 },
  ];
}

export function mockPipedriveDeals() {
  return [
    {
      id: 1001,
      title: "Sandton Tower Solar (mock)",
      value: 4_750_000,
      currency: "ZAR",
      stage_id: 4,
      status: "won",
      user_id: { id: 1, name: "Johannes Potgieter" },
      person_id: { name: "Mark van der Merwe", email: [{ value: "mark@sandton.mock", primary: true }] },
      org_id: { name: "Sandton Properties Pty Ltd" },
      expected_close_date: iso(-60),
      add_time: iso(180),
      update_time: iso(10),
      won_time: iso(60),
      lost_time: null,
      custom_fields: {
        size_kwp: 380,
        province: "Gauteng",
        deal_type: "EPC",
      },
    },
    {
      id: 1002,
      title: "Umhlanga Phase 2 (mock)",
      value: 6_200_000,
      currency: "ZAR",
      stage_id: 3,
      status: "open",
      user_id: { id: 2, name: "Eon PM" },
      person_id: { name: "Priya Naidoo", email: [{ value: "priya@umhlanga.mock", primary: true }] },
      org_id: { name: "Umhlanga Holdings Ltd" },
      expected_close_date: iso(-30),
      add_time: iso(120),
      update_time: iso(3),
      won_time: null,
      lost_time: null,
      custom_fields: {
        size_kwp: 520,
        province: "KZN",
        deal_type: "PPA",
      },
    },
    {
      id: 1003,
      title: "Randburg Industrial rooftop (mock)",
      value: 2_100_000,
      currency: "ZAR",
      stage_id: 2,
      status: "open",
      user_id: { id: 1, name: "Johannes Potgieter" },
      person_id: { name: "Theo Sibiya", email: [{ value: "theo@randburg.mock", primary: true }] },
      org_id: { name: "Randburg Industrial Pty Ltd" },
      expected_close_date: iso(-90),
      add_time: iso(45),
      update_time: iso(1),
      won_time: null,
      lost_time: null,
      custom_fields: {
        size_kwp: 165,
        province: "Gauteng",
        deal_type: "EPC",
      },
    },
    {
      id: 1004,
      title: "Cape Town Hotel (mock)",
      value: 8_900_000,
      currency: "ZAR",
      stage_id: 5,
      status: "lost",
      user_id: { id: 3, name: "Dean QM" },
      person_id: { name: "Kagiso Moloi", email: [{ value: "kagiso@capehotel.mock", primary: true }] },
      org_id: { name: "Cape Town Hospitality Group" },
      expected_close_date: iso(-45),
      add_time: iso(200),
      update_time: iso(40),
      won_time: null,
      lost_time: iso(40),
      custom_fields: {
        size_kwp: 740,
        province: "WC",
        deal_type: "EPC",
        lost_reason: "Client chose on-grid only",
      },
    },
  ];
}

/**
 * Shape returned by syncPipedriveDeals() in live mode — caller expects a
 * summary of what happened this sync.
 */
export function mockSyncResult() {
  const deals = mockPipedriveDeals();
  return {
    success: true,
    fetched: deals.length,
    inserted: 0,
    updated: deals.length,
    skipped: 0,
    errors: [] as string[],
    // Echo the fixture stages/owners so a consumer that wants to preview
    // full sync output can use them without another call.
    stages: mockPipedriveStages(),
    owners: mockPipedriveOwners(),
    // The full deal payload the live sync would have received from Pipedrive
    // before upsert logic runs.
    deals,
  };
}
