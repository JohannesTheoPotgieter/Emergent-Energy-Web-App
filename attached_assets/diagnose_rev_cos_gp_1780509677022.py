#!/usr/bin/env python3
"""
Rev / COS / GP IMPORT DIAGNOSTIC  (READ-ONLY)
=============================================
Compares what the production app holds for Revenue / COS / GP against the values
derived directly from the raw project trackers, root-causes where the import breaks
the numbers, and prints a prioritised fix plan.

IT MAKES NO CHANGES. It runs every query inside a READ ONLY transaction, prints its
findings + proposed fixes, then STOPS and asks for explicit approval before any
remediation.

USAGE (Replit):
    pip install psycopg2-binary
    export DATABASE_URL="postgres://...."         # already set on most Replit DBs
    python diagnose_rev_cos_gp.py

If the auto-discovery can't map your tables/columns, edit the CONFIG block below
(or just read the "SCHEMA DISCOVERY" output and fill the names in) and re-run.
"""

import os, sys, re
from datetime import date

# ----------------------------------------------------------------------------
# CONFIG  — edit if auto-discovery doesn't find the right tables/columns
# ----------------------------------------------------------------------------
FY_START, FY_END = date(2025, 9, 1), date(2026, 8, 31)
AS_AT = date(2026, 6, 1)

# Folder/duplicate artifacts that must NOT be counted as projects:
EXCLUSIONS = [
    "99. Old", "Dipula", "BMG", "Klein Karoo Markt", "Maynard Mall",
    "Supa Store", "IconSA Benoni", "The Avenues", "Superspar Despatch Phase 2",
]

# Golden numbers derived from the raw trackers, snapshot as at 3 Jun 2026.
# (These move with the data — treat as the reconciliation target for THIS snapshot.)
GOLDEN = {
    "states": {  # state -> (revenue, cos)
        "Realised":   (129_805_448, 111_955_417),
        "Committed":  ( 45_904_486,  43_140_272),
        "Planned":    ( 59_848_541,  59_814_450),
        "Unrealised": (  1_207_484,     281_543),
    },
    "budget_all_states": (236_765_960, 215_191_682),   # Budget Rev / COS
    "ytd_realised":      (129_336_720, 111_319_783),   # Rev / COS  -> GP 18,016,937 / 13.9%
    "may_realised":      ( 31_480_892,  26_444_224),
    "project_count":     48,                            # after exclusions / de-dup
}

# Auto-discovery hints. The script scans columns for these keywords to map fields.
# Override here if needed, e.g. LINE_TABLE = "finance_recognition_lines"
LINE_TABLE   = None   # table of per-line recognition data (cos/rev/invoice/date/colour)
PROJECT_COL  = None   # column holding the project name/key
COS_COL      = None   # Actual Total
REV_COL      = None   # Revenue Recognition Amount
INVNO_COL    = None   # invoice number
INVDATE_COL  = None   # invoice raised date
COLOUR_COL   = None   # persisted font colour / status (red vs black) for invoice date
STATE_COL    = None   # the app's stored recognition state, if any

# ----------------------------------------------------------------------------
TOL = 0.01  # 1% tolerance on reconciliation
findings = []   # (severity, area, message)
def add(sev, area, msg): findings.append((sev, area, msg)); print(f"  [{sev}] {area}: {msg}")

def banner(t): print("\n" + "=" * 78 + f"\n{t}\n" + "=" * 78)

# ---- connect (READ ONLY) ----
try:
    import psycopg2, psycopg2.extras
except ImportError:
    sys.exit("psycopg2 not installed — run:  pip install psycopg2-binary")

dsn = os.environ.get("DATABASE_URL")
if not dsn:
    sys.exit("DATABASE_URL not set. export DATABASE_URL=postgres://...")

conn = psycopg2.connect(dsn)
conn.set_session(readonly=True, autocommit=True)   # hard read-only guard
cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
def q(sql, args=None):
    cur.execute(sql, args or [])
    return cur.fetchall() if cur.description else []

banner("REV / COS / GP IMPORT DIAGNOSTIC  —  READ-ONLY  —  NO CHANGES WILL BE MADE")
print(f"FY window {FY_START} .. {FY_END}   as-at {AS_AT}")

# ============================================================================
# 0. SCHEMA DISCOVERY
# ============================================================================
banner("0. SCHEMA DISCOVERY")
cols = q("""select table_name, column_name, data_type
           from information_schema.columns
           where table_schema='public' order by table_name, ordinal_position""")
by_tbl = {}
for r in cols: by_tbl.setdefault(r["table_name"], []).append(r["column_name"])
print(f"Found {len(by_tbl)} tables. Finance-relevant candidates:")
def looks_finance(t, cs):
    s = (t + " " + " ".join(cs)).lower()
    return any(k in s for k in ["cos","revenue","invoice","recognition","tracker","project","gp","payment","budget"])
fin_tbls = {t: c for t, c in by_tbl.items() if looks_finance(t, c)}
for t, c in fin_tbls.items(): print(f"  • {t}: {', '.join(c)}")

def guess(cands, *keys):
    for t, cs in cands.items():
        for col in cs:
            cl = col.lower()
            if all(k in cl for k in keys): return t, col
    return None, None

# Map the line table + columns if not configured
if LINE_TABLE is None:
    for t, cs in fin_tbls.items():
        cl = [c.lower() for c in cs]
        if any("recognition" in c or "actual total" in c or ("cos" in c) for c in cl) and any("invoice" in c for c in cl):
            LINE_TABLE = t; break
print(f"\nLine table  -> {LINE_TABLE or 'NOT FOUND (set LINE_TABLE in CONFIG)'}")
if LINE_TABLE:
    lc = [c.lower() for c in by_tbl[LINE_TABLE]]
    def pick(*keys):
        for orig in by_tbl[LINE_TABLE]:
            o = orig.lower()
            if all(k in o for k in keys): return orig
        return None
    PROJECT_COL = PROJECT_COL or pick("project")
    COS_COL     = COS_COL or pick("actual","total") or pick("cos")
    REV_COL     = REV_COL or pick("revenue","recognition") or pick("rev")
    INVNO_COL   = INVNO_COL or pick("invoice","number") or pick("invoice","no")
    INVDATE_COL = INVDATE_COL or pick("invoice","date") or pick("invoice","raised")
    COLOUR_COL  = COLOUR_COL or pick("colour") or pick("color") or pick("font") or pick("status")
    STATE_COL   = STATE_COL or pick("state") or pick("recognition","status")
    for nm, v in [("project",PROJECT_COL),("COS",COS_COL),("REV",REV_COL),("invoice_no",INVNO_COL),
                  ("invoice_date",INVDATE_COL),("colour/status",COLOUR_COL),("app state",STATE_COL)]:
        print(f"    {nm:14} -> {v or 'NOT FOUND — map manually'}")

# ============================================================================
# 1. FONT-COLOUR PERSISTENCE  (the make-or-break failure mode)
# ============================================================================
banner("1. FONT-COLOUR PERSISTENCE  (red/black = committed/realised, overdue logic)")
if not LINE_TABLE or not COLOUR_COL:
    add("CRITICAL","colour","No column found that stores the invoice-date font colour / red-black status. "
        "If colour is not persisted at import, Committed/Planned cannot be distinguished from Realised and "
        "COS/GP will be OVERSTATED. Confirm the importer reads cell font colour (openpyxl cell.font.color / "
        "ExcelJS cell.font.color) and writes an explicit field. NOTE: SheetJS community build does NOT expose colour.")
else:
    dist = q(f'select "{COLOUR_COL}" as v, count(*) n from "{LINE_TABLE}" group by 1 order by 2 desc')
    print("  distinct colour/status values:", [(r["v"], r["n"]) for r in dist][:10])
    if len(dist) <= 1:
        add("CRITICAL","colour", f'"{COLOUR_COL}" has a single value for all rows — colour is NOT being captured. '
            "Every line is being treated the same (likely all Realised). Fix the importer to persist red vs black.")
    else:
        add("OK","colour", f'"{COLOUR_COL}" has multiple values — colour appears to be captured. Verify the mapping '
            "red->pending/committed, black/default->confirmed/realised is applied consistently.")

# ============================================================================
# 2. DUPLICATE / ARTIFACT PROJECTS surviving the import
# ============================================================================
banner("2. DUPLICATES & FOLDER ARTIFACTS")
if LINE_TABLE and PROJECT_COL:
    projs = q(f'select distinct "{PROJECT_COL}" p from "{LINE_TABLE}" order by 1')
    names = [r["p"] for r in projs if r["p"]]
    present_artifacts = [a for a in EXCLUSIONS if any(a.lower() == (n or "").lower() for n in names)]
    if present_artifacts:
        add("HIGH","duplicates", f"Folder/duplicate artifacts present in the data (should be excluded): {present_artifacts}")
    # Superspar specific
    sup = [n for n in names if "superspar" in (n or "").lower()]
    if any("despatch" in (n or "").lower() for n in sup):
        add("HIGH","duplicates", f"Stale duplicate 'Superspar Despatch Phase 2' present alongside the live tracker. "
            f"Superspar entries seen: {sup}. The Despatch copy is all-red/no-invoice and double-counts.")
    # near-duplicate names (same normalised key)
    def normp(s):
        s=re.sub(r'[^a-z0-9]','',(s or '').lower()); return s
    seen={}
    for n in names:
        seen.setdefault(normp(n), []).append(n)
    dups=[v for v in seen.values() if len(v)>1]
    if dups: add("MEDIUM","duplicates", f"Near-duplicate project names (possible same project twice): {dups[:10]}")
    print(f"  distinct projects in data: {len(names)}  (golden target after exclusions: {GOLDEN['project_count']})")
    if len([n for n in names if n not in EXCLUSIONS]) != GOLDEN["project_count"]:
        add("HIGH","reconcile", f"Project count after exclusions = {len([n for n in names if n not in EXCLUSIONS])} "
            f"vs expected {GOLDEN['project_count']}. Investigate missing/extra projects.")
else:
    add("INFO","duplicates","Could not check — map LINE_TABLE/PROJECT_COL.")

# ============================================================================
# 3. RECOGNITION-STATE ASSIGNMENT
# ============================================================================
banner("3. RECOGNITION-STATE LOGIC")
if LINE_TABLE and STATE_COL and INVNO_COL:
    bad1 = q(f'select count(*) n from "{LINE_TABLE}" where ("{INVNO_COL}" is null or "{INVNO_COL}"=\'\') and lower("{STATE_COL}")=\'realised\'')
    if bad1 and bad1[0]["n"]:
        add("HIGH","state", f"{bad1[0]['n']} lines have NO invoice number but state=Realised — impossible. "
            "Realised must require an invoice present + black date.")
    dist = q(f'select "{STATE_COL}" s, count(*) n, round(sum("{COS_COL}")::numeric,0) cos from "{LINE_TABLE}" group by 1 order by 3 desc nulls last')
    print("  state distribution (state, lines, COS):", [(r["s"], r["n"], r["cos"]) for r in dist])
elif LINE_TABLE:
    add("MEDIUM","state","No stored recognition-state column found. If the app derives state on the fly, verify it uses "
        "invoice-present + colour + future-date exactly (Realised / Committed / Planned / Unrealised).")

# ============================================================================
# 4. FY WINDOW FILTERING
# ============================================================================
banner("4. FY WINDOW FILTERING")
if LINE_TABLE and INVDATE_COL:
    out = q(f'select count(*) n, round(sum("{COS_COL}")::numeric,0) cos from "{LINE_TABLE}" '
            f'where "{INVDATE_COL}" < %s or "{INVDATE_COL}" > %s', [FY_START, FY_END])
    if out and out[0]["n"]:
        add("MEDIUM","fy_window", f"{out[0]['n']} lines fall OUTSIDE the FY window {FY_START}..{FY_END} "
            f"(COS {out[0]['cos']}). Confirm the tab filters on invoice-raised-date within the FY.")
    else:
        add("OK","fy_window","All lines within FY window (or date column not date-typed — check).")

# ============================================================================
# 5. HEADLINE RECONCILIATION vs GOLDEN
# ============================================================================
banner("5. RECONCILIATION  (app vs raw-tracker golden numbers)")
def cmp(label, got, exp):
    g = float(got or 0); e = float(exp)
    delta = g - e; pct = (delta / e * 100) if e else 0
    flag = "OK" if abs(pct) <= TOL*100 else ("HIGH" if abs(pct) > 2 else "MEDIUM")
    print(f"  {label:34} app {g:>15,.0f} | target {e:>15,.0f} | Δ {delta:>13,.0f} ({pct:+.1f}%)")
    if flag != "OK": add(flag, "reconcile", f"{label} off by {delta:,.0f} ({pct:+.1f}%)")

if LINE_TABLE and COS_COL and REV_COL:
    excl = "(" + ",".join(["%s"]*len(EXCLUSIONS)) + ")"
    # Realised (invoiced + black). Adapt the predicate to the app's actual fields:
    where_real = ""
    if STATE_COL: where_real = f'lower("{STATE_COL}")=\'realised\''
    elif COLOUR_COL and INVNO_COL:
        where_real = f'("{INVNO_COL}" is not null and "{INVNO_COL}"<>\'\') and lower("{COLOUR_COL}") in (\'black\',\'default\',\'confirmed\',\'\')'
    if where_real:
        try:
            base = f'from "{LINE_TABLE}" where "{PROJECT_COL}" not in {excl} and "{INVDATE_COL}" between %s and %s'
            args = EXCLUSIONS + [FY_START, FY_END]
            real = q(f'select round(sum("{REV_COL}")::numeric,0) rev, round(sum("{COS_COL}")::numeric,0) cos {base} and {where_real}', args)
            alls = q(f'select round(sum("{REV_COL}")::numeric,0) rev, round(sum("{COS_COL}")::numeric,0) cos {base}', args)
            cmp("Realised Revenue", real[0]["rev"], GOLDEN["states"]["Realised"][0])
            cmp("Realised COS",     real[0]["cos"], GOLDEN["states"]["Realised"][1])
            cmp("Budget (all states) Revenue", alls[0]["rev"], GOLDEN["budget_all_states"][0])
            cmp("Budget (all states) COS",     alls[0]["cos"], GOLDEN["budget_all_states"][1])
            gp = float(real[0]["rev"] or 0) - float(real[0]["cos"] or 0)
            cmp("YTD Realised GP", gp, GOLDEN["ytd_realised"][0]-GOLDEN["ytd_realised"][1])
        except Exception as e:
            add("INFO","reconcile", f"Reconciliation query failed ({e}); map the predicate to your schema.")
    else:
        add("INFO","reconcile","Cannot build the Realised predicate — need either a state column or colour+invoice columns.")
else:
    add("INFO","reconcile","Map LINE_TABLE/COS/REV columns to run reconciliation.")

# ============================================================================
# 6. COS-WITH-NO-REVENUE (margin distortion)
# ============================================================================
banner("6. COS WITH NO REVENUE")
if LINE_TABLE and COS_COL and REV_COL:
    nr = q(f'select round(sum("{COS_COL}")::numeric,0) cos, count(*) n from "{LINE_TABLE}" '
           f'where coalesce("{REV_COL}",0)=0 and "{COS_COL}">1000')
    if nr: print(f"  COS booked with zero revenue: {nr[0]['n']} lines, COS {nr[0]['cos']:,} "
                 f"(expected ~R13.2m — these understate GP; capture revenue in trackers).")

# ============================================================================
# FIX PLAN
# ============================================================================
banner("PRIORITISED FIX PLAN")
order = {"CRITICAL":0,"HIGH":1,"MEDIUM":2,"OK":3,"INFO":4}
ranked = sorted([f for f in findings if f[0] in ("CRITICAL","HIGH","MEDIUM")], key=lambda x: order[x[0]])
if not ranked:
    print("  No CRITICAL/HIGH/MEDIUM issues detected against the mapped schema.")
else:
    for i,(sev,area,msg) in enumerate(ranked,1):
        print(f"  {i}. [{sev}] ({area}) {msg}")
print("""
  Typical remediation (do NOT run yet — for approval):
   1. Importer: persist invoice-date AND finance-payment-date FONT COLOUR as an explicit
      status field (red=pending/unpaid, black/default=confirmed/paid). Switch off SheetJS
      community build if in use (it can't read colour).
   2. De-dup: drop folder/handover copies (Superspar Despatch Phase 2, 99.Old, Dipula, BMG,
      Klein Karoo Markt, Maynard Mall, Supa Store, IconSA Benoni, The Avenues); keep one
      live tracker per project. Make the exclusion list config-driven.
   3. State logic: Realised = invoice present + black; Committed = invoice + red;
      Planned = no invoice + red + future; Unrealised = no invoice, other.
   4. FY window: filter recognition on INVOICE RAISED DATE within 1 Sep 2025 – 31 Aug 2026.
   5. Re-run this diagnostic; it should reconcile to the golden numbers within 1%.
""")

banner("READ-ONLY RUN COMPLETE — NO CHANGES MADE")
print("""This script only SELECTed data inside a read-only transaction. Nothing in the
database or app data has been modified.

>>> APPROVAL REQUIRED <<<
Review the findings and fix plan above. Do you approve proceeding to remediation?
Reply 'APPROVED: <which items>' and I (Replit agent) will implement ONLY those items,
one at a time, with a backup/migration and a re-run of this diagnostic after each.
No changes will be made until you explicitly approve.
""")
cur.close(); conn.close()
