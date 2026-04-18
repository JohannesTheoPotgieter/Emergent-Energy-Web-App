# Smart Import — How to Use (Operator Guide)

This guide explains how to import data from Excel tracker spreadsheets into the Emergent Energy app.

---

## Getting started

1. Go to **Smart Import** in the app menu.
2. You will see the import wizard with 5 simple steps.

---

## Step 1: Upload your spreadsheet

- Drag and drop your Excel file into the upload area, or click "Browse Files".
- You can also upload an entire folder — click "Browse Folder" and select the folder containing your tracker files.
- Supported file types: `.xlsx` and `.xlsm`.
- If you upload multiple files, each one will be processed separately.

**What happens:** The system reads your spreadsheet and identifies what data it contains.

---

## Step 2: What we found

After uploading, you'll see:

- **Project** — which project the data belongs to.
- **Import type** — either:
  - "First-time import" — this is the first time data is being imported for this project. Everything will be added as new.
  - "Update" — data has been imported before. Only changes will be applied.
- **Sections found** — which types of data were detected:
  - Schedule / Timeline (project plan tasks)
  - Revenue / Milestones (invoicing and payment milestones)
  - Costs / Expenses (cost line items and budgets)
- **Sheets not used** — any worksheets in your file that the system didn't recognize. This is usually fine — it just means those sheets don't match the expected format.

Click **Continue** to proceed.

---

## Step 3: What changed

This step shows a summary of what's different between your spreadsheet and the current data in the app.

For each section, you'll see:
- **New data** — rows in your spreadsheet that don't exist in the app yet.
- **Updated data** — rows where something changed in the spreadsheet.
- **No change** — rows that are identical in both the spreadsheet and the app.
- **Not in this upload** — rows that exist in the app but weren't in your spreadsheet. These are kept as-is.

You can click "Show details" on any section to see the specific rows.

Click **Continue** to proceed.

---

## Step 4: Needs your decision

This step only appears when there are items where **both** the app and your spreadsheet changed differently since the last import.

For each conflict, you'll see three values:
- **Last import** — what the value was when it was last imported.
- **Current app value** — what the value is now in the app (someone may have changed it).
- **Uploaded value** — what the value is in your spreadsheet.

For each conflict, you choose:
- **Keep current app value** — leave the app value as-is.
- **Use uploaded value** — replace the app value with the spreadsheet value.

You can also use the bulk buttons at the top:
- **Keep all app values** — apply "Keep current app value" to everything.
- **Use all uploaded values** — apply "Use uploaded value" to everything.

Once all decisions are made, click **Continue**.

---

## Step 5: Confirm import

This is the final step before the data is applied. You'll see a summary:

- How many new rows will be added
- How many existing rows will be updated
- How many rows have no change
- How many decisions were applied (if any)
- How many rows were not in this upload and will be kept

When you're ready, click **Confirm import**.

---

## What happens after import

After a successful import:
- New rows are immediately available in the app.
- Updated rows reflect the new values.
- Unchanged rows remain exactly as they were.
- Dashboard summaries may take a moment to update — this is normal.

---

## Common questions

### What does "Not in this upload" mean?

It means a row exists in the app from a previous import, but it wasn't included in your latest spreadsheet. The system keeps these rows unchanged. They are not deleted.

This typically happens when:
- You exported only part of the data from the master tracker.
- Some rows were removed from the tracker but still exist in the app.

### What if I upload the same file twice?

If nothing has changed in the file or the app since the last import, the system will show all rows as "No change" and nothing will be modified.

### What if someone else edited data in the app?

If someone changed a value in the app, and your spreadsheet has a different value for the same field, you'll be asked to choose which value to keep (Step 4). This protects app edits from being accidentally overwritten.

### Can I upload a folder of files?

Yes. Click "Browse Folder" and select the folder. Each Excel file will be uploaded and processed as a separate import. You can review each one individually.

### Can I undo an import?

Contact your administrator. The system keeps a full history of all imports and can roll back to a previous state if needed.
