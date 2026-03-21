# Prompt 13 — Domain Event Emit Points

Catalogs the top 10 points in the codebase where `emitDomainEvent()` should be called. **None are wired yet** — this document serves as the implementation guide.

## Event Types

| # | Event Type | Aggregate | File | Line | Route / Context |
|---|-----------|-----------|------|------|-----------------|
| 1 | `task.status_changed` | task | `server/engineering-routes.ts` | ~690 | PATCH `/api/engineering/projects/:projectId/work-items/:id` |
| 2 | `import.committed` | import | `server/smart-import-routes.ts` | ~2403 | POST `/api/smart-import/:runId/commit` |
| 3 | `project.phase_changed` | project | `server/lifecycle-routes.ts` | ~1428 | PATCH `/api/lifecycle-board/projects/:id/phase` |
| 4 | `finance.override_applied` | finance | `server/departments/finance-routes.ts` | ~2882 | POST `/api/revenue-tracking/overrides` |
| 5 | `quality.item_updated` | quality | `server/quality-routes.ts` | ~675 | PATCH `/api/quality/:projectName/items/:itemId` |
| 6 | `engineering.deliverable_uploaded` | engineering | `server/deliverable-capture-routes.ts` | ~200 | POST `/api/deliverable-capture/upload` |
| 7 | `admin.permission_changed` | admin | `server/role-management.ts` | ~339 | POST `/api/roles` (role create) |
| 8 | `workflow.approval_decided` | workflow | `server/approvals-routes.ts` | ~549 | PATCH `/api/approvals/:id` |
| 9 | `project.created` | project | `server/lifecycle-routes.ts` | ~1219 | POST `/api/lifecycle-board/promote-engineering` |
| 10 | `review.submitted` | review | `server/weekly-review-routes.ts` | ~93 | PATCH `/api/weekly-reviews/:projectName/:id` (status=completed) |

## Emit Point Details

### 1. `task.status_changed`

**File:** `server/engineering-routes.ts:690`
**After:** `createNotification(updated.ownerUserId, "task.status_changed", ...)`

```typescript
emitDomainEventAsync({
  type: 'task.status_changed',
  aggregateType: 'task',
  aggregateId: id,
  projectId: updated.projectId,
  triggeredBy: req.user?.id,
  payload: { fromStatus: existing.status, toStatus: updates.status, taskTitle: updated.title },
});
```

### 2. `import.committed`

**File:** `server/smart-import-routes.ts:2403`
**After:** `status: "COMMITTED"` update and `res.json()`

```typescript
emitDomainEventAsync({
  type: 'import.committed',
  aggregateType: 'import',
  aggregateId: runId,
  projectId,
  triggeredBy: userId,
  payload: { counts, fileName: run.sourceFileName, projectName },
});
```

### 3. `project.phase_changed`

**File:** `server/lifecycle-routes.ts:1428`
**After:** `createProjectEvent({ eventType: "project.stage_changed" })`

```typescript
emitDomainEventAsync({
  type: 'project.phase_changed',
  aggregateType: 'project',
  aggregateId: id,
  projectId: id,
  triggeredBy: userId,
  payload: { fromPhase: existing.phase, toPhase: phase.trim() },
});
```

### 4. `finance.override_applied`

**File:** `server/departments/finance-routes.ts:2882`
**After:** `res.json({ message: "Revenue tracking overrides saved" })`

```typescript
emitDomainEventAsync({
  type: 'finance.override_applied',
  aggregateType: 'finance',
  aggregateId: saved[0]?.id ?? 0,
  projectId: null, // multiple projects possible
  triggeredBy: userId,
  payload: { overrideType: 'revenue_tracking', count: saved.length, projectNames, overrideCategory },
});
```

### 5. `quality.item_updated`

**File:** `server/quality-routes.ts:675`
**After:** `db.update(qcItemInstance).set(updates)...returning()`

```typescript
emitDomainEventAsync({
  type: 'quality.item_updated',
  aggregateType: 'quality',
  aggregateId: itemId,
  projectId: checklist.projectId,
  triggeredBy: req.user?.id,
  payload: { qmStatus: updated.qmStatus, approved: updated.approved },
});
```

### 6. `engineering.deliverable_uploaded`

**File:** `server/deliverable-capture-routes.ts:200`
**After:** `res.json({ ...deliv, assignments })`

```typescript
emitDomainEventAsync({
  type: 'engineering.deliverable_uploaded',
  aggregateType: 'engineering',
  aggregateId: deliv.id,
  projectId: deliv.projectId,
  triggeredBy: req.user?.id,
  payload: { title: deliv.title, fileName: file?.originalname, stageId: deliv.stageId },
});
```

### 7. `admin.permission_changed`

**File:** `server/role-management.ts:339`
**After:** `logPermissionAudit(req, { eventType: "role_created" })`

```typescript
emitDomainEventAsync({
  type: 'admin.permission_changed',
  aggregateType: 'admin',
  aggregateId: created.id,
  projectId: null,
  triggeredBy: req.user?.id,
  payload: { action: 'role_created', role, label, sections },
});
```

### 8. `workflow.approval_decided`

**File:** `server/approvals-routes.ts:549`
**After:** `createProjectEvent({ eventType: status === "approved" ? "approval.approved" : "approval.rejected" })`

```typescript
emitDomainEventAsync({
  type: 'workflow.approval_decided',
  aggregateType: 'workflow',
  aggregateId: updated.id,
  projectId: updated.projectId,
  triggeredBy: req.user?.id,
  payload: { decision: status, title: updated.title, approvalType: updated.approvalType },
});
```

### 9. `project.created`

**File:** `server/lifecycle-routes.ts:1219`
**After:** `createProjectEvent({ eventType: "project.created" })`

```typescript
emitDomainEventAsync({
  type: 'project.created',
  aggregateType: 'project',
  aggregateId: created.id,
  projectId: created.id,
  triggeredBy: actor.actorUserId,
  payload: { projectName: cleanName, phase: targetPhase },
});
```

### 10. `review.submitted`

**File:** `server/weekly-review-routes.ts:93`
**After:** `updates.status = "completed"` check inside PATCH handler

```typescript
emitDomainEventAsync({
  type: 'review.submitted',
  aggregateType: 'review',
  aggregateId: review.id,
  projectId: null, // resolve from projectName if needed
  triggeredBy: req.user?.id,
  payload: { projectName: req.params.projectName, weekStarting: review.weekStarting },
});
```

## Future Event Processor Architecture

```
┌──────────────┐     ┌──────────────┐     ┌─────────────────────┐
│  Route        │     │ domain_events│     │ event_subscriptions  │
│  Handler      │────>│ (INSERT)     │<────│ (event_type match)   │
│  emitEvent()  │     │ processed=   │     │ handler_name         │
└──────────────┘     │ NULL         │     └─────────────────────┘
                     └──────┬───────┘              │
                            │                      │
                     ┌──────▼───────┐     ┌────────▼──────────┐
                     │ Event        │     │ Handler Registry   │
                     │ Processor    │────>│ (JS functions)     │
                     │ (poll/cron)  │     │ refreshMetrics()   │
                     └──────┬───────┘     │ sendNotification() │
                            │             │ updateSearchIndex()│
                     ┌──────▼───────┐     └───────────────────┘
                     │ event_       │
                     │ processing   │
                     │ _log         │
                     └──────────────┘
```

### Wildcard Matching

`event_subscriptions.event_type` supports wildcards:
- `task.*` matches `task.status_changed`, `task.assigned`, etc.
- `finance.*` matches `finance.override_applied`, `finance.payment_received`, etc.
- `*` matches all events (global handler)

### Processing Guarantees

- Events are immutable once created
- Each handler execution is logged in `event_processing_log`
- Failed handlers can be retried based on `status = 'failed'`
- `processed_at` on `domain_events` is set after all subscribed handlers complete
