# Recharts Charts — Monthly Report Integration Prompt

**Date:** 2026-03-23
**Purpose:** Add interactive Recharts data visualisations to the PM Monthly Report and Engineering Monthly Report pages.
**Prerequisite:** The monthly reporting module is already built and functional. This prompt adds charts to existing pages — no new routes, services, or data generation needed.

---

## CRITICAL RULES

1. **DO NOT modify any server-side files.** All data needed for charts is already in the report snapshot JSONB payload. Charts are purely frontend.
2. **DO NOT create new pages or routes.** Charts are added inline to existing tab content within `pm-monthly-report.tsx` and `engineering-monthly-report.tsx`.
3. **Follow existing codebase Recharts patterns.** The app already has 10+ files using Recharts — match their style exactly.
4. **Use the existing `ChartContainer` wrapper** from `@/components/ui/chart.tsx` for theme consistency.
5. **Read the referenced files before writing code.** Understand current layout, data shapes, and patterns.

---

## EXISTING RECHARTS PATTERNS TO FOLLOW

### Import Pattern (from `client/src/pages/portfolios.tsx`)
```typescript
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend,
  LineChart, Line,
} from "recharts";
```

### Horizontal Bar Chart Pattern (from `portfolios.tsx`)
```typescript
<ResponsiveContainer width="100%" height={Math.max(160, data.length * 32)}>
  <BarChart data={data} layout="vertical" margin={{ left: 10, right: 20, top: 5, bottom: 5 }}>
    <CartesianGrid strokeDasharray="3 3" opacity={0.15} horizontal={false} />
    <XAxis type="number" tick={{ fontSize: 10 }} />
    <YAxis type="category" dataKey="name" width={100} tick={{ fontSize: 10 }} />
    <Tooltip formatter={(v: number) => `R ${v.toLocaleString()}`} />
    <Bar dataKey="value" fill="#2563eb" radius={[0, 4, 4, 0]} barSize={12} />
    <Legend wrapperStyle={{ fontSize: 11 }} />
  </BarChart>
</ResponsiveContainer>
```

### Pie Chart Pattern (from `portfolios.tsx`)
```typescript
const PIE_COLORS = ["#4472C4", "#ED7D31", "#FFC000", "#70AD47", "#5B9BD5"];

<ResponsiveContainer width="100%" height={200}>
  <PieChart>
    <Pie data={data} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={70} label>
      {data.map((entry, idx) => <Cell key={idx} fill={PIE_COLORS[idx % PIE_COLORS.length]} />)}
    </Pie>
    <Legend wrapperStyle={{ fontSize: 11 }} />
    <Tooltip />
  </PieChart>
</ResponsiveContainer>
```

### Line Chart Pattern (from `cashflow.tsx`)
```typescript
<ResponsiveContainer width="100%" height={300}>
  <LineChart data={data} margin={{ top: 5, right: 20, left: 10, bottom: 40 }}>
    <CartesianGrid strokeDasharray="3 3" opacity={0.15} />
    <XAxis dataKey="date" tick={{ fontSize: 10 }} angle={-45} textAnchor="end" />
    <YAxis tick={{ fontSize: 10 }} />
    <Tooltip formatter={(v: number) => `R ${v.toLocaleString()}`} />
    <Line type="monotone" dataKey="value" stroke="#2563eb" strokeWidth={2} dot={false} />
  </LineChart>
</ResponsiveContainer>
```

### Chart Wrapper Component
```typescript
// Available at @/components/ui/chart.tsx
import { ChartContainer, type ChartConfig } from "@/components/ui/chart";
```

### Colour Palette
```typescript
// RAG colours (match existing RAGBadge component)
const RAG_COLORS: Record<string, string> = {
  RED: "#DC2626",
  AMBER: "#F59E0B",
  GREEN: "#10B981",
};

// Task status colours (match existing table cell colours)
const TASK_COLORS = {
  completed: "#10B981",    // emerald-600
  inProgress: "#2563EB",   // blue-600
  notStarted: "#6B7280",   // slate-500
  overdue: "#DC2626",      // red-600
};

// EE brand
const EE_GREEN = "#1a5c3a";

// General palette for multi-series charts
const SERIES_COLORS = ["#4472C4", "#ED7D31", "#FFC000", "#70AD47", "#5B9BD5", "#9B59B6"];
```

### Currency Format
South African Rand: `R ${value.toLocaleString("en-ZA", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`

---

## CHART SPECIFICATIONS — PM MONTHLY REPORT

**File:** `client/src/pages/pm-monthly-report.tsx`

### Chart 1: Revenue Trend — Stacked Bar Chart
**Location:** Inside `FinancialTab`, after Gross Profit table, before Revenue Summary table.
**Wrap in:** `<Card><CardHeader><CardTitle>Revenue Trend (12 Months)</CardTitle></CardHeader><CardContent>...</CardContent></Card>`

**Data source:** `reportData.financials.revenueTrend`
```typescript
// Raw shape from API:
{ projectName: string, projectId: number, category: string, monthEndDate: string, value: number }[]
```

**Transform for chart:**
```typescript
// Group by monthEndDate, pivot categories into columns
// X-axis: monthEndDate (sorted chronologically)
// Y-axis: value (stacked by category)
// Each category becomes a separate <Bar> with its own colour

const months = [...new Set(revenueTrend.map(r => r.monthEndDate))].sort();
const categories = [...new Set(revenueTrend.map(r => r.category))];
const chartData = months.map(m => {
  const row: Record<string, any> = { month: m };
  for (const cat of categories) {
    row[cat] = revenueTrend
      .filter(r => r.monthEndDate === m && r.category === cat)
      .reduce((sum, r) => sum + r.value, 0);
  }
  return row;
});
```

**Chart type:** `<BarChart>` with stacked `<Bar>` per category
**Height:** 300px
**Tooltip:** Currency format (`R X,XXX`)
**Legend:** Show category names

---

### Chart 2: Cashflow Trend — Multi-Line Chart
**Location:** Inside `FinancialTab`, after Revenue Trend chart.

**Data source:** `reportData.financials.cashflowTrend`
```typescript
// Raw shape:
{ projectName: string, projectId: number, seriesName: string, pointDate: string, value: number }[]
```

**Transform for chart:**
```typescript
// Group by pointDate, pivot seriesName into columns
const dates = [...new Set(cashflowTrend.map(c => c.pointDate))].sort();
const series = [...new Set(cashflowTrend.map(c => c.seriesName))];
const chartData = dates.map(d => {
  const row: Record<string, any> = { date: d };
  for (const s of series) {
    row[s] = cashflowTrend
      .filter(c => c.pointDate === d && c.seriesName === s)
      .reduce((sum, c) => sum + c.value, 0);
  }
  return row;
});
```

**Chart type:** `<LineChart>` with one `<Line>` per series
**Height:** 300px
**X-axis:** Date with angled labels
**Tooltip:** Currency format

---

### Chart 3: RAG Distribution — Pie Chart
**Location:** Inside `ProjectStatusTab`, above the project table.

**Data source:** `reportData.projectStatus`
```typescript
// Raw shape:
{ projectId: number, projectName: string, ragStatus: string | null, ... }[]
```

**Transform for chart:**
```typescript
const ragCounts = { RED: 0, AMBER: 0, GREEN: 0, Unknown: 0 };
for (const p of projectStatus) {
  const rag = (p.ragStatus || "").toUpperCase();
  if (rag === "RED") ragCounts.RED++;
  else if (rag === "AMBER") ragCounts.AMBER++;
  else if (rag === "GREEN") ragCounts.GREEN++;
  else ragCounts.Unknown++;
}
const chartData = Object.entries(ragCounts)
  .filter(([, v]) => v > 0)
  .map(([name, value]) => ({ name, value }));
```

**Chart type:** `<PieChart>` with `<Pie>` and `<Cell>` colours mapped to RAG_COLORS
**Height:** 200px
**Label:** Show count on each slice
**Legend:** Show status names

---

### Chart 4: Task Completion by Project — Horizontal Stacked Bar
**Location:** Inside `TasksTab`, after the KPI cards, before the Per-Project table.

**Data source:** `reportData.tasks.perProject`
```typescript
// Raw shape:
{ projectId: number, projectName: string, totalTasks: number, completed: number, inProgress: number, overdue: number, completionPct: number }[]
```

**Chart type:** `<BarChart layout="vertical">` with stacked bars
**Bars:** completed (green), inProgress (blue), overdue (red)
**Height:** Dynamic `Math.max(200, data.length * 28)`
**Y-axis:** Project name (truncated to 20 chars)
**X-axis:** Task count

---

## CHART SPECIFICATIONS — ENGINEERING MONTHLY REPORT

**File:** `client/src/pages/engineering-monthly-report.tsx`

### Chart 5: Engineering Task Completion — Horizontal Bar
**Location:** Inside `EngTasksTab`, above the project table.

**Data source:** `reportData.tasks.perProject`
```typescript
// Raw shape:
{ projectId: number, projectName: string, totalTasks: number, completed: number, inProgress: number, notStarted: number, overdue: number, completionPct: number, completedThisMonth: number }[]
```

**Chart type:** `<BarChart layout="vertical">` with stacked bars
**Bars:** completed (green), inProgress (blue), notStarted (grey), overdue (red)
**Height:** Dynamic
**Y-axis:** Project name

---

### Chart 6: Deliverable Status Distribution — Pie/Donut Chart
**Location:** Inside `DeliverablesTab`, after the 4 KPI cards, before the register table.

**Data source:** `reportData.deliverables.register`
```typescript
// Count by status
const statusCounts: Record<string, number> = {};
for (const d of register) {
  statusCounts[d.status] = (statusCounts[d.status] || 0) + 1;
}
const chartData = Object.entries(statusCounts).map(([name, value]) => ({ name, value }));
```

**Chart type:** `<PieChart>` with donut style (`innerRadius={40} outerRadius={70}`)
**Height:** 220px
**Colours:** Map to DELIVERABLE_STATUSES palette:
  - "TO DO": grey
  - "IN PROGRESS": blue
  - "NEEDS APPROVAL": amber
  - "QC APPROVED": green
  - "COMPLETE": emerald
  - "PROVIDE FEEDBACK": red

---

### Chart 7: Resource Workload — Grouped Bar Chart
**Location:** Inside `ResourcesTab`, above the resource table.

**Data source:** `reportData.resources`
```typescript
// Raw shape:
{ resource: string, assignedTasks: number, completedThisMonth: number, overdue: number, projectCount: number }[]
```

**Chart type:** `<BarChart>` with grouped bars
**Bars:** assignedTasks (light blue), completedThisMonth (green), overdue (red)
**X-axis:** Engineer name (truncated)
**Height:** 280px
**Legend:** Show bar meanings

---

## COMPONENT STRUCTURE

Create reusable chart components in `client/src/components/reports/charts/`:

```
client/src/components/reports/charts/
├── RevenueTrendChart.tsx        — Stacked bar, receives revenueTrend[]
├── CashflowTrendChart.tsx       — Multi-line, receives cashflowTrend[]
├── RAGDistributionChart.tsx     — Pie, receives projectStatus[]
├── TaskCompletionChart.tsx      — Horizontal stacked bar, receives perProject[]
├── DeliverableStatusChart.tsx   — Donut pie, receives register[]
└── ResourceWorkloadChart.tsx    — Grouped bar, receives resources[]
```

Each component should:
1. Accept the raw data array as a prop
2. Handle empty data gracefully (show "No data available" text)
3. Transform data internally for Recharts consumption
4. Use `<Card>` wrapper with `<CardTitle>` for heading
5. Use `<ResponsiveContainer>` with explicit height
6. Format tooltips with currency or number formatting as appropriate
7. Follow existing codebase colour palette

---

## INTEGRATION POINTS

### PM Monthly Report — `pm-monthly-report.tsx`

```typescript
// Inside FinancialTab component:
function FinancialTab({ data }: { data: any }) {
  return (
    <>
      {/* NEW: Revenue Trend Chart */}
      <RevenueTrendChart data={data.revenueTrend || []} />

      {/* NEW: Cashflow Trend Chart */}
      <CashflowTrendChart data={data.cashflowTrend || []} />

      {/* EXISTING: Gross Profit Summary table */}
      <Card>...</Card>

      {/* EXISTING: Revenue Summary table */}
      <Card>...</Card>
    </>
  );
}

// Inside ProjectStatusTab — add RAGDistributionChart above the table
// Inside TasksTab — add TaskCompletionChart between KPI cards and table
```

### Engineering Monthly Report — `engineering-monthly-report.tsx`

```typescript
// Inside EngTasksTab — add TaskCompletionChart above the table
// Inside DeliverablesTab — add DeliverableStatusChart between KPI cards and table
// Inside ResourcesTab — add ResourceWorkloadChart above the table
```

---

## FORMATTING RULES

- **Currency:** `R ${val.toLocaleString("en-ZA", { maximumFractionDigits: 0 })}` — no decimals in charts
- **Percentages:** `${val.toFixed(0)}%`
- **Dates on axes:** `DD MMM` format (e.g., "01 Jan")
- **Project names:** Truncate to 20 characters with `...`
- **Chart background:** White (match Card background)
- **Grid lines:** `strokeDasharray="3 3" opacity={0.15}`
- **Font size on axes:** 10px
- **Tooltip background:** White with shadow (Recharts default)
- **Bar radius:** `radius={[0, 4, 4, 0]}` for horizontal bars, `radius={[4, 4, 0, 0]}` for vertical bars
- **Bar size:** 12-16px for grouped charts

---

## EMPTY STATE

If chart data is empty, render:
```typescript
if (!data || data.length === 0) {
  return (
    <Card>
      <CardContent className="py-8 text-center text-muted-foreground text-sm">
        No data available for this period
      </CardContent>
    </Card>
  );
}
```

---

## TESTING CHECKLIST

- [ ] Revenue Trend chart renders with real data, shows correct month labels
- [ ] Cashflow chart renders with multiple series/lines
- [ ] RAG pie chart shows correct colour mapping (Red/Amber/Green)
- [ ] Task chart stacks correctly (completed + inProgress + overdue = total)
- [ ] Deliverable donut chart shows correct status counts
- [ ] Resource workload chart shows engineer names and task counts
- [ ] All charts handle empty data gracefully (no crash)
- [ ] All charts handle single-item data (no layout issues)
- [ ] Tooltips show correct formatted values
- [ ] Charts are responsive (resize with container)
- [ ] Charts match existing codebase visual style
- [ ] No new `any` types — use proper interfaces
- [ ] No console errors when charts render
