/**
 * <DrillTable> — the ONE table for the compact finance template.
 *
 * Features (all token-only, all a11y-aware):
 *   - sticky header on long tables,
 *   - numeric columns right-aligned with tabular figures + consistent widths,
 *   - optional expandable rows (chevron is a real <button> with aria-expanded),
 *   - optional drill breadcrumb above the table,
 *   - source-cell links rendered by the caller via the `cell` renderer,
 *   - compact row height + subtle dividers (no heavy borders).
 *
 * Presentation only — it renders whatever the caller passes; it never fetches
 * or transforms a finance number.
 *
 *   <DrillTable
 *     breadcrumb={[{ label: "Company" }, { label: "Project Alpha" }]}
 *     columns={[
 *       { key: "name", header: "Project", cell: (r) => <Link href={r.url}>{r.name}</Link> },
 *       { key: "rev",  header: "Revenue", numeric: true, cell: (r) => <MoneyValue value={r.rev} /> },
 *     ]}
 *     rows={rows}
 *     rowKey={(r) => r.id}
 *     renderDetail={(r) => <LineDetail row={r} />}
 *   />
 */
import * as React from "react";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

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
}

export interface DrillBreadcrumbItem {
  label: React.ReactNode;
  onClick?: () => void;
}

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
  emptyLabel?: React.ReactNode;
  /** Accessible caption (visually hidden). */
  caption?: string;
  className?: string;
  "data-testid"?: string;
}

function alignClass(col: { numeric?: boolean; align?: "left" | "right" | "center" }): string {
  const a = col.align ?? (col.numeric ? "right" : "left");
  return a === "right" ? "text-right" : a === "center" ? "text-center" : "text-left";
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
  emptyLabel = "No rows.",
  caption,
  className,
  "data-testid": testId,
}: DrillTableProps<Row>) {
  const [expanded, setExpanded] = React.useState<Set<React.Key>>(new Set());
  const expandable = typeof renderDetail === "function";
  const totalCols = columns.length + (expandable ? 1 : 0);

  const toggle = (key: React.Key) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });

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

      <div className={cn("overflow-auto", maxBodyHeightClass)}>
        <table className="w-full border-collapse text-sm">
          {caption && <caption className="sr-only">{caption}</caption>}
          <thead className={cn(stickyHeader && "sticky top-0 z-10", "bg-slate-50")}>
            <tr className="border-b border-slate-200">
              {expandable && <th scope="col" className="w-8 px-2 py-2" aria-label="Expand" />}
              {columns.map((col) => (
                <th
                  key={col.key}
                  scope="col"
                  className={cn(
                    "px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500 whitespace-nowrap",
                    alignClass(col),
                    col.widthClass,
                    col.hideBelowMd && "hidden md:table-cell",
                    col.className,
                  )}
                >
                  {col.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={totalCols} className="px-3 py-8 text-center text-sm text-slate-500">
                  {emptyLabel}
                </td>
              </tr>
            ) : (
              rows.map((row, i) => {
                const key = rowKey(row, i);
                const isOpen = expanded.has(key);
                return (
                  <React.Fragment key={key}>
                    <tr
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
