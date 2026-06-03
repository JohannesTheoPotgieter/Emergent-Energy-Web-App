# Rev/COS/GP Import Diagnostic — Replit README

**File:** `diagnose_rev_cos_gp.py` — read-only diagnostic for the production app's Revenue/COS/GP data.

## What it does
1. **Diagnoses the gap** between what the app stores and the raw-tracker golden numbers
   (Budget Rev R236.8m · Actual/Realised Rev R129.8m · YTD GP ~R18.0m / 13.9% · 48 projects after de-duping Superspar Despatch Phase 2).
2. **Root-causes the import** — checks font-colour persistence (red/black), duplicate/artifact projects, recognition-state logic, FY-window filtering, and COS-with-no-revenue.
3. **Prints a prioritised fix plan** (CRITICAL → HIGH → MEDIUM).
4. **Stops and asks for approval** — it is read-only (runs inside a `READ ONLY` transaction) and changes nothing.

## How to run (Replit shell)
```bash
pip install psycopg2-binary
# DATABASE_URL is usually already set on Replit Postgres; otherwise:
export DATABASE_URL="postgres://user:pass@host:5432/dbname"
python diagnose_rev_cos_gp.py
```

## If it can't find your tables
The script auto-discovers the schema and prints a **SCHEMA DISCOVERY** section. If it can't map
the line-item table/columns, open the file and set these in the CONFIG block near the top:
`LINE_TABLE, PROJECT_COL, COS_COL, REV_COL, INVNO_COL, INVDATE_COL, COLOUR_COL, STATE_COL`
then re-run. The discovery output tells you the candidate names.

## Safety
- Connection is forced read-only (`set_session(readonly=True)`); only `SELECT` is issued.
- It will **not** modify the database. It ends by explicitly requesting approval before any remediation.
- When you approve, fix items **one at a time**, take a backup/migration, and re-run this diagnostic after each — it should reconcile to the golden numbers within 1%.

## The reconciliation target (this snapshot, 3 Jun 2026)
| | Revenue | COS |
|---|--:|--:|
| Realised | 129,805,448 | 111,955,417 |
| Committed | 45,904,486 | 43,140,272 |
| Planned | 59,848,541 | 59,814,450 |
| Unrealised | 1,207,484 | 281,543 |
| Budget (all states) | 236,765,960 | 215,191,682 |

YTD Realised GP **18,016,937 (13.9%)** · May Realised Rev **31,480,892** / COS **26,444,224** · Projects **48**.
*(Numbers move with the data — the real test is methodology + reconciliation on the same snapshot.)*
