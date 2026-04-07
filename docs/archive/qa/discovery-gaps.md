# Discovery Gaps

## Areas Requiring Manual Verification

### 1. Dynamic Route Parameters
- `/project/:projectName` — Cannot enumerate all valid project names automatically
- `/portfolios/:id` — Cannot enumerate all portfolio IDs
- `/pd/tickets/:id` — Cannot enumerate all ticket IDs
- **Mitigation:** E2E tests verify the pattern loads; specific instances require seed data

### 2. Smart Import Pipeline
- Full pipeline requires real Excel fixtures with specific column layouts
- Font color detection (status inference) cannot be unit tested without ExcelJS fixtures
- Re-run protection (duplicate detection) requires sequential imports
- **Mitigation:** Pipeline architecture documented in app-map.json; manual test procedure recommended

### 3. External Service Integrations
- **Microsoft Graph API:** Outlook calendar, SharePoint sync — requires live credentials
- **Read.ai:** Meeting webhook ingestion — requires webhook sender
- **Mitigation:** These are behind feature flags and integration configuration; mock testing not implemented

### 4. Challenge-Gated Modules
- Quality Dashboard requires `EPM_ACCESS_CODE` challenge verification
- Engineering Dashboard requires separate access code flow
- **Mitigation:** Documented in permission-map.json; requires interactive testing

### 5. WebSocket/Real-Time Features
- No WebSocket endpoints discovered — all communication is REST-based
- Polling intervals (e.g., 60s Action Hub refresh) are client-side
- **Mitigation:** No gap; polling is tested via API endpoint availability

### 6. Background Jobs
- Milestone notification checker (6h interval)
- SharePoint scheduled import checker
- Computed field backfill on startup
- Auto-archive for projects >90 days post-import
- **Mitigation:** These run on server startup; verified via server logs

### 7. Database Triggers / Constraints
- No database-level triggers discovered
- Foreign key constraints rely on application-level enforcement
- Some tables use project name strings instead of foreign key IDs
- **Mitigation:** Documented in entity-map.json; integrity depends on application logic

### 8. Large File Handling
- File upload size limits (Multer configuration)
- Excel file size limits for Smart Import
- **Mitigation:** Multer config exists but limits not tested under load

## Fully Discovered (No Gaps)

- ✅ All frontend routes enumerated (51 routes)
- ✅ All backend API endpoints mapped (78+ endpoints)
- ✅ All user roles identified (14 roles)
- ✅ All permission middleware patterns documented
- ✅ All database tables and relationships mapped
- ✅ All KPI calculations located and documented
- ✅ All dashboard widgets and their data sources identified
- ✅ Permission enforcement matrix complete
