import { Client } from "@microsoft/microsoft-graph-client";

// -- Replit Connector-based Outlook integration --
// OAuth is managed by the Replit connector. Access tokens are fetched
// from the connector API automatically, including refresh handling.

let connectionSettings: any;

async function getAccessToken(): Promise<string> {
  if (
    connectionSettings &&
    connectionSettings.settings?.expires_at &&
    new Date(connectionSettings.settings.expires_at).getTime() > Date.now()
  ) {
    return connectionSettings.settings.access_token;
  }

  const hostname = process.env.REPLIT_CONNECTORS_HOSTNAME;
  const xReplitToken = process.env.REPL_IDENTITY
    ? "repl " + process.env.REPL_IDENTITY
    : process.env.WEB_REPL_RENEWAL
      ? "depl " + process.env.WEB_REPL_RENEWAL
      : null;

  if (!xReplitToken) {
    throw new Error("Replit connector token not available.");
  }

  const res = await fetch(
    "https://" + hostname + "/api/v2/connection?include_secrets=true&connector_names=outlook",
    {
      headers: {
        Accept: "application/json",
        X_REPLIT_TOKEN: xReplitToken,
      },
    },
  );

  const data = await res.json();
  connectionSettings = data.items?.[0];

  const accessToken =
    connectionSettings?.settings?.access_token ||
    connectionSettings?.settings?.oauth?.credentials?.access_token;

  if (!connectionSettings || !accessToken) {
    throw new Error("Outlook not connected via Replit connector.");
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
