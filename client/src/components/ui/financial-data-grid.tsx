import * as React from "react";
import { cn } from "@/lib/utils";
import { formatRand, formatPercent } from "@/lib/safeMoney";
import { ChevronDown, ChevronUp, ArrowUpDown } from "lucide-react";

export type ColumnFormat = "currency" | "percent" | "number" | "text" | "date";
export type SortDirection = "asc" | "desc" | null;

export interface FinancialColumn<T> {
  key: string;
  header: string;
  format?: ColumnFormat;
  /** Extract value from row */
  accessor: (row: T) => string | number | null | undefined;
  /** Right-align (default for currency/number) */
  align?: "left" | "right" | "center";
  /** Hide on mobile */
  hideMobile?: boolean;
  /** Sortable */
  sortable?: boolean;
  /** Custom render */
  render?: (value: any, row: T) => React.ReactNode;
  /** Min width */
  minWidth?: string;
  /** Show as bold/highlighted when condition met */
  highlight?: (value: any, row: T) => boolean;
}

export interface FinancialDataGridProps<T> {
  columns: FinancialColumn<T>[];
  data: T[];
  /** Row key extractor */
  rowKey: (row: T, index: number) => string | number;
  /** Optional footer row (totals) */
  footer?: Record<string, string | number>;
  /** Loading state */
  loading?: boolean;
  /** Empty state message */
  emptyMessage?: string;
  /** Compact mode */
  compact?: boolean;
  /** Expandable row detail */
  expandedContent?: (row: T) => React.ReactNode;
  /** Max height with scroll */
  maxHeight?: string;
  className?: string;
}

function formatValue(value: any, format?: ColumnFormat): string {
  if (value === null || value === undefined || value === "") return "—";
  switch (format) {
    case "currency": return formatRand(value, { decimals: 0 });
    case "percent": return formatPercent(value, { decimals: 1 });
    case "number": return Number(value).toLocaleString("en-ZA");
    case "date": return value;
    default: return String(value);
  }
}

/**
 * Standardized financial data grid with consistent formatting, responsive column
 * hiding, sorting, and expandable rows for mobile.
 */
export function FinancialDataGrid<T>({
  columns,
  data,
  rowKey,
  footer,
  loading,
  emptyMessage = "No data available",
  compact,
  expandedContent,
  maxHeight,
  className,
}: FinancialDataGridProps<T>) {
  const [sort, setSort] = React.useState<{ key: string; dir: SortDirection }>({ key: "", dir: null });
  const [expandedRows, setExpandedRows] = React.useState<Set<string | number>>(new Set());

  const sortedData = React.useMemo(() => {
    if (!sort.key || !sort.dir) return data;
    const col = columns.find((c) => c.key === sort.key);
    if (!col) return data;
    return [...data].sort((a, b) => {
      const va = col.accessor(a);
      const vb = col.accessor(b);
      const na = Number(va) || 0;
      const nb = Number(vb) || 0;
      const diff = na - nb;
      return sort.dir === "asc" ? diff : -diff;
    });
  }, [data, sort, columns]);

  const toggleSort = (key: string) => {
    setSort((prev) => ({
      key,
      dir: prev.key === key ? (prev.dir === "asc" ? "desc" : prev.dir === "desc" ? null : "asc") : "asc",
    }));
  };

  const toggleRow = (key: string | number) => {
    setExpandedRows((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const cellPad = compact ? "px-2 py-1" : "px-3 py-2";
  const fontSize = compact ? "text-[11px]" : "text-xs";

  return (
    <div className={cn("rounded-lg border border-border/50 overflow-hidden", className)}>
      <div className={cn("overflow-x-auto", maxHeight && "overflow-y-auto")} style={maxHeight ? { maxHeight } : undefined}>
        <table className={cn("w-full", fontSize)}>
          <thead>
            <tr className="bg-muted/50 border-b border-border/50">
              {expandedContent && <th className="w-8 md:hidden" />}
              {columns.map((col) => {
                const align = col.align || (col.format === "currency" || col.format === "number" || col.format === "percent" ? "right" : "left");
                return (
                  <th
                    key={col.key}
                    className={cn(
                      cellPad,
                      "font-semibold text-muted-foreground whitespace-nowrap",
                      align === "right" ? "text-right" : align === "center" ? "text-center" : "text-left",
                      col.hideMobile && "hidden md:table-cell",
                      col.sortable && "cursor-pointer select-none hover:text-foreground",
                    )}
                    style={col.minWidth ? { minWidth: col.minWidth } : undefined}
                    onClick={col.sortable ? () => toggleSort(col.key) : undefined}
                  >
                    <span className="inline-flex items-center gap-1">
                      {col.header}
                      {col.sortable && sort.key === col.key && sort.dir && (
                        sort.dir === "asc" ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />
                      )}
                      {col.sortable && sort.key !== col.key && (
                        <ArrowUpDown className="w-3 h-3 opacity-30" />
                      )}
                    </span>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {sortedData.length === 0 && !loading ? (
              <tr>
                <td colSpan={columns.length + (expandedContent ? 1 : 0)} className="text-center py-8 text-muted-foreground">
                  {emptyMessage}
                </td>
              </tr>
            ) : (
              sortedData.map((row, i) => {
                const key = rowKey(row, i);
                const isExpanded = expandedRows.has(key);
                return (
                  <React.Fragment key={key}>
                    <tr className={cn("border-b border-border/30 hover:bg-muted/30 transition-colors", isExpanded && "bg-muted/20")}>
                      {expandedContent && (
                        <td className="w-8 text-center md:hidden">
                          <button onClick={() => toggleRow(key)} className="p-1 text-muted-foreground">
                            {isExpanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                          </button>
                        </td>
                      )}
                      {columns.map((col) => {
                        const raw = col.accessor(row);
                        const align = col.align || (col.format === "currency" || col.format === "number" || col.format === "percent" ? "right" : "left");
                        const isHighlighted = col.highlight ? col.highlight(raw, row) : false;
                        return (
                          <td
                            key={col.key}
                            className={cn(
                              cellPad,
                              "font-mono",
                              align === "right" ? "text-right" : align === "center" ? "text-center" : "text-left",
                              col.hideMobile && "hidden md:table-cell",
                              isHighlighted && "font-semibold text-foreground",
                            )}
                          >
                            {col.render ? col.render(raw, row) : formatValue(raw, col.format)}
                          </td>
                        );
                      })}
                    </tr>
                    {/* Expanded row detail — mobile */}
                    {expandedContent && isExpanded && (
                      <tr className="md:hidden">
                        <td colSpan={columns.length + 1} className="px-3 py-2 bg-muted/10">
                          {expandedContent(row)}
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })
            )}
          </tbody>
          {footer && (
            <tfoot>
              <tr className="bg-muted/50 border-t-2 border-border font-semibold">
                {expandedContent && <td className="md:hidden" />}
                {columns.map((col) => {
                  const val = footer[col.key];
                  const align = col.align || (col.format === "currency" || col.format === "number" || col.format === "percent" ? "right" : "left");
                  return (
                    <td
                      key={col.key}
                      className={cn(
                        cellPad,
                        "font-mono",
                        align === "right" ? "text-right" : align === "center" ? "text-center" : "text-left",
                        col.hideMobile && "hidden md:table-cell",
                      )}
                    >
                      {val !== undefined ? formatValue(val, col.format) : ""}
                    </td>
                  );
                })}
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
}
