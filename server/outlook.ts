import { Client } from "@microsoft/microsoft-graph-client";

// -- Replit Connector-based Outlook integration --
// OAuth is managed by the Replit connector. Access tokens are fetched
// from the connector API automatically, including refresh handling.

let connectionSettings: any;

export function clearCachedToken() {
  connectionSettings = null;
  cachedCalendarId = null;
}

async function getAccessToken(): Promise<string> {
  if (!isOutlookConfigured()) {
    throw new Error("Outlook not available - connector not configured.");
  }

  if (
    connectionSettings &&
    connectionSettings.settings?.expires_at &&
    new Date(connectionSettings.settings.expires_at).getTime() > Date.now() + 60000
  ) {
    return connectionSettings.settings.access_token;
  }
  connectionSettings = null;

  const hostname = process.env.REPLIT_CONNECTORS_HOSTNAME;
  const xReplitToken = process.env.REPL_IDENTITY
    ? "repl " + process.env.REPL_IDENTITY
    : process.env.WEB_REPL_RENEWAL
      ? "depl " + process.env.WEB_REPL_RENEWAL
      : null;

  if (!xReplitToken) {
    throw new Error("Outlook not available - connector token not found.");
  }

  const res = await fetch(
    "https://" + hostname + "/api/v2/connection?include_secrets=true&connector_names=outlook",
    {
      headers: {
        Accept: "application/json",
        "X-Replit-Token": xReplitToken,
      },
    },
  );

  const data = await res.json();
  connectionSettings = data.items?.[0];

  const accessToken =
    connectionSettings?.settings?.access_token ||
    connectionSettings?.settings?.oauth?.credentials?.access_token;

  if (!connectionSettings || !accessToken) {
    throw new Error("Outlook not connected - please set up the Outlook connector.");
  }

  return accessToken;
}

async function getOutlookClient(): Promise<Client> {
  const accessToken = await getAccessToken();
  return Client.initWithMiddleware({
    authProvider: {
      getAccessToken: async () => accessToken,
    },
  });
}

export function isOutlookConfigured(): boolean {
  return !!(process.env.REPLIT_CONNECTORS_HOSTNAME);
}

export async function getConnectionStatus(): Promise<{
  configured: boolean;
  connected: boolean;
  email?: string;
}> {
  if (!isOutlookConfigured()) {
    return { configured: false, connected: false };
  }

  try {
    const token = await getAccessToken();
    if (!token) return { configured: true, connected: false };

    const profileRes = await fetch("https://graph.microsoft.com/v1.0/me", {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (profileRes.ok) {
      const profile = (await profileRes.json()) as any;
      return {
        configured: true,
        connected: true,
        email: profile.mail || profile.userPrincipalName,
      };
    }
    return { configured: true, connected: false };
  } catch {
    return { configured: true, connected: false };
  }
}

const MYTOOL_CALENDAR_NAME = "EE – My Tool Blocks";
let cachedCalendarId: string | null = null;

async function graphGet(url: string): Promise<any> {
  const token = await getAccessToken();
  const res = await fetch(`https://graph.microsoft.com/v1.0${url}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Prefer: 'outlook.timezone="Africa/Johannesburg"',
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Graph API error (${res.status}): ${body}`);
  }
  return res.json();
}

async function graphPost(url: string, body: any): Promise<any> {
  const token = await getAccessToken();
  const res = await fetch(`https://graph.microsoft.com/v1.0${url}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Prefer: 'outlook.timezone="Africa/Johannesburg"',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Graph API error (${res.status}): ${text}`);
  }
  return res.json();
}

async function graphPatch(url: string, body: any): Promise<any> {
  const token = await getAccessToken();
  const res = await fetch(`https://graph.microsoft.com/v1.0${url}`, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Graph API error (${res.status}): ${text}`);
  }
  return res.json();
}

async function graphDelete(url: string): Promise<void> {
  const token = await getAccessToken();
  const res = await fetch(`https://graph.microsoft.com/v1.0${url}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok && res.status !== 404) {
    const text = await res.text();
    throw new Error(`Graph API error (${res.status}): ${text}`);
  }
}

export async function getCalendarEvents(startDate: string, endDate: string): Promise<any[]> {
  const start = `${startDate}T00:00:00`;
  const end = `${endDate}T23:59:59`;
  const url = `/me/calendarView?startDateTime=${encodeURIComponent(start)}&endDateTime=${encodeURIComponent(end)}&$select=id,subject,start,end,isAllDay,location,organizer,showAs,isCancelled,type&$top=200&$orderby=start/dateTime`;

  const data = await graphGet(url);
  return (data.value || []).map((evt: any) => ({
    id: evt.id,
    subject: evt.subject,
    start: evt.start?.dateTime,
    end: evt.end?.dateTime,
    startTimezone: evt.start?.timeZone,
    endTimezone: evt.end?.timeZone,
    isAllDay: evt.isAllDay,
    location: evt.location?.displayName || null,
    organizer: evt.organizer?.emailAddress?.name || null,
    showAs: evt.showAs,
    isCancelled: evt.isCancelled,
    isRecurring: evt.type === "occurrence" || evt.type === "seriesMaster",
    source: "outlook" as const,
  }));
}

async function ensureMyToolCalendar(): Promise<string> {
  if (cachedCalendarId) return cachedCalendarId;

  const calendarsData = await graphGet("/me/calendars?$select=id,name");
  const existing = (calendarsData.value || []).find((c: any) => c.name === MYTOOL_CALENDAR_NAME);

  if (existing) {
    cachedCalendarId = existing.id;
    return existing.id;
  }

  const created = await graphPost("/me/calendars", { name: MYTOOL_CALENDAR_NAME });
  cachedCalendarId = created.id;
  return created.id;
}

export async function createOutlookEvent(block: {
  date: string;
  startTime: string;
  endTime: string;
  label: string;
  idempotencyKey: string;
}): Promise<string> {
  const calendarId = await ensureMyToolCalendar();

  const event = {
    subject: block.label,
    start: {
      dateTime: `${block.date}T${block.startTime}:00`,
      timeZone: "Africa/Johannesburg",
    },
    end: {
      dateTime: `${block.date}T${block.endTime}:00`,
      timeZone: "Africa/Johannesburg",
    },
    showAs: "tentative",
    categories: ["My Tool"],
    singleValueExtendedProperties: [
      {
        id: "String {66f5a359-4659-4830-9070-00047ec6ac6e} Name IdempotencyKey",
        value: block.idempotencyKey,
      },
    ],
  };

  const created = await graphPost(`/me/calendars/${calendarId}/events`, event);
  return created.id;
}

export async function updateOutlookEvent(
  eventId: string,
  calendarId: string | null,
  updates: {
    date?: string;
    startTime?: string;
    endTime?: string;
    label?: string;
  },
): Promise<void> {
  const patch: any = {};
  if (updates.label) patch.subject = updates.label;
  if (updates.date && updates.startTime) {
    patch.start = { dateTime: `${updates.date}T${updates.startTime}:00`, timeZone: "Africa/Johannesburg" };
  }
  if (updates.date && updates.endTime) {
    patch.end = { dateTime: `${updates.date}T${updates.endTime}:00`, timeZone: "Africa/Johannesburg" };
  }

  const url = calendarId
    ? `/me/calendars/${calendarId}/events/${eventId}`
    : `/me/events/${eventId}`;

  await graphPatch(url, patch);
}

export async function deleteOutlookEvent(eventId: string, calendarId: string | null): Promise<void> {
  const url = calendarId
    ? `/me/calendars/${calendarId}/events/${eventId}`
    : `/me/events/${eventId}`;

  await graphDelete(url);
}

export async function listMessages(options: {
  search?: string;
  top?: number;
  skip?: number;
  folder?: string;
}): Promise<any[]> {
  const top = options.top || 20;
  const skip = options.skip || 0;
  const folder = options.folder || "inbox";

  let url = `/me/mailFolders/${folder}/messages?$top=${top}&$skip=${skip}&$select=id,subject,from,receivedDateTime,bodyPreview,webLink,isRead,hasAttachments&$orderby=receivedDateTime desc`;

  if (options.search) {
    url = `/me/messages?$top=${top}&$skip=${skip}&$search="${encodeURIComponent(options.search)}"&$select=id,subject,from,receivedDateTime,bodyPreview,webLink,isRead,hasAttachments`;
  }

  const data = await graphGet(url);
  return (data.value || []).map((msg: any) => ({
    id: msg.id,
    subject: msg.subject || "(No Subject)",
    sender: msg.from?.emailAddress?.name || msg.from?.emailAddress?.address || null,
    senderEmail: msg.from?.emailAddress?.address || null,
    receivedAt: msg.receivedDateTime,
    snippet: msg.bodyPreview || null,
    webLink: msg.webLink || null,
    isRead: msg.isRead,
    hasAttachments: msg.hasAttachments,
  }));
}

export async function listFlaggedMessages(top: number = 50): Promise<any[]> {
  const url = `/me/messages?$top=${top}&$filter=flag/flagStatus eq 'flagged'&$select=id,subject,from,receivedDateTime,bodyPreview,webLink,isRead,hasAttachments,flag&$orderby=receivedDateTime desc`;
  const data = await graphGet(url);
  return (data.value || []).map((msg: any) => ({
    id: msg.id,
    subject: msg.subject || "(No Subject)",
    sender: msg.from?.emailAddress?.name || msg.from?.emailAddress?.address || null,
    senderEmail: msg.from?.emailAddress?.address || null,
    receivedAt: msg.receivedDateTime,
    snippet: msg.bodyPreview || null,
    webLink: msg.webLink || null,
    isRead: msg.isRead,
    hasAttachments: msg.hasAttachments,
    flagStatus: msg.flag?.flagStatus || null,
  }));
}

export async function getMessageDetail(messageId: string): Promise<any> {
  const msg = await graphGet(`/me/messages/${messageId}?$select=id,subject,from,toRecipients,ccRecipients,receivedDateTime,bodyPreview,webLink,body,isRead,hasAttachments,conversationId`);
  return {
    id: msg.id,
    subject: msg.subject || "(No Subject)",
    sender: msg.from?.emailAddress?.name || msg.from?.emailAddress?.address || null,
    senderEmail: msg.from?.emailAddress?.address || null,
    to: (msg.toRecipients || []).map((r: any) => ({ name: r.emailAddress?.name, email: r.emailAddress?.address })),
    cc: (msg.ccRecipients || []).map((r: any) => ({ name: r.emailAddress?.name, email: r.emailAddress?.address })),
    receivedAt: msg.receivedDateTime,
    snippet: msg.bodyPreview || null,
    body: msg.body?.content || null,
    bodyType: msg.body?.contentType || "text",
    webLink: msg.webLink || null,
    isRead: msg.isRead,
    hasAttachments: msg.hasAttachments,
    conversationId: msg.conversationId || null,
  };
}

export async function listMailFolders(): Promise<any[]> {
  const data = await graphGet("/me/mailFolders?$top=100&$select=id,displayName,totalItemCount,unreadItemCount,parentFolderId");
  const folders = (data.value || []).map((f: any) => ({
    id: f.id,
    displayName: f.displayName,
    totalItemCount: f.totalItemCount,
    unreadItemCount: f.unreadItemCount,
    parentFolderId: f.parentFolderId,
  }));

  const result: any[] = [];
  for (const folder of folders) {
    result.push(folder);
    try {
      const childData = await graphGet(`/me/mailFolders/${folder.id}/childFolders?$top=50&$select=id,displayName,totalItemCount,unreadItemCount,parentFolderId`);
      for (const child of (childData.value || [])) {
        result.push({
          id: child.id,
          displayName: child.displayName,
          totalItemCount: child.totalItemCount,
          unreadItemCount: child.unreadItemCount,
          parentFolderId: child.parentFolderId,
        });
      }
    } catch {}
  }
  return result;
}

export async function sendMail(options: {
  to: string[];
  cc?: string[];
  subject: string;
  body: string;
  bodyType?: "Text" | "HTML";
}): Promise<void> {
  await graphPost("/me/sendMail", {
    message: {
      subject: options.subject,
      body: { contentType: options.bodyType || "Text", content: options.body },
      toRecipients: options.to.map(addr => ({ emailAddress: { address: addr } })),
      ccRecipients: (options.cc || []).map(addr => ({ emailAddress: { address: addr } })),
    },
    saveToSentItems: true,
  });
}

export async function replyToMessage(messageId: string, comment: string, replyAll: boolean = false): Promise<void> {
  const endpoint = replyAll ? "replyAll" : "reply";
  await graphPost(`/me/messages/${messageId}/${endpoint}`, {
    comment,
  });
}

export async function forwardMessage(messageId: string, comment: string, toRecipients: string[]): Promise<void> {
  await graphPost(`/me/messages/${messageId}/forward`, {
    comment,
    toRecipients: toRecipients.map(addr => ({ emailAddress: { address: addr } })),
  });
}

export async function getJoinedTeams(): Promise<any[]> {
  try {
    const data = await graphGet("/me/joinedTeams?$select=id,displayName,description");
    return (data.value || []).map((t: any) => ({
      id: t.id,
      displayName: t.displayName,
      description: t.description || null,
    }));
  } catch (err: any) {
    console.warn("[Teams] Failed to fetch joined teams:", err.message);
    return [];
  }
}

export async function getTeamChannels(teamId: string): Promise<any[]> {
  try {
    const data = await graphGet(`/teams/${teamId}/channels?$select=id,displayName,description,membershipType`);
    return (data.value || []).map((ch: any) => ({
      id: ch.id,
      displayName: ch.displayName,
      description: ch.description || null,
      membershipType: ch.membershipType || "standard",
    }));
  } catch (err: any) {
    console.warn("[Teams] Failed to fetch channels for team", teamId, err.message);
    return [];
  }
}

export async function getMyChats(top: number = 30): Promise<any[]> {
  try {
    const data = await graphGet(`/me/chats?$top=${top}&$expand=members&$select=id,topic,chatType,lastUpdatedDateTime`);
    return (data.value || []).map((chat: any) => ({
      id: chat.id,
      topic: chat.topic || null,
      chatType: chat.chatType,
      lastUpdatedDateTime: chat.lastUpdatedDateTime,
      members: (chat.members || []).map((m: any) => ({
        displayName: m.displayName,
        email: m.email,
      })),
    }));
  } catch (err: any) {
    console.warn("[Teams] Failed to fetch chats:", err.message);
    return [];
  }
}

export async function discoverSharePointSites(): Promise<any[]> {
  try {
    const data = await graphGet("/sites?search=*&$select=id,displayName,webUrl&$top=30");
    return (data.value || []).map((site: any) => ({
      id: site.id,
      displayName: site.displayName,
      webUrl: site.webUrl,
    }));
  } catch (err: any) {
    console.warn("[SharePoint] Failed to discover sites:", err.message);
    return [];
  }
}

export async function getSiteDrives(siteId: string): Promise<any[]> {
  try {
    const data = await graphGet(`/sites/${siteId}/drives?$select=id,name,driveType,webUrl`);
    return (data.value || []).map((d: any) => ({
      id: d.id,
      name: d.name,
      driveType: d.driveType,
      webUrl: d.webUrl,
    }));
  } catch (err: any) {
    console.warn("[SharePoint] Failed to get drives for site", siteId, err.message);
    return [];
  }
}

export async function sendApprovalEmail(options: {
  to: string;
  subject: string;
  approvalTitle: string;
  approvalDescription: string;
  approveUrl: string;
  rejectUrl: string;
}): Promise<void> {
  const htmlBody = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <h2 style="color: #1a1a1a;">Approval Required</h2>
      <h3 style="color: #333;">${options.approvalTitle}</h3>
      <p style="color: #666;">${options.approvalDescription}</p>
      <div style="margin: 24px 0;">
        <a href="${options.approveUrl}" 
           style="display: inline-block; padding: 12px 24px; background-color: #16a34a; color: white; text-decoration: none; border-radius: 6px; margin-right: 12px; font-weight: bold;">
          Approve
        </a>
        <a href="${options.rejectUrl}" 
           style="display: inline-block; padding: 12px 24px; background-color: #dc2626; color: white; text-decoration: none; border-radius: 6px; font-weight: bold;">
          Reject
        </a>
      </div>
      <p style="color: #999; font-size: 12px;">This email was sent from Emergent Energy Dashboard. Please click one of the buttons above to respond.</p>
    </div>
  `;

  await graphPost("/me/sendMail", {
    message: {
      subject: options.subject,
      body: { contentType: "HTML", content: htmlBody },
      toRecipients: [{ emailAddress: { address: options.to } }],
    },
    saveToSentItems: true,
  });
}
