/**
 * SharePoint doc-control integration (D3.5).
 *
 * The server side of "submit draft → move to Approved on approval →
 * supersede previous approved into History". Mock-connector aware:
 * when MS Graph creds are absent in dev, calls no-op + return fixture
 * paths so the flow still exercises end-to-end.
 *
 * The surface is deliberately small and function-based so it can be
 * called from the controlled-documents-repository's approval hook
 * when a document is promoted to state='approved'.
 *
 * CLAUDE.md rules:
 *   - Metadata only. Never fetch or stash file bodies.
 *   - Mock-connector mode is NODE_ENV-gated (connector-mode.ts).
 *   - COO-only for manual sync triggers (enforced in routes).
 */

import { isConnectorMocked, logConnectorModeOnce } from "../lib/connector-mode";
import logger from "../lib/logger";

export interface SharepointFileRef {
  driveId: string;
  itemId: string;
  path: string;
  fileName: string;
  webUrl?: string;
}

export interface DraftFileCandidate extends SharepointFileRef {
  lastModifiedAt?: string;
  sizeBytes?: number;
}

/**
 * List draft files in a project's Drafts/<typeSubPath>/Drafts folder.
 *
 * In mock mode: returns three fixture files so the UI picker has
 * something to show without real SharePoint access.
 *
 * In real mode: reads from Graph
 *   /drives/{driveId}/root:/{rootPath}/{typeSubPath}/Drafts:/children
 * and filters to files (not folders). Left as a stub that throws
 * informatively when creds are present but Graph client isn't wired
 * yet — the Graph client bring-up is a separate commit.
 */
export async function listDraftFiles(
  driveId: string | null,
  projectRootPath: string,
  typeSubPath: string,
): Promise<DraftFileCandidate[]> {
  logConnectorModeOnce("ms-graph");
  if (isConnectorMocked("ms-graph")) {
    // Fixture set — 3 candidate files simulating a typical working folder.
    const draftsPath = `${projectRootPath}/${typeSubPath}/Drafts`;
    return [
      {
        driveId: "mock-drive-id",
        itemId: "mock-item-1",
        path: `${draftsPath}/Costing_v1_draft.xlsx`,
        fileName: "Costing_v1_draft.xlsx",
        webUrl: `https://mock.sharepoint.example/items/${encodeURIComponent(draftsPath)}/Costing_v1_draft.xlsx`,
        lastModifiedAt: new Date(Date.now() - 2 * 86_400_000).toISOString(),
        sizeBytes: 32_000,
      },
      {
        driveId: "mock-drive-id",
        itemId: "mock-item-2",
        path: `${draftsPath}/Costing_v2_draft.xlsx`,
        fileName: "Costing_v2_draft.xlsx",
        webUrl: `https://mock.sharepoint.example/items/${encodeURIComponent(draftsPath)}/Costing_v2_draft.xlsx`,
        lastModifiedAt: new Date(Date.now() - 86_400_000).toISOString(),
        sizeBytes: 34_000,
      },
      {
        driveId: "mock-drive-id",
        itemId: "mock-item-3",
        path: `${draftsPath}/Costing_final_draft.xlsx`,
        fileName: "Costing_final_draft.xlsx",
        webUrl: `https://mock.sharepoint.example/items/${encodeURIComponent(draftsPath)}/Costing_final_draft.xlsx`,
        lastModifiedAt: new Date(Date.now() - 3_600_000).toISOString(),
        sizeBytes: 36_000,
      },
    ];
  }

  throw new Error(
    "Real SharePoint Graph client not yet wired — set USE_MOCK_CONNECTORS=true " +
    "to exercise the flow against fixtures, or wire the Graph driveItems call in " +
    "listDraftFiles() when tenant credentials are configured.",
  );
}

export interface MoveResult {
  newPath: string;
  previousPath: string;
}

/**
 * Promote a draft file: move from Drafts/ → Approved/. If an Approved
 * file already exists for this type, move it to History/ with a
 * version suffix before the new draft takes its place.
 *
 * Mock mode: returns plausible paths + logs; no real file move.
 * Real mode: calls Graph PATCH /drives/{driveId}/items/{itemId} with
 * parentReference targeting the Approved folder item, then issues
 * the same call for the superseded file targeting History with
 * filename prefix `v{N}_`.
 *
 * In both modes returns the new path + the previous approved path
 * (null if none) so the repository can update the document rows.
 */
export async function promoteDraftToApproved(params: {
  draftFile: SharepointFileRef;
  projectRootPath: string;
  typeSubPath: string;
  previousApproved: SharepointFileRef | null;
  newVersionNumber: number;
}): Promise<MoveResult & { supersededPath: string | null }> {
  logConnectorModeOnce("ms-graph");
  const approvedPath = `${params.projectRootPath}/${params.typeSubPath}/Approved/${params.draftFile.fileName}`;
  const supersededPath = params.previousApproved
    ? `${params.projectRootPath}/${params.typeSubPath}/History/v${params.newVersionNumber - 1}_${params.previousApproved.fileName}`
    : null;

  if (isConnectorMocked("ms-graph")) {
    logger.info(
      `[sharepoint-doc-control mock] promoteDraftToApproved: ` +
      `${params.draftFile.path} -> ${approvedPath}` +
      (supersededPath ? `; superseded ${params.previousApproved!.path} -> ${supersededPath}` : ""),
    );
    return {
      newPath: approvedPath,
      previousPath: params.draftFile.path,
      supersededPath,
    };
  }

  throw new Error(
    "Real SharePoint Graph client not yet wired for promoteDraftToApproved. " +
    "Set USE_MOCK_CONNECTORS=true for dev, or wire the Graph driveItems " +
    "move call here.",
  );
}

/**
 * Ensure the subfolders exist under a project's root: <typeSubPath>/Drafts,
 * <typeSubPath>/Approved, <typeSubPath>/History. Called lazily on the
 * first document-control action for a type.
 *
 * Mock mode: no-op + log.
 * Real mode: issue Graph `POST /drives/{driveId}/root:/{path}:/children`
 * with folder bodies, idempotent per Graph's conflictBehavior=replace.
 */
export async function ensureDocControlFolders(params: {
  driveId: string | null;
  projectRootPath: string;
  typeSubPath: string;
}): Promise<void> {
  logConnectorModeOnce("ms-graph");
  if (isConnectorMocked("ms-graph")) {
    logger.info(
      `[sharepoint-doc-control mock] ensureDocControlFolders at ` +
      `${params.projectRootPath}/${params.typeSubPath}/{Drafts,Approved,History}`,
    );
    return;
  }

  throw new Error(
    "Real SharePoint Graph folder-creation not yet wired for " +
    "ensureDocControlFolders. Mock path works in dev.",
  );
}
