# REV / COS / GP — Line-Item Audit Pack (source of truth from the trackers)

Use these files to audit the **app database** against the **tracker source data**.
Extracted from the Active Trackers + Compliance folders, FY window **1 Sep 2025 – 31 Aug 2026**.
Snapshot date: 1 Jun 2026. 48 projects (9 folder artifacts + Superspar Despatch Phase 2 excluded — see bottom).

## Files
1. **rev_cos_gp_line_items.csv** — every recognition line (the audit fixture). 2,519 rows.
2. **rev_cos_gp_checksums.csv** — rollups for fast assertions (by state, by month, by project).

## Definitions (must match how the app recognises)
- **Period** = the line's **invoice raised date** (NOT payment date).
- **COS** = `Actual Total` on the Expenditure Breakdown line.
- **REV** = `Revenue Recognition Amount` on the Revenue Tracking line.
- **GP** = REV − COS.
- **State** (from Excel font colour + invoice presence):
  - `Realised` = invoice number present AND invoice date is **black** text.
  - `Committed` = invoice number present AND invoice date is **red** text.
  - `Planned` = no invoice number AND date is **red** AND date is in the future.
  - `Unrealised` = no invoice, anything else.

## Column dictionary — rev_cos_gp_line_items.csv
| col | meaning |
|---|---|
| project | tracker/project name (match key part 1) |
| type | source folder: Active / Compliance |
| eb_row | row number on the Expenditure/Revenue sheet (match key part 2) |
| invoice_date | recognition date (ISO) |
| month | recognition month bucket (YYYY-MM) |
| state | Realised / Committed / Planned / Unrealised |
| invoice_no | invoice reference (blank if none) |
| cos | Actual Total (cost of sale) |
| rev | Revenue Recognition Amount |
| gp | rev − cos |
| gp_pct | gp / rev as % |
| category | EB category (e.g. "3. Mounting Structures") |
| description | line description |

**Suggested match key:** (`project`, `eb_row`, `invoice_date`) → then assert cos, rev, state match the DB line.
Where the DB doesn't store eb_row, fall back to (`project`, `invoice_no`) for invoiced lines, and (`project`, `category`, `description`, `cos`) for non-invoiced.

## How to audit (recommended sequence)
1. **Totals first** — confirm the DB reproduces the checksums below before going line-by-line.
2. **State distribution** — DB count & R-value per state must match `rev_cos_gp_checksums.csv` rows 1–4.
3. **Realised-by-month** — drives the FYE Tracking tab; must match month rollups.
4. **Per-project** — find which projects diverge, then drill to lines.
5. **Line-by-line** — left-join fixture↔DB on the match key; report: missing in DB, extra in DB, value mismatch (cos/rev), state mismatch.

## Golden totals (assert these)
- **Budget (all states): REV 236,765,960 | COS 215,191,682 | GP 21,574,278**
- **YTD Realised (Sep–May): REV 129,336,720 | COS 111,319,783 | GP 18,016,937 (13.9%)**
- **48 projects**

## Excluded from this pack (must NOT appear as live recognition in the DB)
Folder artifacts: `99. Old`, `Dipula`, `BMG`, `Klein Karoo Markt`, `Maynard Mall`, `Supa Store`, `IconSA Benoni`, `The Avenues`.
Stale handover copy: `Superspar Despatch Phase 2` (R0 paid / all-red / no invoices — superseded by active `Superspar Ph2`).
If any of these carry REV/COS in the DB, that is a **duplicate/import artifact** to flag.
