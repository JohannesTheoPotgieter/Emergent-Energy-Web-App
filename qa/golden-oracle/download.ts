/**
 * READ-ONLY download of the 5 golden project trackers via the app's own
 * SharePoint download path (server/sharepoint.ts downloadSingleFile). No writes
 * to SharePoint or the DB. Saves workbooks + a provenance manifest under
 * qa/golden-oracle/.cache/.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { downloadSingleFile } from "../../server/sharepoint";

const DRIVE_ID = "b!3m4z4FBXuUWKihnbVhkwxPLsz5pHQHtNnshZK1GlK_crT5arPCAlRKVWkTFrsF_q";

// Discovered via qa/golden-oracle/discover.ts (live Emergent_Energy / Documents).
// Most-recent root revision per project (matches the 08/06 oracle snapshot).
const TARGETS: { projectId: number; projectName: string; itemId: string }[] = [
  { projectId: 8, projectName: "Coega Steels Ph2", itemId: "01VFF6QENCWCIQLFJU5RBKIXFVP4BZDOMC" },
  { projectId: 7, projectName: "De Drift", itemId: "01VFF6QEMNAGAOC4YKO5D3HYY43X54TZAZ" },
  { projectId: 19, projectName: "Mondi", itemId: "01VFF6QEPFPK3Z7D3NJZC2G7N777NIVEJD" },
  { projectId: 27, projectName: "Seshego Circle", itemId: "01VFF6QEOMZ3YHUCMNVNFYPD4FFM43FHGF" },
  { projectId: 39, projectName: "Unitrans Brackenfell", itemId: "01VFF6QEMI7DHRAMZXCBG2TFZHPNJXEYYS" },
];

async function main() {
  const cacheDir = join(process.cwd(), "qa/golden-oracle/.cache");
  mkdirSync(cacheDir, { recursive: true });
  const manifest: any[] = [];
  for (const t of TARGETS) {
    const { buffer, fileName, etag, ctag } = await downloadSingleFile(DRIVE_ID, t.itemId);
    const safe = `${t.projectId}_${fileName}`.replace(/[^\w.\- ]/g, "_");
    const outPath = join(cacheDir, safe);
    writeFileSync(outPath, buffer);
    const entry = { ...t, fileName, savedAs: safe, bytes: buffer.length, etag, ctag };
    manifest.push(entry);
    console.log(`✓ ${t.projectName.padEnd(22)} ${fileName.padEnd(34)} ${buffer.length} bytes`);
  }
  const manifestPath = join(cacheDir, "manifest.json");
  writeFileSync(manifestPath, JSON.stringify({ driveId: DRIVE_ID, downloadedAt: new Date().toISOString(), files: manifest }, null, 2));
  console.log("\nManifest:", manifestPath);
}

main().catch((e) => { console.error("DOWNLOAD FAILED:", e.message); process.exit(1); });
