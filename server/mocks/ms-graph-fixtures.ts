/**
 * Microsoft Graph mock fixtures (Phase 7)
 *
 * Deterministic, minimal fixture data so local dev can exercise:
 *   - Calendar events (getCalendarEvents)
 *   - Mail messages + folders (listMessages / listMailFolders / getMessageDetail)
 *   - Teams (getJoinedTeams / getMyChats / getChatMessages / getChannelMessages)
 *   - SharePoint list discovery + items
 *
 * Dates are computed relative to "now" at call time so pages that filter by
 * week/month always have something to show regardless of when QA runs.
 */

function iso(daysFromNow: number, hour = 9): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + daysFromNow);
  d.setUTCHours(hour, 0, 0, 0);
  return d.toISOString();
}

export function mockGraphProfile() {
  return {
    id: "mock-user-id",
    mail: "johannes@mock.ee.local",
    userPrincipalName: "johannes@mock.ee.local",
    displayName: "Johannes (Mock)",
    jobTitle: "COO",
  };
}

export function mockConnectionStatus() {
  return {
    configured: true,
    connected: true,
    email: "johannes@mock.ee.local",
  };
}

export function mockCalendarEvents(startDate?: string, endDate?: string) {
  const events = [
    {
      id: "mock-evt-1",
      subject: "Sandton Solar — commissioning review",
      start: { dateTime: iso(1, 9), timeZone: "Africa/Johannesburg" },
      end: { dateTime: iso(1, 10), timeZone: "Africa/Johannesburg" },
      isAllDay: false,
      location: { displayName: "Site office" },
      organizer: { emailAddress: { name: "Johannes", address: "johannes@mock.ee.local" } },
      showAs: "busy",
      isCancelled: false,
      isRecurring: false,
      webLink: "https://outlook.office.com/calendar/item/mock-evt-1",
    },
    {
      id: "mock-evt-2",
      subject: "Finance weekly — revenue tracker review",
      start: { dateTime: iso(2, 14), timeZone: "Africa/Johannesburg" },
      end: { dateTime: iso(2, 15), timeZone: "Africa/Johannesburg" },
      isAllDay: false,
      location: { displayName: "Teams" },
      organizer: { emailAddress: { name: "CFO", address: "cfo@mock.ee.local" } },
      showAs: "busy",
      isCancelled: false,
      isRecurring: true,
      webLink: "https://outlook.office.com/calendar/item/mock-evt-2",
    },
    {
      id: "mock-evt-3",
      subject: "Stage gate: S06 Construction close-out",
      start: { dateTime: iso(3, 11), timeZone: "Africa/Johannesburg" },
      end: { dateTime: iso(3, 12), timeZone: "Africa/Johannesburg" },
      isAllDay: false,
      location: { displayName: "Boardroom" },
      organizer: { emailAddress: { name: "Program Manager", address: "pm@mock.ee.local" } },
      showAs: "busy",
      isCancelled: false,
      isRecurring: false,
      webLink: "https://outlook.office.com/calendar/item/mock-evt-3",
    },
  ];

  if (startDate || endDate) {
    const start = startDate ? new Date(startDate).getTime() : -Infinity;
    const end = endDate ? new Date(endDate).getTime() : Infinity;
    return events.filter((e) => {
      const t = new Date(e.start.dateTime).getTime();
      return t >= start && t <= end;
    });
  }
  return events;
}

export function mockMailMessages() {
  return [
    {
      id: "mock-msg-1",
      subject: "Invoice from Acme Solar Supplies",
      from: { emailAddress: { name: "Acme AR", address: "ar@acme.mock" } },
      bodyPreview: "Please find attached invoice INV-2026-0412 for R42,500 ex VAT. Payment due in 30 days.",
      receivedDateTime: iso(-1, 8),
      isRead: false,
      flag: { flagStatus: "notFlagged" },
      webLink: "https://outlook.office.com/mail/item/mock-msg-1",
      hasAttachments: true,
    },
    {
      id: "mock-msg-2",
      subject: "Site photos — Sandton commissioning",
      from: { emailAddress: { name: "Site Manager", address: "site@mock.ee.local" } },
      bodyPreview: "Commissioning photos from this morning attached. All DC string tests passed.",
      receivedDateTime: iso(-1, 11),
      isRead: true,
      flag: { flagStatus: "flagged" },
      webLink: "https://outlook.office.com/mail/item/mock-msg-2",
      hasAttachments: true,
    },
    {
      id: "mock-msg-3",
      subject: "PO approval needed: Umhlanga Phase 2 electrical",
      from: { emailAddress: { name: "Procurement", address: "procurement@mock.ee.local" } },
      bodyPreview: "Requesting approval for PO-2026-114 to XYZ Electrical, R128,000 ex VAT.",
      receivedDateTime: iso(-2, 15),
      isRead: false,
      flag: { flagStatus: "flagged" },
      webLink: "https://outlook.office.com/mail/item/mock-msg-3",
      hasAttachments: false,
    },
  ];
}

export function mockMailFolders() {
  return [
    { id: "inbox", displayName: "Inbox", totalItemCount: 3, unreadItemCount: 2 },
    { id: "sent", displayName: "Sent Items", totalItemCount: 0, unreadItemCount: 0 },
    { id: "drafts", displayName: "Drafts", totalItemCount: 0, unreadItemCount: 0 },
  ];
}

export function mockJoinedTeams() {
  return [
    { id: "team-ee-eng", displayName: "EE Engineering", description: "Engineering team" },
    { id: "team-ee-exec", displayName: "EE Exec", description: "Leadership channel" },
    { id: "team-ee-construction", displayName: "EE Construction", description: "Site ops" },
  ];
}

export function mockTeamChannels(teamId: string) {
  const base = [
    { id: `${teamId}-general`, displayName: "General", description: "Main channel" },
    { id: `${teamId}-handovers`, displayName: "Handovers", description: "PD → PM handovers" },
  ];
  if (teamId === "team-ee-construction") {
    base.push({ id: `${teamId}-site-sandton`, displayName: "Site: Sandton", description: "Site updates" });
  }
  return base;
}

export function mockMyChats() {
  return [
    {
      id: "chat-1",
      topic: "Johannes / CFO — daily cashflow check",
      chatType: "oneOnOne",
      lastUpdatedDateTime: iso(0, 16),
      members: [
        { displayName: "Johannes", email: "johannes@mock.ee.local" },
        { displayName: "CFO", email: "cfo@mock.ee.local" },
      ],
    },
    {
      id: "chat-2",
      topic: "Sandton commissioning team",
      chatType: "group",
      lastUpdatedDateTime: iso(-1, 10),
      members: [
        { displayName: "Johannes", email: "johannes@mock.ee.local" },
        { displayName: "Eon PM", email: "eon@mock.ee.local" },
        { displayName: "Paul Eng", email: "paul@mock.ee.local" },
      ],
    },
  ];
}

export function mockChatMessages(chatId: string) {
  return [
    {
      id: `${chatId}-msg-1`,
      from: { user: { displayName: "Eon PM", email: "eon@mock.ee.local" } },
      body: { content: "Signoff sent to client for stage S06.", contentType: "text" },
      createdDateTime: iso(-1, 12),
    },
    {
      id: `${chatId}-msg-2`,
      from: { user: { displayName: "Paul Eng", email: "paul@mock.ee.local" } },
      body: { content: "Photos uploaded to SharePoint.", contentType: "text" },
      createdDateTime: iso(-1, 13),
    },
  ];
}

// ── SharePoint fixtures ──────────────────────────────────────────────

export function mockSharePointSites() {
  return [
    { id: "site-ee-proposals", displayName: "EE Proposals", webUrl: "https://mock.sharepoint.com/sites/ee-proposals" },
    { id: "site-ee-engineering", displayName: "EE Engineering", webUrl: "https://mock.sharepoint.com/sites/ee-engineering" },
  ];
}

export function mockSharePointLists(_siteId: string) {
  return [
    { id: "list-proposals-pipeline", displayName: "Proposals Pipeline", itemCount: 2 },
    { id: "list-intake-requests", displayName: "Intake Requests", itemCount: 1 },
  ];
}

export function mockSharePointListColumns(_siteId: string, _listId: string) {
  return [
    { id: "c1", name: "Title", displayName: "Title", columnType: "text", readOnly: false },
    { id: "c2", name: "Stage", displayName: "Stage", columnType: "choice", readOnly: false },
    { id: "c3", name: "ClientName", displayName: "Client name", columnType: "text", readOnly: false },
    { id: "c4", name: "ProjectSize", displayName: "Size (kWp)", columnType: "number", readOnly: false },
  ];
}

export function mockSharePointListItems(_siteId: string, _listId: string) {
  return [
    {
      id: "sp-item-1",
      fields: {
        Title: "Sandton Tower Solar (mock)",
        Stage: "In Progress",
        ClientName: "Sandton Properties",
        ProjectSize: 380,
      },
    },
    {
      id: "sp-item-2",
      fields: {
        Title: "Umhlanga Phase 2 (mock)",
        Stage: "In Progress",
        ClientName: "Umhlanga Holdings",
        ProjectSize: 520,
      },
    },
  ];
}
