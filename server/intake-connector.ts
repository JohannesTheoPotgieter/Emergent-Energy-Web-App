import { db } from "./db";
import { eq } from "drizzle-orm";
import { mockSpItems } from "@shared/schema";
import type { SpListItem } from "./sharepoint-list";
import {
  getListItems as spGetListItems,
  updateListItemFields as spUpdateListItemFields,
  getListColumns as spGetListColumns,
  normalizeClientKey,
  hashFields,
  mapSpFieldsToApp,
  DEFAULT_COLUMN_MAP,
  getConfig,
  saveConfig,
  isSharePointListConfigured,
} from "./sharepoint-list";

export interface IntakeConnector {
  name: string;
  fetchItems(siteId: string, listId: string, filter?: string): Promise<SpListItem[]>;
  updateItem(siteId: string, listId: string, itemId: string, fields: Record<string, any>): Promise<any>;
  getColumns(siteId: string, listId: string): Promise<{ name: string; displayName: string; columnType: string; readOnly: boolean; choices?: string[] }[]>;
  isAvailable(): boolean;
}

export class SharePointConnector implements IntakeConnector {
  name = "SharePoint";

  private ensureAvailable() {
    if (!isSharePointListConfigured()) {
      throw new Error("SharePoint integration pending approval — connector not configured. Use QA Mode with MockConnector for testing.");
    }
  }

  async fetchItems(siteId: string, listId: string, filter?: string): Promise<SpListItem[]> {
    this.ensureAvailable();
    return spGetListItems(siteId, listId, filter);
  }

  async updateItem(siteId: string, listId: string, itemId: string, fields: Record<string, any>): Promise<any> {
    this.ensureAvailable();
    return spUpdateListItemFields(siteId, listId, itemId, fields);
  }

  async getColumns(siteId: string, listId: string) {
    this.ensureAvailable();
    return spGetListColumns(siteId, listId);
  }

  isAvailable(): boolean {
    return isSharePointListConfigured();
  }
}

export class MockConnector implements IntakeConnector {
  name = "Mock";

  async fetchItems(_siteId: string, _listId: string, filter?: string): Promise<SpListItem[]> {
    const items = await db.select().from(mockSpItems);
    let result: SpListItem[] = items.map(item => ({
      id: item.mockItemId,
      fields: item.fields as Record<string, any>,
      etag: item.etag || `"mock-etag-${item.mockItemId}"`,
      createdDateTime: item.createdDateTime || item.createdAt.toISOString(),
      lastModifiedDateTime: item.lastModifiedDateTime || item.updatedAt.toISOString(),
    }));

    if (filter) {
      const match = filter.match(/^(\w+)\s+eq\s+'(.+)'$/);
      if (match) {
        const [, fieldName, value] = match;
        result = result.filter(item => {
          const fieldVal = item.fields[fieldName];
          return fieldVal && String(fieldVal) === value;
        });
      }
    }

    return result;
  }

  async updateItem(_siteId: string, _listId: string, itemId: string, fields: Record<string, any>): Promise<any> {
    const [existing] = await db.select().from(mockSpItems)
      .where(eq(mockSpItems.mockItemId, itemId));

    if (!existing) {
      throw new Error(`Mock item ${itemId} not found`);
    }

    const currentFields = existing.fields as Record<string, any>;
    const updatedFields = { ...currentFields, ...fields };

    await db.update(mockSpItems)
      .set({
        fields: updatedFields,
        lastModifiedDateTime: new Date().toISOString(),
        updatedAt: new Date(),
      })
      .where(eq(mockSpItems.mockItemId, itemId));

    return updatedFields;
  }

  async getColumns(_siteId: string, _listId: string) {
    return [
      { name: "Title", displayName: "Title", columnType: "text", readOnly: false },
      { name: "Client", displayName: "Client", columnType: "text", readOnly: false },
      { name: "DueDate", displayName: "Due Date", columnType: "dateTime", readOnly: false },
      { name: "Request_x0020_Type", displayName: "Request Type", columnType: "choice", readOnly: false, choices: ["First Assessment", "Cost Proposal", "Site Visit Report", "Meter Installation", "Data Analysis Request", "Sizing Rational Request"] },
      { name: "Priority", displayName: "Priority", columnType: "choice", readOnly: false, choices: ["Critical", "Urgent", "High", "Medium", "Low"] },
      { name: "Status", displayName: "Status", columnType: "choice", readOnly: false, choices: ["New", "In Progress", "Awaiting CP", "CP Signed", "Design Complete", "On Hold", "Cancelled", "Complete", "Blocked"] },
      { name: "Number_x0020_of_x0020_Reworks", displayName: "Number of Reworks", columnType: "number", readOnly: false },
      { name: "Project_x0020_Developer", displayName: "Project Developer", columnType: "personOrGroup", readOnly: false },
      { name: "Designer", displayName: "Designer", columnType: "personOrGroup", readOnly: false },
      { name: "Size_x0020_in_x0020_kWp", displayName: "Size in kWp", columnType: "number", readOnly: false },
      { name: "Province", displayName: "Province", columnType: "choice", readOnly: false, choices: ["Gauteng", "Western Cape", "KwaZulu-Natal", "Limpopo", "Mpumalanga", "Free State", "Eastern Cape", "North West", "Northern Cape"] },
      { name: "GPS", displayName: "GPS", columnType: "text", readOnly: false },
      { name: "Funding_x0020_Type", displayName: "Funding Type", columnType: "choice", readOnly: false, choices: ["PPA", "Rental", "Cash", "Lease", "PPA, Rental"] },
      { name: "Bills_x002f_Tariff_x0020_data", displayName: "Bills/Tariff data", columnType: "text", readOnly: false },
      { name: "Metering_x0020_data", displayName: "Metering data", columnType: "text", readOnly: false },
      { name: "Site_x0020_inspection_x0020_form", displayName: "Site inspection form", columnType: "text", readOnly: false },
      { name: "Comments", displayName: "Comments", columnType: "text", readOnly: false },
      { name: "Working_x0020_schedule", displayName: "Working schedule", columnType: "text", readOnly: false },
      { name: "Batteries_x0020_needed", displayName: "Batteries needed", columnType: "choice", readOnly: false, choices: ["Yes", "No", "TBD"] },
      { name: "Battery_x0020_Size", displayName: "Battery Size", columnType: "text", readOnly: false },
      { name: "Diesel_x0020_Gen_x0020_integration_x0020_needed", displayName: "Diesel Gen integration needed", columnType: "choice", readOnly: false, choices: ["Yes", "No", "TBD"] },
      { name: "Roof_x0020_replacement_x0020_needed", displayName: "Roof replacement needed", columnType: "choice", readOnly: false, choices: ["Yes", "No", "TBD"] },
      { name: "HSE_x0020_Discussed", displayName: "HSE Discussed", columnType: "choice", readOnly: false, choices: ["Yes", "No"] },
      { name: "ClickUpSynced", displayName: "ClickUpSynced", columnType: "text", readOnly: false },
      { name: "Days_x0020_in_x0020_progress", displayName: "Days in progress", columnType: "number", readOnly: false },
    ];
  }

  isAvailable(): boolean {
    return true;
  }
}

let activeConnector: IntakeConnector | null = null;

export function getConnector(): IntakeConnector {
  if (activeConnector) return activeConnector;

  if (isSharePointListConfigured()) {
    activeConnector = new SharePointConnector();
    console.log("[Connector] Using SharePoint connector");
  } else {
    activeConnector = new MockConnector();
    console.log("[Connector] Using Mock connector (SharePoint not available)");
  }

  return activeConnector;
}

export function setConnector(connector: IntakeConnector) {
  activeConnector = connector;
  console.log(`[Connector] Switched to ${connector.name} connector`);
}

export function resetConnector() {
  activeConnector = null;
}

export { normalizeClientKey, hashFields, mapSpFieldsToApp, DEFAULT_COLUMN_MAP, getConfig, saveConfig, isSharePointListConfigured };
