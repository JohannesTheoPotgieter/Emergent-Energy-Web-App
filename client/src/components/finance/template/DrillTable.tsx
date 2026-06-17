/**
 * <DrillTable> — the ONE table for the compact finance template.
 *
 * Features (all token-only, all a11y-aware):
 *   - sticky header on long tables,
 *   - numeric columns right-aligned with tabular figures + consistent widths,
 *   - optional expandable rows (chevron is a real <button> with aria-expanded),
 *   - optional drill breadcrumb above the table,
 *   - optional click-to-sort headers (pass `sortable`; per-column `sortValue`
 *     for computed/formatted cells; clears on the third click),
 *   - optional Export to CSV / Excel of ALL rows (pass `exportFilename`),
 *   - source-cell links rendered by the caller via the `cell` renderer,
 *   - compact row height + subtle dividers (no heavy borders).
 *
 * Presentation only — it renders, sorts and exports whatever the caller passes;
 * it never fetches or transforms a finance number.
 *
 *   <DrillTable
 *     sortable
 *     exportFilename="cost-of-sales-by-month"
 *     defaultSort={{ key: "rev", dir: "desc" }}
 *     columns={[
 *       { key: "name", header: "Project", cell: (r) => <Link href={r.url}>{r.name}</Link>, sortValue: (r) => r.name },
 *       { key: "rev",  header: "Revenue", numeric: true, cell: (r) => <MoneyValue value={r.rev} />, sortValue: (r) => r.rev },
 *     ]}
 *     rows={rows}
 *     rowKey={(r) => r.id}
 *     renderDetail={(r) => <LineDetail row={r} />}
 *   />
 */
import * as React from "react";
import { ChevronRight, ChevronUp, ChevronDown, ChevronsUpDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { ExportDropdown } from "@/components/ui/export-dropdown";
import type { ExportColumn } from "@/lib/export-table";

export type SortablePrimitive = string | number | boolean | null | undefined;

export interface DrillColumn<Row> {
  key: string;
  header: React.ReactNode;
  cell: (row: Row) => React.ReactNode;
  /** Right-align + tabular figures for money / counts. */
  numeric?: boolean;
  align?: "left" | "right" | "center";
  /** Fixed width class for consistent columns, e.g. "w-32". */
  widthClass?: string;
  /** Extra class for the <th> / <td>. */
  className?: string;
  /** Hide below md for responsive density. */
  hideBelowMd?: boolean;
  /**
   * Comparable value for sorting + export. Defaults to `row[key]`. Provide this
   * whenever the cell renders something other than a raw field (a Link, a
   * computed total, a formatted percentage, a status badge).
   */
  sortValue?: (row: Row) => SortablePrimitive;
  /** Set false to opt a single column out of sorting (e.g. an actions column). */
  sortable?: boolean;
  /** Plain-text header for the export (when `header` is JSX). Defaults to the
   *  header when it's a string, otherwise the column key. */
  exportHeader?: string;
  /** Value for the export. Defaults to `sortValue`, then `row[key]`. */
  exportValue?: (row: Row) => SortablePrimitive;
  /** Exclude this column from the export entirely. */
  noExport?: boolean;
}

export interface DrillBreadcrumbItem {
  label: React.ReactNode;
  onClick?: () => void;
}

export type SortDir = "asc" | "desc";

export interface DrillTableProps<Row> {
  columns: DrillColumn<Row>[];
  rows: Row[];
  rowKey: (row: Row, index: number) => React.Key;
  /** When present, each row gets an expand chevron revealing this content. */
  renderDetail?: (row: Row) => React.ReactNode;
  breadcrumb?: DrillBreadcrumbItem[];
  onRowClick?: (row: Row) => void;
  stickyHeader?: boolean;
  /** Cap body height before scrolling, e.g. "max-h-[60vh]". */
  maxBodyHeightClass?: string;
  /**
   * Scroll the row with this key to the top of the scroll body on mount (and
   * whenever the key changes). Used to default a long week/period table to the
   * current period instead of the first row. Scrolls only once per key value,
   * so a data refetch won't yank the user's scroll position back.
   */
  scrollToKey?: React.Key;
  emptyLabel?: React.ReactNode;
  /** Accessible caption (visually hidden). */
  caption?: string;
  /** Enable click-to-sort headers for every column (opt out per column with `sortable: false`). */
  sortable?: boolean;
  /** Initial sort applied when `sortable` is on. */
  defaultSort?: { key: string; dir: SortDir };
  /** Render an Export (CSV / Excel) control in a toolbar above the table; the
   *  string is the download filename stem. Exports ALL rows in the current sort order. */
  exportFilename?: string;
  /** Optional title shown on the left of the toolbar (next to Export). */
  title?: React.ReactNode;
  className?: string;
  "data-testid"?: string;
}

function alignClass(col: { numeric?: boolean; align?: "left" | "right" | "center" }): string {
  const a = col.align ?? (col.numeric ? "right" : "left");
  return a === "right" ? "text-right" : a === "center" ? "text-center" : "text-left";
}

function justifyClass(col: { numeric?: boolean; align?: "left" | "right" | "center" }): string {
  const a = col.align ?? (col.numeric ? "right" : "left");
  return a === "right" ? "justify-end" : a === "center" ? "justify-center" : "justify-start";
}

/** Comparator with nulls/blanks always last and natural (numeric-aware) ordering. */
function compareCells(a: SortablePrimitive, b: SortablePrimitive, dir: SortDir): number {
  const aNull = a == null || a === "";
  const bNull = b == null || b === "";
  if (aNull && bNull) return 0;
  if (aNull) return 1; // nulls last regardless of direction
  if (bNull) return -1;
  let base: number;
  if (typeof a === "number" && typeof b === "number") base = a - b;
  else if (typeof a === "boolean" && typeof b === "boolean") base = (a ? 1 : 0) - (b ? 1 : 0);
  else base = String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: "base" });
  return dir === "asc" ? base : -base;
}

export function DrillTable<Row>({
  columns,
  rows,
  rowKey,
  renderDetail,
  breadcrumb,
  onRowClick,
  stickyHeader = true,
  maxBodyHeightClass,
  scrollToKey,
  emptyLabel = "No rows.",
  caption,
  sortable = false,
  defaultSort,
  exportFilename,
  title,
  className,
  "data-testid": testId,
}: DrillTableProps<Row>) {
  const [expanded, setExpanded] = React.useState<Set<React.Key>>(new Set());
  const [sort, setSort] = React.useState<{ key: string; dir: SortDir } | null>(defaultSort ?? null);
  const expandable = typeof renderDetail === "function";
  const totalCols = columns.length + (expandable ? 1 : 0);

  const colSortable = (col: DrillColumn<Row>) => sortable && col.sortable !== false;

  const sortedRows = React.useMemo(() => {
    if (!sort) return rows;
    const col = columns.find((c) => c.key === sort.key);
    if (!col) return rows;
    const valueOf = (row: Row): SortablePrimitive =>
      col.sortValue ? col.sortValue(row) : ((row as Record<string, unknown>)[col.key] as SortablePrimitive);
    // Decorate with the original index for a guaranteed-stable sort (preserves
    // any secondary ordering the caller pre-applied to equal-key rows).
    return rows
      .map((row, i) => ({ row, i }))
      .sort((x, y) => {
        const c = compareCells(valueOf(x.row), valueOf(y.row), sort.dir);
        return c !== 0 ? c : x.i - y.i;
      })
      .map((d) => d.row);
  }, [rows, sort, columns]);

  const toggleSort = (col: DrillColumn<Row>) => {
    const primary: SortDir = col.numeric ? "desc" : "asc";
    setSort((prev) => {
      if (!prev || prev.key !== col.key) return { key: col.key, dir: primary };
      if (prev.dir === primary) return { key: col.key, dir: primary === "asc" ? "desc" : "asc" };
      return null; // third click clears the sort
    });
  };

  const exportColumns: ExportColumn[] = React.useMemo(
    () =>
      columns
        .filter((c) => !c.noExport)
        .map((c) => ({
          key: c.key,
          header: c.exportHeader ?? (typeof c.header === "string" ? c.header : c.key),
          value: (row: Row) =>
            (c.exportValue ? c.exportValue(row) : c.sortValue ? c.sortValue(row) : (row as Record<string, unknown>)[c.key]) as SortablePrimitive,
        })),
    [columns],
  );

  const scrollBodyRef = React.useRef<HTMLDivElement>(null);
  const theadRef = React.useRef<HTMLTableSectionElement>(null);
  const rowRefs = React.useRef(new Map<React.Key, HTMLTableRowElement>());
  const lastScrolledKey = React.useRef<React.Key | null>(null);

  React.useEffect(() => {
    if (scrollToKey == null || lastScrolledKey.current === scrollToKey) return;
    const container = scrollBodyRef.current;
    const rowEl = rowRefs.current.get(scrollToKey);
    if (!container || !rowEl) return;
    // Land the target row just below the sticky header rather than behind it.
    const headerH = theadRef.current?.offsetHeight ?? 0;
    const delta = rowEl.getBoundingClientRect().top - container.getBoundingClientRect().top - headerH;
    container.scrollTop += delta;
    lastScrolledKey.current = scrollToKey;
  }, [scrollToKey, sortedRows]);

  const toggle = (key: React.Key) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const showToolbar = !!exportFilename || title != null;

  return (
    <div className={cn("rounded-lg border border-slate-200 bg-white", className)} data-testid={testId ?? "drill-table"}>
      {breadcrumb && breadcrumb.length > 0 && (
        <nav aria-label="Drill path" className="flex items-center gap-1 px-3 py-2 border-b border-slate-100 text-xs text-slate-500">
          {breadcrumb.map((item, i) => (
            <span key={i} className="inline-flex items-center gap-1">
              {i > 0 && <ChevronRight className="h-3 w-3 text-slate-300" aria-hidden="true" />}
              {item.onClick ? (
                <button type="button" onClick={item.onClick} className="hover:text-slate-800 transition-colors">
                  {item.label}
                </button>
              ) : (
                <span className={cn(i === breadcrumb.length - 1 && "text-slate-800 font-medium")}>{item.label}</span>
              )}
            </span>
          ))}
        </nav>
      )}

      {showToolbar && (
        <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-slate-100">
          <div className="min-w-0 text-xs font-medium text-slate-500 truncate">{title}</div>
          {exportFilename && (
            <ExportDropdown data={sortedRows as unknown[]} columns={exportColumns} filename={exportFilename} />
          )}
        </div>
      )}

      <div ref={scrollBodyRef} className={cn("overflow-auto", maxBodyHeightClass)}>
        <table className="w-full border-collapse text-sm">
          {caption && <caption className="sr-only">{caption}</caption>}
          <thead ref={theadRef} className={cn(stickyHeader && "sticky top-0 z-10", "bg-slate-50")}>
            <tr className="border-b border-slate-200">
              {expandable && <th scope="col" className="w-8 px-2 py-2" aria-label="Expand" />}
              {columns.map((col) => {
                const isSortable = colSortable(col);
                const active = sort?.key === col.key;
                const ariaSort = active ? (sort!.dir === "asc" ? "ascending" : "descending") : "none";
                return (
                  <th
                    key={col.key}
                    scope="col"
                    aria-sort={isSortable ? ariaSort : undefined}
                    className={cn(
                      "px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500 whitespace-nowrap",
                      alignClass(col),
                      col.widthClass,
                      col.hideBelowMd && "hidden md:table-cell",
                      col.className,
                    )}
                  >
                    {isSortable ? (
                      <button
                        type="button"
                        onClick={() => toggleSort(col)}
                        className={cn(
                          "inline-flex items-center gap-1 uppercase tracking-wide hover:text-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 rounded",
                          justifyClass(col),
                          active && "text-slate-800",
                        )}
                        data-testid={`drill-sort-${col.key}`}
                      >
                        <span>{col.header}</span>
                        {active ? (
                          sort!.dir === "asc" ? (
                            <ChevronUp className="h-3 w-3" aria-hidden="true" />
                          ) : (
                            <ChevronDown className="h-3 w-3" aria-hidden="true" />
                          )
                        ) : (
                          <ChevronsUpDown className="h-3 w-3 text-slate-300" aria-hidden="true" />
                        )}
                      </button>
                    ) : (
                      col.header
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {sortedRows.length === 0 ? (
              <tr>
                <td colSpan={totalCols} className="px-3 py-8 text-center text-sm text-slate-500">
                  {emptyLabel}
                </td>
              </tr>
            ) : (
              sortedRows.map((row, i) => {
                const key = rowKey(row, i);
                const isOpen = expanded.has(key);
                return (
                  <React.Fragment key={key}>
                    <tr
                      ref={(el) => {
                        const m = rowRefs.current;
                        if (el) m.set(key, el);
                        else m.delete(key);
                      }}
                      className={cn(
                        "border-b border-slate-100 last:border-0 hover:bg-slate-50/70 transition-colors",
                        onRowClick && "cursor-pointer",
                      )}
                      onClick={onRowClick ? () => onRowClick(row) : undefined}
                    >
                      {expandable && (
                        <td className="px-2 py-1.5 align-middle">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              toggle(key);
                            }}
                            aria-expanded={isOpen}
                            aria-label={isOpen ? "Collapse row" : "Expand row"}
                            className="flex h-6 w-6 items-center justify-center rounded text-slate-400 hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600"
                          >
                            <ChevronRight className={cn("h-4 w-4 transition-transform", isOpen && "rotate-90")} />
                          </button>
                        </td>
                      )}
                      {columns.map((col) => (
                        <td
                          key={col.key}
                          className={cn(
                            "px-3 py-1.5 align-middle text-slate-700",
                            col.numeric && "tabular-nums",
                            alignClass(col),
                            col.widthClass,
                            col.hideBelowMd && "hidden md:table-cell",
                            col.className,
                          )}
                        >
                          {col.cell(row)}
                        </td>
                      ))}
                    </tr>
                    {expandable && isOpen && (
                      <tr className="bg-slate-50/60">
                        <td colSpan={totalCols} className="px-3 py-2">
                          {renderDetail!(row)}
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
