import { useMemo, useState } from "react";
import { ArrowUp, ArrowDown, ArrowUpDown } from "lucide-react";

// ── Reusable table sort + CSV export for the Execution tables ──
//
// `getValue` must be referentially stable (define it at module scope, or wrap
// in useCallback) — it is part of the sort memo's dependency list.

export type SortDir = "asc" | "desc";
export interface SortState { key: string | null; dir: SortDir }

export function useTableSort<T>(
  rows: T[],
  getValue: (row: T, key: string) => string | number | null | undefined,
  initial: SortState = { key: null, dir: "asc" },
) {
  const [sort, setSort] = useState<SortState>(initial);
  const toggle = (key: string) =>
    setSort((s) => (s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: "asc" }));

  const sorted = useMemo(() => {
    if (!sort.key) return rows;
    const key = sort.key;
    const dir = sort.dir === "asc" ? 1 : -1;
    return [...rows].sort((a, b) => {
      const av = getValue(a, key);
      const bv = getValue(b, key);
      // Nulls/blanks always sort last, regardless of direction.
      const aEmpty = av == null || av === "";
      const bEmpty = bv == null || bv === "";
      if (aEmpty && bEmpty) return 0;
      if (aEmpty) return 1;
      if (bEmpty) return -1;
      if (typeof av === "number" && typeof bv === "number") return (av - bv) * dir;
      return String(av).localeCompare(String(bv)) * dir;
    });
  }, [rows, sort, getValue]);

  return { sorted, sort, toggle };
}

export function SortHeader({
  label, sortKey, sort, onSort, align, className,
}: {
  label: string;
  /** Omit to render a non-sortable header. */
  sortKey?: string;
  sort: SortState;
  onSort: (key: string) => void;
  align?: "right";
  className?: string;
}) {
  const active = sortKey != null && sort.key === sortKey;
  return (
    <th
      className={`py-2 px-3 font-medium whitespace-nowrap ${sortKey ? "cursor-pointer select-none hover:text-foreground" : ""} ${align === "right" ? "text-right" : ""} ${className ?? ""}`}
      onClick={sortKey ? () => onSort(sortKey) : undefined}
      data-testid={sortKey ? `sort-${sortKey}` : undefined}
    >
      <span className={`inline-flex items-center gap-1 ${align === "right" ? "justify-end w-full" : ""}`}>
        {label}
        {sortKey && (active
          ? (sort.dir === "asc" ? <ArrowUp className="w-3 h-3 text-emerald-600 shrink-0" /> : <ArrowDown className="w-3 h-3 text-emerald-600 shrink-0" />)
          : <ArrowUpDown className="w-3 h-3 opacity-30 shrink-0" />)}
      </span>
    </th>
  );
}

/** Trigger a client-side CSV download of the given rows. */
export function downloadCsv(
  filename: string,
  headers: string[],
  rows: Array<Array<string | number | null | undefined>>,
) {
  const esc = (v: string | number | null | undefined) => {
    const s = v == null ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = [headers, ...rows].map((r) => r.map(esc).join(",")).join("\n");
  const blob = new Blob([`﻿${csv}`], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename.endsWith(".csv") ? filename : `${filename}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
