# Layout primitives

Phase 1 overhaul design-system primitives. Additive and opt-in per screen.

> See `docs/overhaul/01-design-system.md §3` for contracts and `docs/overhaul/01-wireframes.md` for archetypes.

## What's here

| Primitive | Archetype | Use for |
|---|---|---|
| `AppShell` | W1 | Outermost chrome — top bar + sidebar + main + optional bottom tab bar |
| `LensNav` | W1 | Role-adaptive sidebar (filtered PAGE_REGISTRY) |
| `PageLayout` | all | `.ee-page` wrapper with optional sub-nav slot |
| `TableLayout` | W3 | List pages with toolbar / filter chips / table / pagination / bulk-action bar |
| `DetailLayout` | W4 | Detail pages with sticky summary + tab navigation |
| `FormLayout` | W5a | Single-screen forms with optional context / help panel |
| `WizardLayout` | W5b | Multi-step wizards with step rail + body + help + nav footer |

Plus the existing `ui/page-header.tsx` — **extended additively** with `status`, `kpiStrip`, and `sticky` props.

## Coexistence with existing code

These primitives **do not replace** existing `AppLayout.tsx` or any screen.
Migration is per-screen in Phase 3 per the overhaul rules in `CLAUDE.md`.

Existing call-sites keep working. New migrations use these primitives via:

```tsx
import {
  AppShell,
  TableLayout,
  DetailLayout,
  // ...
} from "@/components/layout";
import { PageHeader } from "@/components/ui/page-header";
import { useEntity, useEntityList } from "@/design/hooks";
```

## Quick example — list page (W3)

```tsx
import { PageLayout, TableLayout } from "@/components/layout";
import { PageHeader } from "@/components/ui/page-header";
import { useEntityList } from "@/design/hooks";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TablePagination } from "@/components/ui/table-pagination";

export function GatesPipelinePage() {
  const { data = [], isLoading } = useEntityList<Gate>("/api/gates");
  const [selectedIds, setSelectedIds] = React.useState<string[]>([]);

  return (
    <PageLayout
      header={
        <PageHeader
          breadcrumbs={[
            { label: "Portfolio", href: "/company-overview" },
            { label: "Gates" },
          ]}
          title="Gates Pipeline"
          subtitle={`${data.length} gates · updated just now`}
          actions={/* Filter / Export / + New buttons */}
        />
      }
    >
      <TableLayout
        toolbar={/* Search + filter selects */}
        activeFilters={/* Chips */}
        table={<Table>{/* ... */}</Table>}
        pagination={<TablePagination /* ... */ />}
        bulkActions={/* Reassign / Export / Archive buttons */}
        selectedCount={selectedIds.length}
        onClearSelection={() => setSelectedIds([])}
      />
    </PageLayout>
  );
}
```

## Quick example — detail page (W4)

```tsx
import { PageLayout, DetailLayout } from "@/components/layout";
import { PageHeader } from "@/components/ui/page-header";
import { useEntity } from "@/design/hooks";

export function ProjectDetailPage({ id }: { id: string }) {
  const { data: project, isLoading } = useEntity<Project>(`/api/projects/${id}`);
  const [tab, setTab] = React.useState("overview");

  if (isLoading || !project) return <LoadingState variant="skeleton-card" />;

  return (
    <PageLayout>
      <DetailLayout
        activeTab={tab}
        onTabChange={setTab}
        summary={
          <PageHeader
            breadcrumbs={[
              { label: "Projects", href: "/projects" },
              { label: project.name },
            ]}
            title={project.name}
            subtitle={`${project.code} · ${project.client} · Updated 2h ago`}
            status={<StatusBadge variant={project.rag}>On track</StatusBadge>}
            kpiStrip={/* 5 KPI tiles */}
            actions={/* Edit / Share / overflow */}
          />
        }
        tabs={[
          { key: "overview", label: "Overview", content: <Overview project={project} /> },
          { key: "tasks", label: "Tasks", count: 23, content: <TasksTab /> },
          { key: "finance", label: "Finance", content: <FinanceTab /> },
          // ...
        ]}
      />
    </PageLayout>
  );
}
```

## Quick example — wizard (W5b)

```tsx
import { WizardLayout, FormLayout } from "@/components/layout";

const STEPS = [
  { key: "scope", label: "Scope", content: <ScopeStep />, help: <ScopeHelp /> },
  { key: "tasks", label: "Tasks", content: <TasksStep /> },
  { key: "risks", label: "Risks", content: <RisksStep /> },
  { key: "finance", label: "Finance", content: <FinanceStep />, help: <FinanceHelp /> },
  { key: "summary", label: "Summary", content: <SummaryStep />, optional: true },
  { key: "review", label: "Review & submit", content: <ReviewStep /> },
];

export function WeeklyReviewWizard() {
  const [current, setCurrent] = React.useState("scope");
  const [completed, setCompleted] = React.useState(new Set<string>());

  return (
    <WizardLayout
      steps={STEPS}
      currentStepKey={current}
      onStepChange={setCurrent}
      completedSteps={completed}
      savedLabel="Saved 3 s ago"
      footer={<>
        <Button variant="ghost">Back</Button>
        <Button variant="secondary">Skip</Button>
        <Button>Next</Button>
      </>}
    />
  );
}
```

## Rules

1. **Never hand-pick z-index, shadow, spacing, colour.** Use `@/design/tokens` or Tailwind semantic tokens.
2. **Never hand-roll a list page layout.** Use `TableLayout`.
3. **Never hand-roll sticky-summary + tabs.** Use `DetailLayout`.
4. **Never hand-roll two-column form + help.** Use `FormLayout`.
5. **Never hand-roll step rail.** Use `WizardLayout`.
6. **Primitives are access-agnostic.** Caller filters data, caller checks permissions, caller decides what to render.

## Migration checklist — for each screen migrating to these primitives

- [ ] Read the existing screen end-to-end.
- [ ] Capture Preserved Behaviour contract in `02-function-plan.md` function entry.
- [ ] Replace hand-rolled layout with the primitive.
- [ ] Swap inline `useQuery` → `useEntity` / `useEntityList` for canonical endpoints.
- [ ] Verify every item in the Preserved Behaviour contract.
- [ ] Dark mode + reduced-motion pass.
- [ ] Commit: `enhance(<lens>/<function>): <visual|additive|finish|sot-migration> — preserves <X>, <Y>`.
