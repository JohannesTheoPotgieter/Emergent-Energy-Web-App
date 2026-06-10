/**
 * READ-ONLY SharePoint discovery for the golden-oracle fixture build.
 *
 * Uses the app's own SharePoint download-path auth (getSharePointToken) and
 * raw Microsoft Graph GETs to locate the site/drive/folder that holds the
 * project trackers. Makes NO writes. Does NOT touch the importer/derivation.
 */
import { getSharePointToken } from "../../server/sharepoint-token";

const GRAPH = "https://graph.microsoft.com/v1.0";

async function gget(url: string, token: string): Promise<any> {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } });
  const text = await res.text();
  if (!res.ok) throw new Error(`GET ${url} -> ${res.status} ${text.slice(0, 400)}`);
  return text ? JSON.parse(text) : {};
}

async function main() {
  const token = await getSharePointToken();
  console.log("TOKEN ok (len)", token.length);

  // 1. Find the site(s)
  const search = process.env.SP_SITE_SEARCH || "Emergent";
  const sites = await gget(`${GRAPH}/sites?search=${encodeURIComponent(search)}`, token);
  console.log("\n=== SITES (search='" + search + "') ===");
  for (const s of sites.value || []) {
    console.log(`  id=${s.id}\n    name=${s.displayName}  web=${s.webUrl}`);
  }
  const site = (sites.value || [])[0];
  if (!site) { console.log("No site found. Try SP_SITE_SEARCH env."); return; }

  // 2. Drives on that site
  const drives = await gget(`${GRAPH}/sites/${site.id}/drives`, token);
  console.log("\n=== DRIVES on first site ===");
  for (const d of drives.value || []) console.log(`  driveId=${d.id}\n    name=${d.name}  web=${d.webUrl}`);

  // 3. Search each drive for the 5 trackers
  const wanted = ["Mondi", "Coega", "Unitrans", "De Drift", "Drift", "Seshego"];
  for (const d of drives.value || []) {
    for (const term of ["Tracker"]) {
      try {
        const hits = await gget(`${GRAPH}/drives/${d.id}/root/search(q='${encodeURIComponent(term)}')?$top=200`, token);
        const rel = (hits.value || []).filter((h: any) =>
          /\.(xlsx|xlsm)$/i.test(h.name || "") &&
          wanted.some((w) => (h.name || "").toLowerCase().includes(w.toLowerCase())),
        );
        if (rel.length) {
          console.log(`\n=== DRIVE ${d.name} (${d.id}) search '${term}' MATCHES ===`);
          for (const h of rel) {
            const path = h.parentReference?.path || "";
            console.log(`  name=${h.name}\n    itemId=${h.id}  driveId=${h.parentReference?.driveId || d.id}\n    path=${path}  modified=${h.lastModifiedDateTime}`);
          }
        }
      } catch (e: any) {
        console.log(`  search '${term}' on drive ${d.name} failed: ${e.message}`);
      }
    }
  }
}

main().catch((e) => { console.error("DISCOVER FAILED:", e.message); process.exit(1); });
