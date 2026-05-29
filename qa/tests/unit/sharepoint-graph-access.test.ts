import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../../../server/lib/api-error";

const { getSharePointTokenMock } = vi.hoisted(() => ({
  getSharePointTokenMock: vi.fn(async () => graphJwt({ scp: "Sites.Read.All Files.Read.All" })),
}));

vi.mock("../../../server/sharepoint-token", () => ({
  getSharePointToken: getSharePointTokenMock,
}));

vi.mock("../../../server/storage", () => ({
  storage: {},
}));

import {
  listFolderChildren,
  normalizeSharePointFolderPath,
  testConnection,
} from "../../../server/sharepoint";
import { listChildren as listDocumentChildren } from "../../../server/services/sharepoint-document-service";

function mockGraphResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: vi.fn(async () => body),
    text: vi.fn(async () => JSON.stringify(body)),
    arrayBuffer: vi.fn(async () => new ArrayBuffer(0)),
    headers: new Headers(),
  } as unknown as Response;
}

function graphJwt(claims: Record<string, unknown>): string {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return [
    encode({ alg: "none", typ: "JWT" }),
    encode({
      aud: "https://graph.microsoft.com",
      tid: "tenant-123",
      oid: "principal-456",
      exp: Math.floor(Date.now() / 1000) + 3600,
      ...claims,
    }),
    "",
  ].join(".");
}

describe("SharePoint Graph access helpers", () => {
  const originalUseMockConnectors = process.env.USE_MOCK_CONNECTORS;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.USE_MOCK_CONNECTORS = "false";
    getSharePointTokenMock.mockResolvedValue(graphJwt({ scp: "Sites.Read.All Files.Read.All" }));
  });

  afterEach(() => {
    if (originalUseMockConnectors === undefined) {
      delete process.env.USE_MOCK_CONNECTORS;
    } else {
      process.env.USE_MOCK_CONNECTORS = originalUseMockConnectors;
    }
  });

  it("normalizes configured folder paths before building Graph URLs", async () => {
    const fetchMock = vi.fn(async () => mockGraphResponse({ value: [] }));
    vi.stubGlobal("fetch", fetchMock);

    expect(normalizeSharePointFolderPath(" /Emergent Energy Team Folder/01 - Clients/0.Active Trackers/ ")).toBe(
      "Emergent Energy Team Folder/01 - Clients/0.Active Trackers",
    );

    await listFolderChildren("drive-1", undefined, "/Emergent Energy Team Folder/01 - Clients/0.Active Trackers/");

    expect(fetchMock).toHaveBeenCalledWith(
      "https://graph.microsoft.com/v1.0/drives/drive-1/root:/Emergent%20Energy%20Team%20Folder/01%20-%20Clients/0.Active%20Trackers:/children?$filter=file ne null",
      expect.any(Object),
    );
  });

  it("validates the configured folder during Test Connection", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(mockGraphResponse({ displayName: "Emergent" }))
      .mockResolvedValueOnce(mockGraphResponse({ name: "Documents" }))
      .mockResolvedValueOnce(mockGraphResponse({ id: "folder-1", name: "Active Trackers", folder: {} }))
      .mockResolvedValueOnce(mockGraphResponse({ value: [] }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await testConnection("site-1", "drive-1", undefined, "/Active Trackers");

    expect(result.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(fetchMock).toHaveBeenLastCalledWith(
      "https://graph.microsoft.com/v1.0/drives/drive-1/root:/Active%20Trackers:/children",
      expect.any(Object),
    );
  });

  it("returns a complete health check with first five tracker filenames", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(mockGraphResponse({ displayName: "Emergent Energy" }))
      .mockResolvedValueOnce(mockGraphResponse({ name: "Documents" }))
      .mockResolvedValueOnce(mockGraphResponse({ id: "folder-1", name: "0.Active Trackers", folder: {} }))
      .mockResolvedValueOnce(mockGraphResponse({
        value: [
          { id: "1", name: "A Tracker.xlsx", file: {} },
          { id: "2", name: "B Tracker.xlsm", file: {} },
          { id: "3", name: "Notes.docx", file: {} },
          { id: "4", name: "C Tracker.xls", file: {} },
          { id: "5", name: "D Tracker.xlsx", file: {} },
          { id: "6", name: "E Tracker.xlsx", file: {} },
          { id: "7", name: "F Tracker.xlsx", file: {} },
        ],
      }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await testConnection(
      "emergy.sharepoint.com,e0336ede-5750-45b9-8a8a-19db561930c4,9acfecf2-4047-4d7b-9ec8-592b51a52bf7",
      "b!drive",
      undefined,
      "Emergent Energy Team Folder/01 - Clients/0.Active Trackers",
    );

    expect(result).toMatchObject({
      ok: true,
      success: true,
      siteReachable: true,
      driveReachable: true,
      folderReachable: true,
      fileCount: 6,
      firstFiveTrackerFilenames: [
        "A Tracker.xlsx",
        "B Tracker.xlsm",
        "C Tracker.xls",
        "D Tracker.xlsx",
        "E Tracker.xlsx",
      ],
    });
    expect(result.checks?.map((check) => check.name)).toEqual(["site", "drive", "folder", "children"]);
    expect(result.diagnostics?.config).toMatchObject({
      siteIdLength: 95,
      driveIdLength: 7,
      folderPath: "Emergent Energy Team Folder/01 - Clients/0.Active Trackers",
    });
    expect(JSON.stringify(result)).not.toContain("Authorization");
    expect(JSON.stringify(result)).not.toContain("Bearer");
  });

  it("classifies a SharePoint token without Sites or Files permissions as missing_scope", async () => {
    getSharePointTokenMock.mockResolvedValue(graphJwt({ scp: "User.Read Mail.Read" }));
    const fetchMock = vi.fn(async () => mockGraphResponse({ displayName: "should not be called" }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await testConnection("site-1", "drive-1", undefined, "Active Trackers");

    expect(result.ok).toBe(false);
    expect(result.failureCategory).toBe("missing_scope");
    expect(result.message).toContain("missing SharePoint Graph permission");
    expect(result.diagnostics?.token).toMatchObject({
      exists: true,
      tokenType: "delegated",
      tenantId: "tenant-123",
      principalId: "principal-456",
      scopes: ["Mail.Read", "User.Read"],
      roles: [],
      hasRequiredSharePointAccess: false,
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain(getSharePointTokenMock);
  });

  it("accepts an app-only token whose Sites.Read.All arrives as a role claim", async () => {
    // App-only (client-credentials) tokens carry Graph Application permissions
    // in the `roles` claim, not the delegated `scp` claim. The health check
    // must treat that as valid SharePoint access (option-3 token source).
    getSharePointTokenMock.mockResolvedValue(graphJwt({ roles: ["Sites.Read.All"] }));
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(mockGraphResponse({ displayName: "Emergent" }))
      .mockResolvedValueOnce(mockGraphResponse({ name: "Documents" }))
      .mockResolvedValueOnce(mockGraphResponse({ id: "folder-1", name: "Active Trackers", folder: {} }))
      .mockResolvedValueOnce(mockGraphResponse({ value: [] }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await testConnection("site-1", "drive-1", undefined, "Active Trackers");

    expect(result.ok).toBe(true);
    expect(result.diagnostics?.token).toMatchObject({
      exists: true,
      tokenType: "app-only",
      scopes: [],
      roles: ["Sites.Read.All"],
      hasRequiredSharePointAccess: true,
    });
  });

  it("classifies the current drive denial symptom with endpoint, status, and Graph error details", async () => {
    const driveDeniedBody = {
      error: {
        code: "accessDenied",
        message: "Access denied",
        innerError: {
          date: "2026-05-21T10:00:00",
          "request-id": "request-123",
        },
      },
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(mockGraphResponse({ displayName: "Emergent" }))
      .mockResolvedValueOnce(mockGraphResponse(driveDeniedBody, 403));
    vi.stubGlobal("fetch", fetchMock);

    const result = await testConnection("site-1", "drive-1", undefined, "Active Trackers");

    expect(result.ok).toBe(false);
    expect(result.failureCategory).toBe("403");
    expect(result.message).toBe("SharePoint denied access to get SharePoint drive.");
    expect(result.checks?.find((check) => check.name === "drive")).toMatchObject({
      endpoint: "https://graph.microsoft.com/v1.0/drives/drive-1",
      httpStatus: 403,
      graphErrorCode: "accessDenied",
      graphErrorMessage: "Access denied",
    });
    expect(result.diagnostics?.token?.hasRequiredSharePointAccess).toBe(true);
    expect(JSON.stringify(result)).not.toContain("Bearer");
  });

  it("maps Graph accessDenied to a typed 403 ApiError instead of a generic server error", async () => {
    const graphBody = {
      error: {
        code: "accessDenied",
        message: "Access denied",
        innerError: {
          date: "2026-05-18T08:45:47",
          "request-id": "86d229ac-8bfd-4628-96df-c18e0447c208",
        },
      },
    };
    vi.stubGlobal("fetch", vi.fn(async () => mockGraphResponse(graphBody, 403)));

    await expect(listFolderChildren("drive-1", undefined, "Active Trackers")).rejects.toMatchObject({
      statusCode: 403,
      code: "SHAREPOINT_ACCESS_DENIED",
      message: "SharePoint denied access to list folder children.",
      details: {
        graphCode: "accessDenied",
        requestId: "86d229ac-8bfd-4628-96df-c18e0447c208",
      },
    } satisfies Partial<ApiError>);
  });

  it("maps document-management Graph denials to the same actionable access error", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => mockGraphResponse({
      error: {
        code: "accessDenied",
        message: "Access denied",
      },
    }, 403)));

    await expect(listDocumentChildren("drive-1", null)).rejects.toMatchObject({
      statusCode: 403,
      code: "SHAREPOINT_ACCESS_DENIED",
      message: "SharePoint denied access to listChildren.",
      nextAction: "Grant the connected Microsoft account and signed-in user access to the SharePoint site/library, and ensure Graph Sites/Files permissions have admin consent.",
    } satisfies Partial<ApiError>);
  });
});
