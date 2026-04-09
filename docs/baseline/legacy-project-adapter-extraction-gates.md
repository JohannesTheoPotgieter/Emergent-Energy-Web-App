# Legacy Project Adapter — Extraction Gates

> Baseline locked: 2026-04-09
> Prerequisite for: extracting `mapProjectInfoToLegacyProject`, `getAllProjects`, `getProject`, `createProject`, `updateProject`, `deleteProject` from `server/storage.ts`

## Extraction gates

Every gate must be green before extracting any method in this cluster.

### Gate 1: Mapper shape equality (before/after)

- [ ] The baseline test in `qa/tests/unit/legacy-project-adapter-baseline.test.ts` passes (23 tests, all green as of baseline lock)
- [ ] After extraction, the same test passes with identical snapshot expectations
- [ ] No field added, removed, renamed, or re-defaulted during extraction

### Gate 2: All live consumers verified

- [ ] All 9 read call sites confirmed (7x `getAllProjects`, 2x `getProject`)
- [ ] Duplicate route registrations resolved or documented (3 pairs exist)
- [ ] Route registration order confirmed — which `GET /api/dashboard`, `GET /api/projects`, and `GET /api/projects/:id` variant actually serves traffic
- [ ] No new callers introduced between baseline lock and extraction

### Gate 3: Mapper location decided

- [ ] Decision made: does the mapper move to the new repository, become a standalone utility, or stay in a shared adapter module?
- [ ] If the mapper moves, all 6 internal call sites (storage.ts:564, 568, 576, 583, 599, 620) are updated
- [ ] If the mapper stays shared, import paths are verified

### Gate 4: Write/sync behavior pinned

- [ ] `createProject`, `updateProject`, `deleteProject` confirmed as dead code (0 call sites as of baseline) — or newly discovered callers documented
- [ ] Decision made: remove dead write methods from `IStorage` interface, or extract them as-is
- [ ] If extracted: `syncProjectSplitTables` and `syncProjectSplitTablesAfterInsert` dependency preserved
- [ ] If removed: `IStorage` interface updated, no downstream compile errors

### Gate 5: Fallback path preserved

- [ ] `getAllProjects` fallback through `shouldUseLegacyProjectInfoReadFallback` + `listLegacyCompatibleProjectInfo` is either preserved in the extracted location or explicitly removed with justification
- [ ] `getProject` has no fallback — this gap is either accepted or filled during extraction
- [ ] The 3-tier degradation in `listLegacyCompatibleProjectInfo` works with the extracted code path

### Gate 6: Migration column dependency resolved

- [ ] 6 mapper input columns (`phase`, `executionPhase`, `constructionStartDate`, `pdHandoverDate`, `clientHandoverDate`, `omHandoverDate`) are confirmed still readable from `project_info` at extraction time
- [ ] OR: the extracted code switches to reading from `project_execution_state` via JOIN
- [ ] OR: the fallback path handles the column absence correctly

### Gate 7: Dead code explicitly excluded

- [ ] `getProjectByCode` is out of scope and remains in `storage.ts` or is handled separately
- [ ] `deleteProjectInfo` is out of scope
- [ ] No other method accidentally pulled into the extraction

### Gate 8: Interface cleanup coordinated

- [ ] `IStorage` interface (storage.ts:84-100) updated to remove or redirect extracted methods
- [ ] No TypeScript compile errors after interface change
- [ ] Transaction support (`transaction<T>`) still works if extracted methods are called within transactions

## Risks that must be accepted or mitigated

| Risk | Severity | Mitigation |
|------|----------|------------|
| Manager write asymmetry (`manager` -> `pd` on write, `pm` -> `manager` on read) | Low (write methods are dead) | Accept if removing dead write methods; fix mapping if keeping them |
| No fallback on `getProject` | Medium | Accept or add fallback during extraction |
| Duplicate route handlers | Medium | Resolve registration order before extraction to avoid testing wrong endpoint |
| Migration columns still on `project_info` | High | Verify column existence at extraction time; extraction may need to add JOIN to `project_execution_state` |

## Recommendation

**Not ready for extraction yet.** Three blockers:

1. **Duplicate route resolution** — Must determine which of the 3 duplicate route pairs actually serves traffic before we can verify consumer behavior post-extraction.
2. **Dead write method decision** — `createProject`, `updateProject`, `deleteProject` have zero callers. Decide: remove from `IStorage` (simplifies extraction) or extract as-is (preserves interface compatibility).
3. **Migration column timing** — The mapper reads 6 columns that are migrating to `project_execution_state`. If those columns are dropped from `project_info` before extraction, the primary read path breaks. Extraction must coordinate with the column migration timeline.

Once these three are resolved, extraction can proceed safely with the baseline test as the verification harness.
