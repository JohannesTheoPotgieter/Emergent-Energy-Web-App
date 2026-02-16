import { ConfidentialClientApplication, type AuthorizationCodeRequest, type AuthorizationUrlRequest } from "@azure/msal-node";
import crypto from "crypto";
import { db } from "./db";
import { outlookAccounts } from "@shared/schema";
import { eq } from "drizzle-orm";

function getEncryptionKey(): string {
  const key = process.env.OUTLOOK_ENCRYPTION_KEY;
  if (!key || key.length < 64) {
    throw new Error("OUTLOOK_ENCRYPTION_KEY must be set (64-char hex string) for Outlook integration.");
  }
  return key;
}

const ALGORITHM = "aes-256-gcm";
const STATE_SECRET = process.env.SESSION_SECRET || process.env.OUTLOOK_ENCRYPTION_KEY || "outlook-state-fallback";

function encrypt(text: string): string {
  const key = Buffer.from(getEncryptionKey().slice(0, 64), "hex");
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  let encrypted = cipher.update(text, "utf8", "hex");
  encrypted += cipher.final("hex");
  const tag = cipher.getAuthTag().toString("hex");
  return `${iv.toString("hex")}:${tag}:${encrypted}`;
}

function decrypt(encrypted: string): string {
  const key = Buffer.from(getEncryptionKey().slice(0, 64), "hex");
  const [ivHex, tagHex, data] = encrypted.split(":");
  const iv = Buffer.from(ivHex, "hex");
  const tag = Buffer.from(tagHex, "hex");
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  let decrypted = decipher.update(data, "hex", "utf8");
  decrypted += decipher.final("utf8");
  return decrypted;
}

function signState(payload: object): string {
  const data = JSON.stringify({ ...payload, ts: Date.now() });
  const encoded = Buffer.from(data).toString("base64url");
  const sig = crypto.createHmac("sha256", STATE_SECRET).update(encoded).digest("base64url");
  return `${encoded}.${sig}`;
}

function verifyState(state: string): any {
  const [encoded, sig] = state.split(".");
  if (!encoded || !sig) throw new Error("Invalid state format.");
  const expected = crypto.createHmac("sha256", STATE_SECRET).update(encoded).digest("base64url");
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) {
    throw new Error("Invalid state signature.");
  }
  const payload = JSON.parse(Buffer.from(encoded, "base64url").toString());
  const age = Date.now() - (payload.ts || 0);
  if (age > 10 * 60 * 1000) throw new Error("State expired (>10 min).");
  return payload;
}

function getRedirectUri(): string {
  const base = process.env.REPLIT_DEPLOYMENT_URL || process.env.REPL_SLUG
    ? `https://${process.env.REPLIT_DEPLOYMENT_URL || `${process.env.REPL_SLUG}.${process.env.REPL_OWNER}.repl.co`}`
    : `http://localhost:5000`;
  return `${base}/api/outlook/callback`;
}

function getMsalConfig() {
  const clientId = process.env.OUTLOOK_CLIENT_ID;
  const clientSecret = process.env.OUTLOOK_CLIENT_SECRET;
  const tenantId = process.env.OUTLOOK_TENANT_ID || "common";

  if (!clientId || !clientSecret) {
    return null;
  }

  return {
    auth: {
      clientId,
      clientSecret,
      authority: `https://login.microsoftonline.com/${tenantId}`,
    },
  };
}

const SCOPES = [
  "openid",
  "profile",
  "email",
  "offline_access",
  "Calendars.Read",
  "Calendars.ReadWrite",
  "Mail.Send",
];

const MYTOOL_CALENDAR_NAME = "EE – My Tool Blocks";

export function isOutlookConfigured(): boolean {
  return !!process.env.OUTLOOK_CLIENT_ID && !!process.env.OUTLOOK_CLIENT_SECRET;
}

export async function getAuthUrl(userId: number): Promise<string> {
  const config = getMsalConfig();
  if (!config) throw new Error("Outlook integration not configured. Set OUTLOOK_CLIENT_ID and OUTLOOK_CLIENT_SECRET.");

  const cca = new ConfidentialClientApplication(config);
  const state = signState({ userId });

  const authCodeUrlParameters: AuthorizationUrlRequest = {
    scopes: SCOPES,
    redirectUri: getRedirectUri(),
    state,
    prompt: "consent",
  };

  return cca.getAuthCodeUrl(authCodeUrlParameters);
}

export async function handleCallback(code: string, state: string): Promise<{ userId: number; email: string }> {
  const config = getMsalConfig();
  if (!config) throw new Error("Outlook integration not configured.");

  const cca = new ConfidentialClientApplication(config);
  const { userId } = verifyState(state);

  const tokenRequest: AuthorizationCodeRequest = {
    code,
    scopes: SCOPES,
    redirectUri: getRedirectUri(),
  };

  const response = await cca.acquireTokenByCode(tokenRequest);
  if (!response) throw new Error("Failed to acquire token.");

  const accessToken = response.accessToken;
  const expiresOn = response.expiresOn || new Date(Date.now() + 3600 * 1000);

  const profileRes = await fetch("https://graph.microsoft.com/v1.0/me", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const profile = await profileRes.json() as any;

  const accountData = {
    userId,
    tenantId: (response as any).tenantId || process.env.OUTLOOK_TENANT_ID || null,
    outlookUserId: profile.id || null,
    accessTokenEncrypted: encrypt(accessToken),
    refreshTokenEncrypted: response.account?.homeAccountId ? encrypt(JSON.stringify({
      homeAccountId: response.account.homeAccountId,
      environment: response.account.environment,
      tenantId: response.account.tenantId,
      username: response.account.username,
    })) : null,
    tokenExpiryUtc: expiresOn,
  };

  const existing = await db.select().from(outlookAccounts).where(eq(outlookAccounts.userId, userId));
  if (existing.length > 0) {
    await db.update(outlookAccounts).set({
      ...accountData,
      connectedAt: new Date(),
    }).where(eq(outlookAccounts.userId, userId));
  } else {
    await db.insert(outlookAccounts).values(accountData);
  }

  return { userId, email: profile.mail || profile.userPrincipalName || "" };
}

export async function disconnect(userId: number): Promise<void> {
  await db.delete(outlookAccounts).where(eq(outlookAccounts.userId, userId));
}

export async function getConnectionStatus(userId: number): Promise<{
  configured: boolean;
  connected: boolean;
  email?: string;
  connectedAt?: string;
  lastSyncAt?: string;
}> {
  if (!isOutlookConfigured()) {
    return { configured: false, connected: false };
  }

  const [account] = await db.select().from(outlookAccounts).where(eq(outlookAccounts.userId, userId));
  if (!account || !account.accessTokenEncrypted) {
    return { configured: true, connected: false };
  }

  let email: string | undefined;
  try {
    const token = await getValidToken(userId);
    if (token) {
      const res = await fetch("https://graph.microsoft.com/v1.0/me", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const profile = await res.json() as any;
        email = profile.mail || profile.userPrincipalName;
      }
    }
  } catch {
    // token might be expired, still show as connected
  }

  return {
    configured: true,
    connected: true,
    email,
    connectedAt: account.connectedAt?.toISOString(),
    lastSyncAt: account.lastSyncAt?.toISOString(),
  };
}

async function getValidToken(userId: number): Promise<string | null> {
  const [account] = await db.select().from(outlookAccounts).where(eq(outlookAccounts.userId, userId));
  if (!account || !account.accessTokenEncrypted) return null;

  const now = new Date();
  if (account.tokenExpiryUtc && account.tokenExpiryUtc > now) {
    return decrypt(account.accessTokenEncrypted);
  }

  // Token expired, try to refresh using MSAL cache
  const config = getMsalConfig();
  if (!config || !account.refreshTokenEncrypted) return null;

  try {
    const cca = new ConfidentialClientApplication(config);
    const accountInfo = JSON.parse(decrypt(account.refreshTokenEncrypted));
    
    const result = await cca.acquireTokenSilent({
      scopes: SCOPES.filter(s => s !== "openid" && s !== "profile" && s !== "email" && s !== "offline_access"),
      account: accountInfo,
    });

    if (result?.accessToken) {
      await db.update(outlookAccounts).set({
        accessTokenEncrypted: encrypt(result.accessToken),
        tokenExpiryUtc: result.expiresOn || new Date(Date.now() + 3600 * 1000),
      }).where(eq(outlookAccounts.userId, userId));

      return result.accessToken;
    }
  } catch (err) {
    console.error("[Outlook] Token refresh failed:", err);
  }

  return null;
}

async function graphGet(userId: number, url: string): Promise<any> {
  const token = await getValidToken(userId);
  if (!token) throw new Error("Not connected to Outlook. Please reconnect in Settings.");

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

async function graphPost(userId: number, url: string, body: any): Promise<any> {
  const token = await getValidToken(userId);
  if (!token) throw new Error("Not connected to Outlook. Please reconnect in Settings.");

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

async function graphPatch(userId: number, url: string, body: any): Promise<any> {
  const token = await getValidToken(userId);
  if (!token) throw new Error("Not connected to Outlook.");

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

async function graphDelete(userId: number, url: string): Promise<void> {
  const token = await getValidToken(userId);
  if (!token) throw new Error("Not connected to Outlook.");

  const res = await fetch(`https://graph.microsoft.com/v1.0${url}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok && res.status !== 404) {
    const text = await res.text();
    throw new Error(`Graph API error (${res.status}): ${text}`);
  }
}

export async function getCalendarEvents(userId: number, startDate: string, endDate: string): Promise<any[]> {
  const start = `${startDate}T00:00:00`;
  const end = `${endDate}T23:59:59`;
  const url = `/me/calendarView?startDateTime=${encodeURIComponent(start)}&endDateTime=${encodeURIComponent(end)}&$select=id,subject,start,end,isAllDay,location,organizer,showAs,isCancelled,type&$top=200&$orderby=start/dateTime`;

  const data = await graphGet(userId, url);
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

async function ensureMyToolCalendar(userId: number): Promise<string> {
  const [account] = await db.select().from(outlookAccounts).where(eq(outlookAccounts.userId, userId));
  if (account?.calendarId) return account.calendarId;

  const calendarsData = await graphGet(userId, "/me/calendars?$select=id,name");
  const existing = (calendarsData.value || []).find((c: any) => c.name === MYTOOL_CALENDAR_NAME);

  let calendarId: string;
  if (existing) {
    calendarId = existing.id;
  } else {
    const created = await graphPost(userId, "/me/calendars", { name: MYTOOL_CALENDAR_NAME });
    calendarId = created.id;
  }

  await db.update(outlookAccounts).set({ calendarId }).where(eq(outlookAccounts.userId, userId));
  return calendarId;
}

export async function createOutlookEvent(userId: number, block: {
  date: string;
  startTime: string;
  endTime: string;
  label: string;
  idempotencyKey: string;
}): Promise<string> {
  const calendarId = await ensureMyToolCalendar(userId);

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
    singleValueExtendedProperties: [{
      id: "String {66f5a359-4659-4830-9070-00047ec6ac6e} Name IdempotencyKey",
      value: block.idempotencyKey,
    }],
  };

  const created = await graphPost(userId, `/me/calendars/${calendarId}/events`, event);
  return created.id;
}

export async function updateOutlookEvent(userId: number, eventId: string, calendarId: string | null, updates: {
  date?: string;
  startTime?: string;
  endTime?: string;
  label?: string;
}): Promise<void> {
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

  await graphPatch(userId, url, patch);
}

export async function deleteOutlookEvent(userId: number, eventId: string, calendarId: string | null): Promise<void> {
  const url = calendarId
    ? `/me/calendars/${calendarId}/events/${eventId}`
    : `/me/events/${eventId}`;

  await graphDelete(userId, url);
}

export async function sendApprovalEmail(userId: number, options: {
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

  await graphPost(userId, "/me/sendMail", {
    message: {
      subject: options.subject,
      body: { contentType: "HTML", content: htmlBody },
      toRecipients: [{ emailAddress: { address: options.to } }],
    },
    saveToSentItems: true,
  });
}
