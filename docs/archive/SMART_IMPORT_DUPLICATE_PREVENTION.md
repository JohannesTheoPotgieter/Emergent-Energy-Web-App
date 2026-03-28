# Smart Import Duplicate Prevention

## Root Cause Analysis

The smart import system uses `extractProjectNameFromFilename` to derive a project name from uploaded Excel tracker filenames. This function performed an **exact string match** against existing project names, meaning minor filename variations would create duplicate projects:

| Filename | Extracted Name | Match Result |
|---|---|---|
| `Mondi_Tracker_Rev02.xlsm` | `Mondi Tracker Rev02` | No match (exact) |
| `Mondi_Tracker_Rev03.xlsm` | `Mondi Tracker Rev03` | Creates new project |
| `Mondi Tracker.xlsx` | `Mondi Tracker` | Creates new project |
| `mondi_tracker_rev02.xlsm` | `mondi tracker rev02` | Creates new project |

This resulted in duplicate projects proliferating in the system, each with partial data from different import runs.

## Fix: Multi-Layer Duplicate Prevention

### 1. Normalized Comparison

Before matching, the extracted project name is normalized by:
- Converting to lowercase
- Stripping version suffixes (`Rev01`, `Rev02`, `v2`, `V03`, etc.)
- Removing common filler words (`tracker`, `schedule`, `master`, `final`, `draft`, `copy`)
- Stripping dates in common formats (`2025-01-15`, `20250115`, `Jan2025`, etc.)
- Removing trailing numbers and underscores
- Collapsing multiple spaces/underscores to single space
- Trimming whitespace

**Result:** `Mondi_Tracker_Rev02.xlsm` and `Mondi_Tracker_Rev03.xlsm` both normalize to `mondi`, matching the same project.

### 2. Fuzzy Matching with Confidence Scoring

When normalized exact match fails, fuzzy string matching is applied against all existing project names:

| Confidence Score | Action |
|---|---|
| **≥ 85%** | Auto-map to existing project (high confidence match) |
| **50% – 84%** | Flag as conflict — present to user for manual resolution |
| **< 50%** | Treat as genuinely new project |

The scoring algorithm considers:
- Levenshtein distance (edit distance)
- Token overlap (shared words between names)
- Prefix matching (common project name prefixes)

### 3. Explicit Project Selection Dropdown

When a match conflict is detected (50–84% confidence), the user is presented with:
- A dropdown of potential matching projects, ranked by confidence
- Option to confirm match to an existing project
- Option to create a new project (requires explicit confirmation)

### 4. Rerun Detection via SHA-256 Hash

Each imported file is hashed using SHA-256 before processing. The hash is stored with the import run record. On subsequent uploads:
- If the exact same file is uploaded again, the system detects the duplicate and warns the user
- The user can choose to skip (no re-import) or force reprocess
- Prevents accidental duplicate imports of the same file

### 5. Explicit New Project Confirmation

When a fuzzy match exists (≥ 50% confidence) but the user wants to create a new project anyway, the `confirmNewProject` flag must be explicitly set to `true` in the request. Without this flag, the system will reject the import and prompt the user to either select an existing project or explicitly confirm creation.

## New API Endpoints

### GET /api/smart-import/project-matches/:name

Returns potential project matches for a given filename-derived name.

**Response:**
```json
{
  "matches": [
    {
      "projectId": 42,
      "projectName": "Mondi Phase 2",
      "confidence": 87,
      "matchType": "normalized"
    },
    {
      "projectId": 15,
      "projectName": "Mondi Warehouse",
      "confidence": 62,
      "matchType": "fuzzy"
    }
  ],
  "normalizedInput": "mondi",
  "recommendation": "auto-map"
}
```

### PATCH /api/smart-import/:runId/assign-project

Assigns an import run to an existing project (resolving a conflict or overriding auto-detection).

**Request:**
```json
{
  "projectId": 42
}
```

**Response:**
```json
{
  "success": true,
  "runId": "abc-123",
  "assignedProjectId": 42,
  "assignedProjectName": "Mondi Phase 2"
}
```

## Import Flow (Updated)

```
1. User uploads Excel file
2. System extracts project name from filename
3. System computes SHA-256 hash
   → If hash matches previous run: warn user (rerun detected)
4. System normalizes extracted name
5. System searches for matches:
   a. Exact normalized match → auto-map
   b. Fuzzy match ≥85% → auto-map
   c. Fuzzy match 50-84% → present conflict UI
   d. No match <50% → allow new project creation
6. If conflict: user selects existing project or confirms new
   → New project requires confirmNewProject=true
7. Import proceeds with resolved project assignment
```

## Impact

- Eliminates accidental duplicate project creation from filename variations
- Provides user visibility into matching decisions
- Maintains audit trail of import decisions via stored hashes and run records
- Preserves ability to intentionally create new projects when needed
