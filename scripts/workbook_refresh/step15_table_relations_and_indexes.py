"""
Step 15: Table Relations & Database Indexes

Parses shared/**/*.ts Drizzle schema files to extract:
- Foreign key relations (`.references(() => target.col, { onDelete: ... })`)
- Indexes defined in the table's second-arg callback (`index(...)` / `uniqueIndex(...)`)

Refreshes the 'Table Relations' and 'Database Indexes' sheets. Fully mechanical.
"""
from __future__ import annotations

import re
from _common import ROOT, open_wb, save_wb, clear_data, write_rows, apply_autofilter, walk_files


# Parse all pgTable blocks across shared/ to build a JS->SQL map
# and to collect per-table content (brace-balanced) for column + callback scanning.
TABLE_DECL_RE = re.compile(
    r'export const (\w+)\s*=\s*pgTable\(\s*["\']([\w_]+)["\']\s*,\s*\{',
    re.S,
)


def parse_blocks(content: str):
    """
    Yield (js_name, sql_name, start_index, columns_body, callback_body_or_none, end_index).
    """
    out = []
    for m in TABLE_DECL_RE.finditer(content):
        js = m.group(1)
        sql = m.group(2)
        # Brace-balanced capture of columns object starting at m.end()-1 (the opening {)
        i = m.end() - 1
        assert content[i] == "{"
        depth = 0
        in_str = None
        start_cols = i + 1
        while i < len(content):
            ch = content[i]
            if in_str:
                if ch == "\\":
                    i += 2
                    continue
                if ch == in_str:
                    in_str = None
            else:
                if ch in "\"'`":
                    in_str = ch
                elif ch == "{":
                    depth += 1
                elif ch == "}":
                    depth -= 1
                    if depth == 0:
                        break
            i += 1
        end_cols = i
        columns_body = content[start_cols:end_cols]
        # After columns, expect either `)` or `, (table) => ({ ... }))`
        j = end_cols + 1
        # Skip whitespace
        while j < len(content) and content[j].isspace():
            j += 1
        callback_body = None
        if j < len(content) and content[j] == ",":
            # advance past comma
            j += 1
            while j < len(content) and content[j].isspace():
                j += 1
            # Expect `(table) => ({` or similar
            if content[j:j + 1] == "(":
                # Find the first `({` after
                arrow = content.find("=>", j)
                if arrow != -1:
                    # The object returned might be `({ ... })` or a block `{ return { ... } }`
                    k = arrow + 2
                    while k < len(content) and content[k].isspace():
                        k += 1
                    if content[k:k + 2] == "({":
                        start_cb = k + 2
                        depth = 1
                        in_str = None
                        p = start_cb
                        while p < len(content):
                            ch = content[p]
                            if in_str:
                                if ch == "\\":
                                    p += 2
                                    continue
                                if ch == in_str:
                                    in_str = None
                            else:
                                if ch in "\"'`":
                                    in_str = ch
                                elif ch == "{":
                                    depth += 1
                                elif ch == "}":
                                    depth -= 1
                                    if depth == 0:
                                        break
                            p += 1
                        callback_body = content[start_cb:p]
        out.append({
            "js": js,
            "sql": sql,
            "start": m.start(),
            "columns_body": columns_body,
            "callback_body": callback_body,
        })
    return out


def line_of(content: str, idx: int) -> int:
    return content.count("\n", 0, idx) + 1


def main():
    # First pass: build js->sql map across all files
    js_to_sql = {}
    files_data = {}
    for rel in walk_files("shared", (".ts",)):
        full = f"{ROOT}/{rel}"
        with open(full, encoding="utf-8", errors="ignore") as f:
            content = f.read()
        files_data[rel] = content
        blocks = parse_blocks(content)
        files_data[(rel, "blocks")] = blocks
        for b in blocks:
            js_to_sql[b["js"]] = b["sql"]

    # Second pass: extract relations and indexes
    col_ref_re = re.compile(
        r'(\w+):\s*\w+\s*\(\s*["\']([\w_]+)["\'][^)]*\)(?:[^,]*?)'
        r'\.references\(\s*\(\s*\)\s*=>\s*(\w+)\.(\w+)(?:\s*,\s*\{\s*onDelete:\s*["\'](\w+)["\'])?',
        re.S,
    )
    index_re = re.compile(
        r'\b(index|uniqueIndex)\s*\(\s*["\']([\w_]+)["\']\s*\)\s*\.on\(\s*([^)]*)\)',
        re.S,
    )

    relations = []
    indexes = []

    for rel, content in [(r, c) for r, c in files_data.items() if isinstance(r, str)]:
        blocks = files_data[(rel, "blocks")]
        for b in blocks:
            sql_table = b["sql"]
            cols_body = b["columns_body"]
            cb_body = b["callback_body"]
            # Offset of columns body in content (for line numbers)
            cols_start = content.find(cols_body, b["start"])

            for m in col_ref_re.finditer(cols_body):
                src_col_sql = m.group(2)
                target_js = m.group(3)
                target_col_camel = m.group(4)
                on_delete = m.group(5) or ""
                target_sql = js_to_sql.get(target_js, target_js)
                # Convert camelCase target col to snake_case heuristically
                target_col_sql = re.sub(r"([a-z0-9])([A-Z])", r"\1_\2", target_col_camel).lower()
                line = line_of(content, cols_start + m.start())
                relations.append({
                    "src_table": sql_table,
                    "src_col": src_col_sql,
                    "tgt_table": target_sql,
                    "tgt_col": target_col_sql,
                    "on_delete": on_delete,
                    "file": f"{rel}:{line}",
                })

            if cb_body:
                cb_start = content.find(cb_body, b["start"])
                for m in index_re.finditer(cb_body):
                    kind = "UNIQUE" if m.group(1) == "uniqueIndex" else "INDEX"
                    idx_name = m.group(2)
                    columns_raw = m.group(3)
                    # Extract column names: `table.projectId, table.status` -> `projectId, status`
                    cols = re.findall(r"table\.(\w+)", columns_raw)
                    cols_str = ", ".join(cols) if cols else columns_raw.strip()
                    line = line_of(content, cb_start + m.start())
                    indexes.append({
                        "table": sql_table,
                        "kind": kind,
                        "name": idx_name,
                        "cols": cols_str,
                        "file": f"{rel}:{line}",
                    })

    relations.sort(key=lambda x: (x["src_table"], x["src_col"]))
    indexes.sort(key=lambda x: (x["table"], x["name"]))

    print(f"Found {len(relations)} relations, {len(indexes)} indexes")

    wb = open_wb()

    ws = wb["Table Relations"]
    clear_data(ws)
    # Headers: Source table | Source column | References table | References column | On delete | Defined in
    rows = [[r["src_table"], r["src_col"], r["tgt_table"], r["tgt_col"], r["on_delete"], r["file"]] for r in relations]
    write_rows(ws, rows)
    apply_autofilter(ws, 1 + len(rows))
    print(f"Table Relations refreshed: {len(rows)} rows")

    ws = wb["Database Indexes"]
    clear_data(ws)
    # Headers: Table | Kind | Index name | Columns | Defined in
    rows = [[i["table"], i["kind"], i["name"], i["cols"], i["file"]] for i in indexes]
    write_rows(ws, rows)
    apply_autofilter(ws, 1 + len(rows))
    print(f"Database Indexes refreshed: {len(rows)} rows")

    save_wb(wb)


if __name__ == "__main__":
    main()
