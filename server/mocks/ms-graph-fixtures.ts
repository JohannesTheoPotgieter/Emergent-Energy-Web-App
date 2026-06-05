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

/**
 * Document libraries (drives) for a site. Reuses the same drive ids the
 * DM mock store is keyed on so the folder picker browses a populated tree.
 */
export function mockSiteDrives(_siteId: string) {
  return [
    { id: "drive-company-mock", name: "Documents", webUrl: "https://mock.sharepoint.com/sites/x/Shared%20Documents", driveType: "documentLibrary" },
    { id: "drive-project-mock", name: "Projects", webUrl: "https://mock.sharepoint.com/sites/x/Projects", driveType: "documentLibrary" },
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

// ── Document Management (DM) mock hierarchy ─────────────────────────
//
// Single in-memory tree shared across every DM Graph mock. Drives:
//   "drive-project-mock"  — project root for project id 1
//   "drive-company-mock"  — global/company root (HR, Templates, Policies)
//
// `mockDm*` helpers below mutate this structure so the UI feels alive
// on a fresh clone. Uploads/checkouts/renames are reflected back on
// subsequent reads within the same process.

interface MockItem {
  id: string;
  name: string;
  parentId: string | null;
  driveId: string;
  isFolder: boolean;
  size?: number;
  lastModifiedDateTime: string;
  lastModifiedBy: { displayName: string; email: string };
  versions: { id: string; sizeBytes?: number; lastModifiedDateTime: string; notes?: string }[];
  buffer?: Buffer;
  contentType?: string;
  webUrl?: string;
  eTag?: string;
  checkedOutByUserEmail?: string | null;
}

let _dmIdCounter = 1_000;
function nextId(prefix: string): string {
  _dmIdCounter += 1;
  return `${prefix}-${_dmIdCounter}`;
}

function seedDmStore(): Map<string, MockItem> {
  const store = new Map<string, MockItem>();
  const now = new Date().toISOString();
  const add = (item: Omit<MockItem, "versions">) => {
    store.set(item.id, { ...item, versions: [] });
  };

  // Project tree ─ drive-project-mock
  add({ id: "proj-root", name: "Sandton Tower Solar", parentId: null, driveId: "drive-project-mock", isFolder: true, lastModifiedDateTime: now, lastModifiedBy: { displayName: "Mock", email: "mock@ee.local" } });
  add({ id: "proj-engineering", name: "Engineering", parentId: "proj-root", driveId: "drive-project-mock", isFolder: true, lastModifiedDateTime: now, lastModifiedBy: { displayName: "Mock", email: "mock@ee.local" } });
  add({ id: "proj-contracts", name: "Contracts", parentId: "proj-root", driveId: "drive-project-mock", isFolder: true, lastModifiedDateTime: now, lastModifiedBy: { displayName: "Mock", email: "mock@ee.local" } });
  add({ id: "proj-photos", name: "Photos", parentId: "proj-root", driveId: "drive-project-mock", isFolder: true, lastModifiedDateTime: now, lastModifiedBy: { displayName: "Mock", email: "mock@ee.local" } });
  add({ id: "proj-client", name: "Client Docs", parentId: "proj-root", driveId: "drive-project-mock", isFolder: true, lastModifiedDateTime: now, lastModifiedBy: { displayName: "Mock", email: "mock@ee.local" } });
  add({ id: "proj-internal", name: "Internal Docs", parentId: "proj-root", driveId: "drive-project-mock", isFolder: true, lastModifiedDateTime: now, lastModifiedBy: { displayName: "Mock", email: "mock@ee.local" } });
  add({ id: "proj-eng-spec", name: "design-spec-v2.pdf", parentId: "proj-engineering", driveId: "drive-project-mock", isFolder: false, size: 123456, lastModifiedDateTime: now, lastModifiedBy: { displayName: "Engineer", email: "eng@mock.ee.local" }, buffer: Buffer.from("%PDF-1.4 mock design spec\n"), contentType: "application/pdf", webUrl: "https://mock.sharepoint.com/sites/ee/proj/Engineering/design-spec-v2.pdf" });
  add({ id: "proj-contract", name: "signed-epc-contract.pdf", parentId: "proj-contracts", driveId: "drive-project-mock", isFolder: false, size: 89012, lastModifiedDateTime: now, lastModifiedBy: { displayName: "CCO", email: "cco@mock.ee.local" }, buffer: Buffer.from("%PDF-1.4 mock contract\n"), contentType: "application/pdf", webUrl: "https://mock.sharepoint.com/sites/ee/proj/Contracts/signed-epc-contract.pdf" });

  // Company tree ─ drive-company-mock
  add({ id: "co-root", name: "Company", parentId: null, driveId: "drive-company-mock", isFolder: true, lastModifiedDateTime: now, lastModifiedBy: { displayName: "Mock", email: "mock@ee.local" } });
  add({ id: "co-hr", name: "HR", parentId: "co-root", driveId: "drive-company-mock", isFolder: true, lastModifiedDateTime: now, lastModifiedBy: { displayName: "Mock", email: "mock@ee.local" } });
  add({ id: "co-templates", name: "Templates", parentId: "co-root", driveId: "drive-company-mock", isFolder: true, lastModifiedDateTime: now, lastModifiedBy: { displayName: "Mock", email: "mock@ee.local" } });
  add({ id: "co-policies", name: "Policies", parentId: "co-root", driveId: "drive-company-mock", isFolder: true, lastModifiedDateTime: now, lastModifiedBy: { displayName: "Mock", email: "mock@ee.local" } });
  add({ id: "co-hr-handbook", name: "employee-handbook.pdf", parentId: "co-hr", driveId: "drive-company-mock", isFolder: false, size: 201000, lastModifiedDateTime: now, lastModifiedBy: { displayName: "COO", email: "coo@mock.ee.local" }, buffer: Buffer.from("%PDF-1.4 mock handbook\n"), contentType: "application/pdf" });
  add({ id: "co-templates-sla", name: "SLA-template.docx", parentId: "co-templates", driveId: "drive-company-mock", isFolder: false, size: 34120, lastModifiedDateTime: now, lastModifiedBy: { displayName: "CCO", email: "cco@mock.ee.local" }, buffer: Buffer.from("mock docx"), contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });

  return store;
}

const _dmStore = seedDmStore();

interface DmGraphItem {
  id: string;
  name: string;
  path: string;
  isFolder: boolean;
  size?: number;
  lastModifiedDateTime?: string;
  lastModifiedBy?: { displayName?: string; email?: string };
  webUrl?: string;
  eTag?: string;
  checkedOutBy?: { displayName?: string; email?: string } | null;
}

function buildItemPath(item: MockItem): string {
  const segments: string[] = [];
  let cursor: MockItem | undefined = item;
  while (cursor && cursor.parentId != null) {
    segments.unshift(cursor.name);
    cursor = _dmStore.get(cursor.parentId) ?? undefined;
  }
  return segments.join("/");
}

function asGraphItem(item: MockItem): DmGraphItem {
  return {
    id: item.id,
    name: item.name,
    path: buildItemPath(item),
    isFolder: item.isFolder,
    size: item.size,
    lastModifiedDateTime: item.lastModifiedDateTime,
    lastModifiedBy: item.lastModifiedBy,
    webUrl: item.webUrl,
    eTag: item.eTag,
    checkedOutBy: item.checkedOutByUserEmail
      ? { email: item.checkedOutByUserEmail }
      : null,
  };
}

function rootIdFor(driveId: string): string {
  if (driveId === "drive-project-mock") return "proj-root";
  if (driveId === "drive-company-mock") return "co-root";
  // Unknown drive — still return something so tests get a stable tree.
  return "proj-root";
}

export function mockListChildren(driveId: string, parentItemId: string | null): DmGraphItem[] {
  const parent = parentItemId ?? rootIdFor(driveId);
  const out: DmGraphItem[] = [];
  for (const it of _dmStore.values()) {
    if (it.driveId === driveId && it.parentId === parent) {
      out.push(asGraphItem(it));
    }
  }
  return out;
}

export function mockGetItem(driveId: string, itemId: string): DmGraphItem | null {
  const it = _dmStore.get(itemId);
  if (!it || it.driveId !== driveId) return null;
  return asGraphItem(it);
}

export function mockDownloadBuffer(driveId: string, itemId: string): { buffer: Buffer; fileName: string; contentType: string } {
  const it = _dmStore.get(itemId);
  if (!it || it.driveId !== driveId || it.isFolder) {
    throw new Error(`Mock item ${itemId} not found or is a folder.`);
  }
  return {
    buffer: it.buffer ?? Buffer.from(""),
    fileName: it.name,
    contentType: it.contentType ?? "application/octet-stream",
  };
}

export function mockListVersions(driveId: string, itemId: string): { id: string; sizeBytes?: number; lastModifiedDateTime?: string }[] {
  const it = _dmStore.get(itemId);
  if (!it || it.driveId !== driveId) return [];
  return it.versions.map((v) => ({ id: v.id, sizeBytes: v.sizeBytes, lastModifiedDateTime: v.lastModifiedDateTime }));
}

export function mockUploadSmall(input: { driveId: string; parentItemId: string | null; fileName: string; body: Buffer }): DmGraphItem {
  const parent = input.parentItemId ?? rootIdFor(input.driveId);
  // Replace existing (same name + parent) to simulate "new version"
  const existing = [..._dmStore.values()].find(
    (i) => i.driveId === input.driveId && i.parentId === parent && i.name === input.fileName && !i.isFolder,
  );
  if (existing) {
    const versionId = nextId("ver");
    existing.versions.unshift({
      id: versionId,
      sizeBytes: existing.size,
      lastModifiedDateTime: existing.lastModifiedDateTime,
    });
    existing.size = input.body.length;
    existing.buffer = input.body;
    existing.lastModifiedDateTime = new Date().toISOString();
    return asGraphItem(existing);
  }
  const id = nextId("file");
  const created: MockItem = {
    id,
    name: input.fileName,
    parentId: parent,
    driveId: input.driveId,
    isFolder: false,
    size: input.body.length,
    lastModifiedDateTime: new Date().toISOString(),
    lastModifiedBy: { displayName: "You", email: "you@mock.ee.local" },
    versions: [],
    buffer: input.body,
    contentType: "application/octet-stream",
  };
  _dmStore.set(id, created);
  return asGraphItem(created);
}

export function mockCreateFolder(input: { driveId: string; parentItemId: string | null; name: string }): DmGraphItem {
  const parent = input.parentItemId ?? rootIdFor(input.driveId);
  const clash = [..._dmStore.values()].find(
    (i) => i.driveId === input.driveId && i.parentId === parent && i.name === input.name,
  );
  if (clash) {
    const err = new Error(`Folder "${input.name}" already exists.`);
    (err as Error & { status?: number }).status = 409;
    throw err;
  }
  const id = nextId("folder");
  const created: MockItem = {
    id,
    name: input.name,
    parentId: parent,
    driveId: input.driveId,
    isFolder: true,
    lastModifiedDateTime: new Date().toISOString(),
    lastModifiedBy: { displayName: "You", email: "you@mock.ee.local" },
    versions: [],
  };
  _dmStore.set(id, created);
  return asGraphItem(created);
}

export function mockRenameItem(input: { driveId: string; itemId: string; newName: string }): DmGraphItem {
  const it = _dmStore.get(input.itemId);
  if (!it || it.driveId !== input.driveId) throw new Error(`Mock item ${input.itemId} not found.`);
  it.name = input.newName;
  it.lastModifiedDateTime = new Date().toISOString();
  return asGraphItem(it);
}

export function mockCheckout(driveId: string, itemId: string): void {
  const it = _dmStore.get(itemId);
  if (!it || it.driveId !== driveId) throw new Error(`Mock item ${itemId} not found.`);
  it.checkedOutByUserEmail = "you@mock.ee.local";
}

export function mockCheckin(driveId: string, itemId: string, _comment?: string): void {
  const it = _dmStore.get(itemId);
  if (!it || it.driveId !== driveId) throw new Error(`Mock item ${itemId} not found.`);
  it.checkedOutByUserEmail = null;
}

export function mockDiscardCheckout(driveId: string, itemId: string): void {
  mockCheckin(driveId, itemId);
}

export function mockRestoreVersion(driveId: string, itemId: string, versionId: string): void {
  const it = _dmStore.get(itemId);
  if (!it || it.driveId !== driveId) throw new Error(`Mock item ${itemId} not found.`);
  const ver = it.versions.find((v) => v.id === versionId);
  if (!ver) throw new Error(`Version ${versionId} not found.`);
  it.size = ver.sizeBytes ?? it.size;
  it.lastModifiedDateTime = new Date().toISOString();
}
