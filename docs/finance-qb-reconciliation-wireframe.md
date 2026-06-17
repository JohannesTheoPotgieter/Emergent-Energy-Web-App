# QuickBooks Reconciliation — "if it worked" wireframe

**Audience:** COO / Finance. **Status:** illustrative — describes the live page
(`/finance/qb-reconciliation`, `client/src/pages/finance-qb-reconciliation.tsx`)
**fully populated with real QuickBooks data**. Today the page renders but shows
*"No reconciliation computed yet"* until the QB sync produces `qb_recon_line` /
`qb_recon_summary` rows. Nothing here changes a number or a formula — it shows
the screen you'd see once QB is connected and the daily match has run.

The reconciliation is **company-level** and matched on **invoice number +
ex-VAT amount** (guardrails S5 / GP3). The app **compares and flags** — it
**never writes back to QuickBooks and never adjusts a tracker** (§ 3.4).

---

## 1. What "working" means here

| Input | Source | State today |
|---|---|---|
| Tracker REV / COS by invoice | canonical line-level repo (single read path) | ✅ live |
| QuickBooks invoices (AR) + bills (AP) | QB sync → `qb_recon_line` | ⛔ empty until QB connected |
| The match (invoice no + ex-VAT amount) | R2 match engine, runs daily | ⛔ waits on the above |

When QB is connected, the daily job pairs every tracker invoice with its QB
document, buckets each into one of four states, and writes the per-period
summary. The page then reads three endpoints (no calculation in the page):

```
GET /api/finance/qb-recon/summary?grain=month|week|day   → per-period REV/COS/GP + coverage
GET /api/finance/qb-recon/lines                          → the four-state invoice worklist
GET /api/finance/qb-recon/ignores                        → accepted differences (who/why/when)
POST/DELETE /api/finance/qb-recon/ignore                 → the ONLY writes (annotations)
```

---

## 2. Screen wireframe (populated)

### 2.1 Header + grain selector

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ QuickBooks Reconciliation                              [ Day | Week | (Month) ]│
│ Company-wide tracker vs QuickBooks — matched on invoice number + ex-VAT amount.│
│ The app compares and flags; it never adjusts a tracker or writes back to QB.   │
│ QB invoice-match engine · ex-VAT                                               │
└──────────────────────────────────────────────────────────────────────────────┘
```

### 2.2 KPI row — selected period (REV / COS / GP, tracker vs QB)

Three tiles. Green **Tie** when |Δ| ≤ R1; amber **Variance** otherwise.

```
┌── Revenue ───────────────┐ ┌── COS ───────────────────┐ ┌── GP ────────────────────┐
│ R 4.20m            [Tie] │ │ R 3.55m       [Variance] │ │ R 0.65m       [Variance] │
│ tracker 4.20m · QB 4.20m │ │ trk 3.55m · QB 3.61m     │ │ trk 0.65m · QB 0.59m     │
│                          │ │ · Δ 60k                  │ │ · Δ 60k                  │
└──────────────────────────┘ └──────────────────────────┘ └──────────────────────────┘
        ↑ REV ties to the cent          ↑ COS off by R60k        ↑ GP variance = COS variance
```

> Reading: Revenue agrees with QuickBooks; the GP gap is entirely the COS gap —
> sends you straight to the cost worklist, not the revenue side.

### 2.3 Period comparison — tracker vs QB by month, + variance + coverage

Click a row to drill its invoice worklist below. **Coverage = matched ex-VAT
value ÷ tracker-invoiced value**; a flagged period is *not* fully reconciled.

```
 Month     Rev trk  Rev QB  Rev Δ │ COS trk  COS QB  COS Δ │ GP trk  GP QB  GP Δ │ Coverage
 ─────────────────────────────────┼──────────────────────┼─────────────────────┼─────────
 2025-09    3.10m   3.10m    —    │  2.60m   2.60m    —   │  0.50m  0.50m   —   │  100%
 2025-10    3.80m   3.80m    —    │  3.25m   3.31m  Δ60k  │  0.55m  0.49m Δ60k  │  97%
›2025-11    4.20m   4.20m    —    │  3.55m   3.61m  Δ60k  │  0.65m  0.59m Δ60k  │ [ 92% ]  ← low, flagged
 2025-12    2.90m   2.95m  Δ50k   │  2.40m   2.40m    —   │  0.50m  0.55m Δ50k  │  88%  [⚠]
 ─────────────────────────────────┴──────────────────────┴─────────────────────┴─────────
 Coverage below 95% is amber: unmatched is the default, not an error. Click a row to drill.
```

### 2.4 Invoice worklist — drilled from the selected period

Split **Revenue (client invoices ⇄ QB invoices)** and **Cost (supplier invoices
⇄ QB bills)** because the documents differ. Each side groups four states;
differences are expanded first, clean matches collapsed. GP is *not* an
invoice-level concept, so there is no GP worklist.

```
 Invoice worklist — 2025-11
┌── Revenue — client invoices ⇄ QB invoices ──────────  (1 to action) ──┐
│ ▾ ⚠ Ambiguous            1 · R 0.42m                                  │
│    Invoice    Tracker     QB        Δ      Trk date   QB date         │
│    INV-2041   R 420,000   R 420,000 —      2025-11-08 2025-11-08 [Ign]│  ← same #/amount, 2 QB hits
│ ▸ ✓ Matched             14 · R 3.78m                                  │  (collapsed — all tie)
└──────────────────────────────────────────────────────────────────────┘

┌── Cost — supplier invoices ⇄ QB bills ──────────────  (3 to action) ──┐
│ ▾ ⚠ Ambiguous            1 · R 60,000                                 │
│    BILL-7782  R 360,000   R 300,000 Δ60k   2025-11-12 2025-11-12 [Ign]│  ← amount mismatch
│ ▾ ⊟ Unmatched in QB      1 · R 0.18m                                  │  in tracker, not in QB
│    SUP-3310   R 180,000   —         —      2025-11-20  —        [Ign]  │
│ ▾ ⊞ Unmatched in tracker 1 · R 0.05m                                  │  in QB, not in tracker
│    QB-BILL-91 —           R 50,000  —      —          2025-11-25 [Ign]│
│ ▸ ✓ Matched             22 · R 3.13m                                  │  (collapsed)
└──────────────────────────────────────────────────────────────────────┘
```

The four states (each pairs an icon **and** a word — colour-blind safe):

| State | Icon | Meaning | Typical action |
|---|---|---|---|
| **Matched** | ✓ | invoice no + ex-VAT amount agree (±R1) | none — evidence it ties |
| **Ambiguous** | ⚠ | matches by number but amount differs, or >1 candidate | investigate; fix tracker or QB at source |
| **Unmatched in QB** | ⊟ | in the tracker, absent from QuickBooks | chase capture into QB (or it's a timing lag) |
| **Unmatched in tracker** | ⊞ | in QuickBooks, absent from the tracker | back-fill the tracker / confirm it belongs |

A **Timing** chip appears where the same invoice lands in different periods
(raised one month, booked the next) — a known, expected difference rather than a
true break.

### 2.5 Recon-ignores — accepted differences (audit footer)

"Ignore" never deletes — it moves a difference off the worklist and onto the
audit list with **who · why · when**. Restorable.

```
┌── Recon-ignores (2) — accepted differences, excluded from the worklist, shown for audit ──┐
│ COST  BILL-7782 · ACME Cabling · R 60,000 · ignored by J. Potgieter,                      │
│       "agreed retention 60k, releases on PC" · 2025-11-18                       [↺ Restore]│
│ REV   INV-1990 · Sun Mall (Pty) · R 12,500 · ignored by F. Adams,                         │
│       "rounding on a credit note, immaterial" · 2025-11-14                      [↺ Restore]│
└───────────────────────────────────────────────────────────────────────────────────────────┘

ⓘ QB COS bills aren't project-tagged, so this reconciliation is company-wide (no project dimension).
```

---

## 3. The behaviour it drives

**Daily rhythm — close the gap, not chase ghosts**

1. Open the period (defaults to the most recent month). Read the three KPI tiles:
   a green **Tie** on REV/COS/GP means the books and the trackers agree for the
   period — no action.
2. Any amber **Variance** → the GP gap decomposes into the REV gap and the COS
   gap, so you know which worklist to open before you click.
3. Work the **differences-first** list: Ambiguous → Unmatched-in-QB →
   Unmatched-in-tracker. Clean matches stay collapsed so the screen is the
   *to-do list*, not the whole ledger.
4. For each real break, fix it **at source** (tracker or QuickBooks), not on this
   screen. For a genuine, explained difference (retention, agreed timing,
   immaterial rounding) → **Ignore with a reason**; it drops off the worklist and
   onto the audited list.
5. Watch **Coverage**: it trends toward 100% as the month closes. A period stuck
   below ~95% after close is the signal that invoices are missing on one side.

**What it deliberately never does**

- ❌ Never writes back to QuickBooks; never edits a tracker. Read + annotate only.
- ❌ Never claims "fully reconciled" by hiding unmatched items — **unmatched is the
  default, not an error** (S5). Coverage always shows what *is* matched.
- ❌ No project dimension here — QB bills aren't project-tagged, so this is
  company-level. Per-project tie-out lives in the invoice auto-matcher on the
  project finance view, which **always shows match coverage and never implies
  completeness** (S5).
- ❌ No "no-PO" flag — invoices may exist without POs; that flag is retired (S2).

**What turns it on**

- Connect QuickBooks (Online) so the sync can pull AR invoices + AP bills into
  `qb_recon_line`. Until then the page is honest about having nothing to compare
  and shows the empty state — by design, not a bug.

---

*Companion: `docs/finance-reconciliation.md` (tracker-vs-app trust) and
`docs/finance-source-of-truth-audit.md` Part I (the locked finance rules).*
