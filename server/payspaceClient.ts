import crypto from "crypto";

export interface PayspaceLeaveRecord {
  externalLeaveId: string;
  employeeId: string;
  employeeFirstName: string;
  employeeSurname: string;
  leaveType: string;
  startDate: string; // YYYY-MM-DD
  endDate: string; // YYYY-MM-DD
  status: string;
  approvedAt?: string;
  approvedBy?: string;
}

export interface PayspaceConfig {
  apiBaseUrl: string;
  companyCode: string;
  authMode: "oauth" | "basic" | "token" | "soap";
  username?: string;
  password?: string;
  token?: string;
}

export function computeLeaveHash(record: PayspaceLeaveRecord): string {
  const payload = [
    record.externalLeaveId,
    record.employeeId,
    record.employeeFirstName,
    record.employeeSurname,
    record.leaveType,
    record.startDate,
    record.endDate,
    record.status,
    record.approvedBy || "",
  ].join("|");
  return crypto.createHash("sha256").update(payload).digest("hex").substring(0, 16);
}

export function formatDisplayName(firstName: string, surname: string, showFullSurname: boolean): string {
  if (!firstName) return "Unknown";
  const initial = surname ? surname.charAt(0).toUpperCase() : "";
  return showFullSurname ? `${firstName} ${surname}` : `${firstName} ${initial}`;
}

export async function fetchApprovedLeave(
  config: PayspaceConfig,
  fromDate: string,
  toDate: string
): Promise<PayspaceLeaveRecord[]> {
  if (!config.apiBaseUrl || !config.companyCode) {
    throw new Error("PaySpace integration not configured. Please set API base URL and company code in settings.");
  }

  const baseUrl = config.apiBaseUrl.replace(/\/$/, "");
  
  // Build auth headers based on mode
  const headers: Record<string, string> = {
    "Accept": "application/json",
    "Content-Type": "application/json",
  };

  if (config.authMode === "basic" && config.username && config.password) {
    headers["Authorization"] = `Basic ${Buffer.from(`${config.username}:${config.password}`).toString("base64")}`;
  } else if (config.authMode === "token" && config.token) {
    headers["Authorization"] = `Bearer ${config.token}`;
  } else if (config.authMode === "oauth") {
    // For OAuth, attempt to get a token first
    if (!config.username || !config.password) {
      throw new Error("OAuth credentials not configured. Please provide client ID and secret.");
    }
    try {
      const tokenRes = await fetch(`${baseUrl}/oauth/token`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "client_credentials",
          client_id: config.username,
          client_secret: config.password,
          scope: "api",
        }),
      });
      if (!tokenRes.ok) {
        throw new Error(`OAuth token request failed: ${tokenRes.status} ${await tokenRes.text()}`);
      }
      const tokenData = await tokenRes.json();
      headers["Authorization"] = `Bearer ${tokenData.access_token}`;
    } catch (err: any) {
      throw new Error(`Failed to authenticate with PaySpace: ${err.message}`);
    }
  } else {
    throw new Error(`Authentication not configured for mode: ${config.authMode}. Please configure credentials in settings.`);
  }

  // Fetch leave transactions
  const url = `${baseUrl}/api/v1/companies/${encodeURIComponent(config.companyCode)}/leave?fromDate=${fromDate}&toDate=${toDate}&status=approved`;
  
  try {
    const res = await fetch(url, { headers });
    if (!res.ok) {
      const errorText = await res.text();
      throw new Error(`PaySpace API error ${res.status}: ${errorText}`);
    }
    const data = await res.json();
    
    // Normalize response - PaySpace may return data in various formats
    const records: any[] = Array.isArray(data) ? data : (data.data || data.results || data.items || []);
    
    return records.map((r: any, idx: number) => ({
      externalLeaveId: String(r.LeaveTransactionId || r.leaveTransactionId || r.id || `${config.companyCode}-${idx}`),
      employeeId: String(r.EmployeeNumber || r.employeeNumber || r.employeeId || ""),
      employeeFirstName: r.FirstName || r.firstName || r.EmployeeFirstName || "",
      employeeSurname: r.Surname || r.surname || r.LastName || r.lastName || r.EmployeeSurname || "",
      leaveType: r.LeaveType || r.leaveType || r.LeaveTypeName || "Unknown",
      startDate: normalizeDate(r.StartDate || r.startDate || r.FromDate || r.fromDate),
      endDate: normalizeDate(r.EndDate || r.endDate || r.ToDate || r.toDate),
      status: (r.Status || r.status || "approved").toLowerCase(),
      approvedAt: r.ApprovedDate || r.approvedDate || r.ApprovalDate || undefined,
      approvedBy: r.ApprovedBy || r.approvedBy || r.ApproverName || undefined,
    }));
  } catch (err: any) {
    if (err.message.includes("PaySpace API error")) throw err;
    throw new Error(`Failed to connect to PaySpace: ${err.message}. Verify the API base URL is correct and accessible.`);
  }
}

function normalizeDate(dateStr: string): string {
  if (!dateStr) return new Date().toISOString().split("T")[0];
  // Handle ISO dates, .NET dates, etc.
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    return d.toISOString().split("T")[0];
  } catch {
    return dateStr;
  }
}

export async function testConnection(config: PayspaceConfig): Promise<{ success: boolean; message: string }> {
  try {
    // Try a lightweight call to verify credentials work
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const today = new Date().toISOString().split("T")[0];
    const tomorrowStr = tomorrow.toISOString().split("T")[0];
    
    await fetchApprovedLeave(config, today, tomorrowStr);
    return { success: true, message: "Successfully connected to PaySpace API." };
  } catch (err: any) {
    return { success: false, message: err.message };
  }
}
