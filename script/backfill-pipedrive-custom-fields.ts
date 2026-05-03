import { initializeDatabase, db } from "../server/db.js";
import { opportunities } from "@shared/schema/projects";
import { users } from "@shared/schema/users";
import { eq } from "drizzle-orm";

const TOKEN = process.env.PIPEDRIVE_API_TOKEN!;
const KEY_LOCATION = "e3a7ca9b4908d9782ed92ebe556ec504c0cf34f8";
const KEY_KWP = "9b187266d1c0d4c27b7440f0b190677ad6cada35";
const KEY_KWH = "9b74781dcf72f283c9d3f774f507564788771510";
const PROVINCE: Record<string, string> = {
  "65": "Gauteng", "66": "Western Cape", "67": "KwaZulu-Natal",
  "68": "Eastern Cape", "69": "Eastern Cape", "70": "Free State",
};

(async () => {
  await initializeDatabase();
  // Email → user.id map (for resolving Pipedrive deal owner → internal user FK).
  const userByEmail = new Map<string, number>();
  for (const u of await db.select({ id: users.id, email: users.email }).from(users)) {
    if (u.email) userByEmail.set(u.email.trim().toLowerCase(), u.id);
  }
  let start = 0, total = 0, updates = 0, withProv = 0, withKwp = 0, withKwh = 0, withOwner = 0;
  while (true) {
    const r = await fetch(`https://api.pipedrive.com/v1/deals?api_token=${TOKEN}&start=${start}&limit=100`).then(r => r.json()) as any;
    const deals = r.data || [];
    if (deals.length === 0) break;
    for (const d of deals) {
      total++;
      const loc = d[KEY_LOCATION];
      const kwp = d[KEY_KWP];
      const kwh = d[KEY_KWH];
      const province = loc ? (PROVINCE[String(loc).split(",")[0].trim()] ?? null) : null;
      const kwpNum = kwp != null && kwp !== "" ? Number(kwp) : NaN;
      const kwhNum = kwh != null && kwh !== "" ? Number(kwh) : NaN;
      const kwpStr = Number.isFinite(kwpNum) && kwpNum > 0 ? String(kwpNum) : null;
      const kwhStr = Number.isFinite(kwhNum) && kwhNum > 0 ? String(kwhNum) : null;
      // Pipedrive deal owner lives under user_id (not owner_id, which is null
      // on modern v1 responses). Resolve to internal user FK by email.
      const ownerName = d.user_id?.name ?? null;
      const ownerEmail = d.user_id?.email ? String(d.user_id.email).trim().toLowerCase() : null;
      const ownerUserId = ownerEmail ? (userByEmail.get(ownerEmail) ?? null) : null;
      if (!province && !kwpStr && !kwhStr && !ownerName) continue;
      await db.update(opportunities)
        .set({
          ...(province ? { province } : {}),
          ...(kwpStr ? { estimatedKwp: kwpStr } : {}),
          ...(kwhStr ? { estimatedKwh: kwhStr } : {}),
          ...(ownerName ? { dealOwnerName: ownerName } : {}),
          ...(ownerUserId != null ? { dealOwnerUserId: ownerUserId } : {}),
        })
        .where(eq(opportunities.pipedriveDealId, String(d.id)));
      updates++;
      if (province) withProv++;
      if (kwpStr) withKwp++;
      if (kwhStr) withKwh++;
      if (ownerName) withOwner++;
    }
    if (!r.additional_data?.pagination?.more_items_in_collection) break;
    start = r.additional_data.pagination.next_start;
    process.stdout.write(`  scanned=${total} updated=${updates} owner=${withOwner} prov=${withProv} kwp=${withKwp} kwh=${withKwh}\r`);
  }
  console.log(`\nDONE scanned=${total} updates=${updates} owner=${withOwner} prov=${withProv} kwp=${withKwp} kwh=${withKwh}`);
  process.exit(0);
})();
