import { db, initializeDatabase } from "../db";
import { ProjectInfoRepository } from "../repositories/project-info-repository";
import { FinanceLineLevelRepository } from "../repositories/finance-line-level-repository";

const r2 = (n: number) => Math.round(n * 100) / 100;
const pad = (s: string, n: number) => (s + " ".repeat(n)).slice(0, n);
const m = (n: number) => r2(n).toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

async function main() {
  await initializeDatabase();
  const projects = await new ProjectInfoRepository().listActiveIdName();
  const repo = new FinanceLineLevelRepository(db);
  console.log(`Read-only finance diagnostic — ${projects.length} active projects (all-time lines)\n`);
  const head = [pad("PROJECT",32),pad("#ln",5),pad("noDate",7),pad("noAlloc",8),pad("recRev",15),pad("recCOS",15),pad("realRev",15),pad("realCOS",15),pad("realGP",15)].join(" ");
  console.log(head); console.log("-".repeat(head.length));
  const T:any = { lines:0,noDate:0,noAlloc:0,recRev:0,recCos:0,realRev:0,realCos:0,realGp:0,proj:0 };
  for (const p of projects) {
    const lines = await repo.getProjectFinanceLines(p.id);
    if (!lines.length) continue;
    let noDate=0,noAlloc=0,recRev=0,recCos=0,realRev=0,realCos=0,realGp=0;
    for (const l of lines) {
      if (!l.invoiceRaisedDate) noDate++;
      if (l.perLineRevenue === 0 || l.derivationWarning) noAlloc++;
      recRev += l.perLineRevenue; recCos += l.actualTotal;
      if (l.bucket === "realised") { realRev += l.perLineRevenue; realCos += l.actualTotal; realGp += l.perLineGp; }
    }
    T.lines+=lines.length;T.noDate+=noDate;T.noAlloc+=noAlloc;T.recRev+=recRev;T.recCos+=recCos;T.realRev+=realRev;T.realCos+=realCos;T.realGp+=realGp;T.proj++;
    console.log([pad((p.projectName||`#${p.id}`),32),pad(String(lines.length),5),pad(String(noDate),7),pad(String(noAlloc),8),pad(m(recRev),15),pad(m(recCos),15),pad(m(realRev),15),pad(m(realCos),15),pad(m(realGp),15)].join(" "));
  }
  console.log("-".repeat(head.length));
  console.log([pad(`TOTAL (${T.proj} w/ lines)`,32),pad(String(T.lines),5),pad(String(T.noDate),7),pad(String(T.noAlloc),8),pad(m(T.recRev),15),pad(m(T.recCos),15),pad(m(T.realRev),15),pad(m(T.realCos),15),pad(m(T.realGp),15)].join(" "));
  console.log(`\nrecRev/recCOS = recognised over ALL lines; realRev/realCOS/realGP = §3.2-realised only.`);
  console.log(`noDate  = lines missing col-T invoice date (never bucket into a month → undercount).`);
  console.log(`noAlloc = lines with zero per-line revenue or a derivation warning (missing/broken col-J allocation).`);
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
