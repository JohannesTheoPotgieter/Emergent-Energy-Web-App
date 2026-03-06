# Future PM Expansion Map

## V1.3 Candidates

### Cross-Project RAID Rollup
- Portfolio-level RAID dashboard for Program Managers and COO
- Aggregated risk heat map across all active projects
- Automated escalation triggers based on critical risk count

### CPM Schedule Recalculation
- Automatic forward/backward pass when dependencies are created or modified
- Critical path highlighting in UnifiedPlanTab
- Float calculation and display per task

### Procurement-to-PO Auto-Linking
- When procurement item status reaches "approved", auto-generate PO draft
- Link procurement items to existing POs bidirectionally
- Supplier performance scoring based on delivery vs expected dates

### Commissioning Document Management
- File upload for evidence (photos, certificates, test reports)
- SharePoint integration for commissioning documents
- Template-based commissioning checklists per project type

### Mobile Offline Support
- PM On The Go offline capability with sync queue
- Local storage of pending actions with conflict resolution
- Background sync when connectivity restored

### Invoice Capture Enhancement
- Camera-based invoice scanning with OCR
- Auto-matching to PO references
- Three-way matching: PO → Delivery Note → Invoice

## V1.4 Candidates

### Earned Value Management (EVM)
- BCWS, BCWP, ACWP calculations
- SPI and CPI tracking per project
- Portfolio-level EVM dashboards

### Resource Leveling
- Cross-project resource allocation view
- Over-allocation warnings
- Resource utilisation heatmap

### Contract Management
- Contract register with key dates and milestones
- Amendment tracking
- Expiry notifications

### Environmental & Safety Compliance
- Environmental permit tracking
- Safety inspection checklists
- Incident reporting workflow

## Architecture Principles for Expansion
1. Every new feature must reuse `logAuditFromReq`, `requirePermission`, and `verifyToken`
2. Every new table must use `ensureXxxTables()` with `CREATE TABLE IF NOT EXISTS`
3. Every new frontend tab must use `SearchableSelect`, `react-query`, and Bearer token auth
4. Every new route must have `data-testid` attributes on interactive elements
5. No shadow databases, no bypassing the permission system, no silent fallbacks
