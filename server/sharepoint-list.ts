import { db } from "./db";
import { eq } from "drizzle-orm";
import { spListConfig, type SpListConfig } from "@shared/schema";
import crypto from "crypto";

async function getAccessToken(): Promise<string> {
  const hostname = process.env.REPLIT_CONNECTORS_HOSTNAME;
  const xReplitToken = process.env.REPL_IDENTITY
    ? "repl " + process.env.REPL_IDENTITY
    : process.env.WEB_REPL_RENEWAL
      ? "depl " + process.env.WEB_REPL_RENEWAL
      : null;

  if (!hostname || !xReplitToken) {
    throw new Error("SharePoint not available - Outlook connector not configured.");
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
  const conn = data.items?.[0];
  const accessToken =
    conn?.settings?.access_token ||
    conn?.settings?.oauth?.credentials?.access_token;

  if (!accessToken) {
    throw new Error("SharePoint not connected - please set up the Outlook connector.");
  }

  return accessToken;
}

export async function graphGet(url: string): Promise<any> {
  const token = await getAccessToken();
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Graph API ${res.status}: ${text}`);
  }
  return res.json();
}

async function graphPatch(url: string, body: any): Promise<any> {
  const token = await getAccessToken();
  const res = await fetch(url, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Graph API PATCH ${res.status}: ${text}`);
  }
  if (res.status === 204) return {};
  return res.json();
}

export function normalizeClientKey(clientName: string): string {
  return clientName
    .toLowerCase()
    .trim()
    .replace(/[^\w\s]/g, "")
    .replace(/\s+/g, "_");
}

export function hashFields(obj: Record<string, any>): string {
  const sorted = JSON.stringify(obj, Object.keys(obj).sort());
  return crypto.createHash("md5").update(sorted).digest("hex");
}

export async function discoverSites(): Promise<{ id: string; displayName: string; webUrl: string }[]> {
  const result = await graphGet(
    "https://graph.microsoft.com/v1.0/sites?search=*&$select=id,displayName,webUrl&$top=50"
  );
  return (result.value || []).map((s: any) => ({
    id: s.id,
    displayName: s.displayName,
    webUrl: s.webUrl,
  }));
}

export async function discoverSiteByUrl(siteHostAndPath: string): Promise<{ id: string; displayName: string; webUrl: string }> {
  const result = await graphGet(
    `https://graph.microsoft.com/v1.0/sites/${siteHostAndPath}`
  );
  return { id: result.id, displayName: result.displayName, webUrl: result.webUrl };
}

export async function discoverLists(siteId: string): Promise<{ id: string; displayName: string; itemCount: number }[]> {
  const result = await graphGet(
    `https://graph.microsoft.com/v1.0/sites/${siteId}/lists?$select=id,displayName,list&$top=50`
  );
  const allLists = result.value || [];
  console.log(`[SP] discoverLists raw count: ${allLists.length}`);

  if (allLists.length === 0) {
    console.log(`[SP] No lists returned. Trying direct list name probes...`);
    const probeNames = [
      "Engineering Pipeline",
      "Proposals Pipeline",
      "Engineering Proposals",
      "Pipeline",
      "Tasks",
    ];
    const found: { id: string; displayName: string; itemCount: number }[] = [];
    for (const name of probeNames) {
      try {
        const probe = await graphGet(
          `https://graph.microsoft.com/v1.0/sites/${siteId}/lists/${encodeURIComponent(name)}?$select=id,displayName,list`
        );
        if (probe?.id) {
          console.log(`[SP]   probe hit: "${probe.displayName}" id=${probe.id}`);
          found.push({ id: probe.id, displayName: probe.displayName, itemCount: -1 });
        }
      } catch {
      }
    }
    return found;
  }

  return allLists
    .filter((l: any) => !l.list?.hidden)
    .map((l: any) => ({
      id: l.id,
      displayName: l.displayName,
      itemCount: l.list?.contentTypesEnabled ? -1 : 0,
    }));
}

export async function getListColumns(siteId: string, listId: string): Promise<{
  name: string; displayName: string; columnType: string; readOnly: boolean; choices?: string[];
}[]> {
  const result = await graphGet(
    `https://graph.microsoft.com/v1.0/sites/${siteId}/lists/${listId}/columns?$top=100`
  );
  return (result.value || []).map((col: any) => ({
    name: col.name,
    displayName: col.displayName,
    columnType: col.text ? "text" :
                col.number ? "number" :
                col.dateTime ? "dateTime" :
                col.boolean ? "boolean" :
                col.choice ? "choice" :
                col.personOrGroup ? "personOrGroup" :
                col.lookup ? "lookup" :
                col.hyperlinkOrPicture ? "hyperlink" :
                col.calculated ? "calculated" :
                "unknown",
    readOnly: col.readOnly || false,
    choices: col.choice?.choices || undefined,
  }));
}

export interface SpListItem {
  id: string;
  fields: Record<string, any>;
  etag?: string;
  createdDateTime?: string;
  lastModifiedDateTime?: string;
}

export async function getListItems(
  siteId: string,
  listId: string,
  filter?: string,
  select?: string[],
  top: number = 500,
): Promise<SpListItem[]> {
  let url = `https://graph.microsoft.com/v1.0/sites/${siteId}/lists/${listId}/items?$expand=fields&$top=${top}`;
  if (filter) url += `&$filter=fields/${filter}`;
  if (select && select.length > 0) url += `&$select=id,fields(${select.join(",")})`;

  const allItems: SpListItem[] = [];
  let nextLink: string | null = url;

  while (nextLink) {
    const result = await graphGet(nextLink);
    for (const item of (result.value || [])) {
      allItems.push({
        id: item.id,
        fields: item.fields || {},
        etag: item.eTag,
        createdDateTime: item.createdDateTime,
        lastModifiedDateTime: item.lastModifiedDateTime,
      });
    }
    nextLink = result["@odata.nextLink"] || null;
  }

  return allItems;
}

export async function getListItemsFiltered(
  siteId: string,
  listId: string,
  statusField: string,
  statusValue: string,
): Promise<SpListItem[]> {
  return getListItems(siteId, listId, `${statusField} eq '${statusValue}'`);
}

export async function updateListItemFields(
  siteId: string,
  listId: string,
  itemId: string,
  fields: Record<string, any>,
): Promise<any> {
  const url = `https://graph.microsoft.com/v1.0/sites/${siteId}/lists/${listId}/items/${itemId}/fields`;
  return graphPatch(url, fields);
}

function extractPersonField(val: any): string {
  if (!val) return "";
  if (typeof val === "string") return val;
  if (Array.isArray(val)) {
    return val.map((v: any) => v?.LookupValue || v?.Email || v?.displayName || String(v)).join(", ");
  }
  return val.LookupValue || val.Email || val.displayName || String(val);
}

function extractMultiChoiceField(val: any): string {
  if (!val) return "";
  if (typeof val === "string") return val;
  if (Array.isArray(val)) return val.join(", ");
  return String(val);
}

export interface ColumnMapping {
  spInternalName: string;
  spDisplayName: string;
  appField: string;
  type: string;
}

export const DEFAULT_COLUMN_MAP: Record<string, string> = {
  "Title": "clientName",
  "Client": "clientName",
  "DueDate": "dueDate",
  "Due_x0020_Date": "dueDate",
  "Days_x0020_in_x0020_progress": "daysInProgress",
  "Request_x0020_Type": "requestType",
  "RequestType": "requestType",
  "Priority": "priority",
  "Status": "status",
  "Number_x0020_of_x0020_Reworks": "numberOfReworks",
  "Project_x0020_Developer": "projectDeveloper",
  "ProjectDeveloper": "projectDeveloper",
  "Designer": "designer",
  "Size_x0020_in_x0020_kWp": "sizeKwp",
  "SizeInkWp": "sizeKwp",
  "Province": "province",
  "GPS": "gpsCoordinates",
  "Funding_x0020_Type": "fundingType",
  "FundingType": "fundingType",
  "Bills_x002f_Tariff_x0020_data": "billsTariffData",
  "Metering_x0020_data": "meteringData",
  "Site_x0020_inspection_x0020_form": "siteInspectionForm",
  "Comments": "comments",
  "Working_x0020_schedule": "workingSchedule",
  "Batteries_x0020_needed": "batteriesNeeded",
  "Battery_x0020_Size": "batterySize",
  "Diesel_x0020_Gen_x0020_integration_x0020_needed": "dieselGenNeeded",
  "Roof_x0020_replacement_x0020_needed": "roofReplacementNeeded",
  "HSE_x0020_Discussed": "hseDiscussed",
  "ClickUpSynced": "clickUpSynced",
  "ItemType": "itemType",
  "Path": "spPath",
};

export function mapSpFieldsToApp(
  fields: Record<string, any>,
  columnMapping: Record<string, string>,
  columnTypes: Record<string, string>,
): Record<string, any> {
  const result: Record<string, any> = {};

  for (const [spName, appField] of Object.entries(columnMapping)) {
    let val = fields[spName];
    if (val === undefined || val === null) continue;

    const colType = columnTypes[spName] || "text";

    if (colType === "personOrGroup") {
      val = extractPersonField(val);
    } else if (colType === "choice" && Array.isArray(val)) {
      val = extractMultiChoiceField(val);
    } else if (colType === "number") {
      val = typeof val === "number" ? val : parseFloat(String(val)) || null;
    } else if (colType === "boolean") {
      val = val === true || val === "Yes" || val === "true";
    } else {
      val = String(val);
    }

    result[appField] = val;
  }

  return result;
}

export async function getConfig(): Promise<SpListConfig | null> {
  const configs = await db.select().from(spListConfig).limit(1);
  return configs[0] || null;
}

export async function saveConfig(config: Partial<SpListConfig> & { siteId: string; listId: string }): Promise<SpListConfig> {
  const existing = await getConfig();
  if (existing) {
    const [updated] = await db.update(spListConfig)
      .set({ ...config, updatedAt: new Date() })
      .where(eq(spListConfig.id, existing.id))
      .returning();
    return updated;
  } else {
    const [created] = await db.insert(spListConfig)
      .values(config as any)
      .returning();
    return created;
  }
}

export function isSharePointListConfigured(): boolean {
  return !!process.env.REPLIT_CONNECTORS_HOSTNAME;
}
