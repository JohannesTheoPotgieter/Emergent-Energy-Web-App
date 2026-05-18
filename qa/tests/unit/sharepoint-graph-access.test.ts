import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../../../server/lib/api-error";

const { getSharePointTokenMock } = vi.hoisted(() => ({
  getSharePointTokenMock: vi.fn(async () => "test-token"),
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

describe("SharePoint Graph access helpers", () => {
  const originalUseMockConnectors = process.env.USE_MOCK_CONNECTORS;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.USE_MOCK_CONNECTORS = "false";
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
      "https://graph.microsoft.com/v1.0/drives/drive-1/root:/Emergent Energy Team Folder/01 - Clients/0.Active Trackers:/children?$filter=file ne null",
      expect.any(Object),
    );
  });

  it("validates the configured folder during Test Connection", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(mockGraphResponse({ displayName: "Emergent" }))
      .mockResolvedValueOnce(mockGraphResponse({ name: "Documents" }))
      .mockResolvedValueOnce(mockGraphResponse({ value: [] }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await testConnection("site-1", "drive-1", undefined, "/Active Trackers");

    expect(result.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock).toHaveBeenLastCalledWith(
      "https://graph.microsoft.com/v1.0/drives/drive-1/root:/Active Trackers:/children?$filter=file ne null",
      expect.any(Object),
    );
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
