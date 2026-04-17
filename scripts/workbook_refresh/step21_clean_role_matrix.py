"""
Step 21: Clean Role & Permission Matrix

Two passes over the 'Role & Permission Matrix' sheet:

Pass 1 — Resolve spread notation
  The role scraper sometimes emits `...CONSTANT_NAME` when the permission
  definition used a spread like `[...ALL_STAFF_ROLES, 'EXTRA_ROLE']`. These
  are never valid role names; we parse shared/schema/users.ts, build a map of
  every exported role-array constant, then substitute each `...NAME` token
  with the roles from that constant.

Pass 2 — Remove fully-invalid rows
  After resolving spreads, any row whose entire role list consists only of
  roles that are NOT in the current COMPANY_ROLES set is dropped. Rows that
  contain at least one valid role are kept (even if some entries are
  unrecognised, to avoid false positives).

The role count column (col 4) is updated to reflect the resolved count.
"""
from __future__ import annotations

import os
import re

from _common import ROOT, open_wb, save_wb, apply_autofilter


# ---------------------------------------------------------------------------
# Parse role constants from shared/schema/users.ts
# ---------------------------------------------------------------------------

def _extract_string_list(block: str) -> list[str]:
    """Return all single- or double-quoted strings in *block*."""
    return re.findall(r"""['"]([A-Z_]+)['"]""", block)


def parse_role_constants(users_ts_path: str) -> tuple[list[str], dict[str, list[str]]]:
    """
    Parse shared/schema/users.ts and return:
      - company_roles: the canonical COMPANY_ROLES list
      - constants: { CONSTANT_NAME: [role, ...] } for every exported role array
    """
    with open(users_ts_path, encoding="utf-8") as f:
        src = f.read()

    # Extract COMPANY_ROLES (multi-line array)
    m = re.search(
        r"export\s+const\s+COMPANY_ROLES\s*=\s*\[(.*?)\]\s*as\s+const",
        src,
        re.DOTALL,
    )
    company_roles: list[str] = _extract_string_list(m.group(1)) if m else []

    # Extract every exported *_ROLES constant (single-line or multi-line array)
    constants: dict[str, list[str]] = {"COMPANY_ROLES": company_roles}

    for cm in re.finditer(
        r"export\s+const\s+([A-Z_]+ROLES[A-Z_]*)\s*(?::\s*\S+\s*)?"
        r"=\s*\[([^\]]*?)\]",
        src,
        re.DOTALL,
    ):
        name = cm.group(1)
        body = cm.group(2)
        roles = _extract_string_list(body)
        # Also expand any ...SPREAD inside the body
        for spread in re.findall(r"\.\.\.(COMPANY_ROLES|[A-Z_]+ROLES[A-Z_]*)", body):
            roles.extend(constants.get(spread, []))
        # De-duplicate while preserving order
        seen: set[str] = set()
        deduped: list[str] = []
        for r in roles:
            if r not in seen:
                seen.add(r)
                deduped.append(r)
        constants[name] = deduped

    # ALL_STAFF_ROLES is defined as [...COMPANY_ROLES] — ensure it's present
    if "ALL_STAFF_ROLES" not in constants:
        constants["ALL_STAFF_ROLES"] = list(company_roles)

    return company_roles, constants


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    users_ts = os.path.join(ROOT, "shared", "schema", "users.ts")
    company_roles, role_constants = parse_role_constants(users_ts)
    company_role_set = set(company_roles)

    if not company_roles:
        print("step21: Could not parse COMPANY_ROLES — skipping (check shared/schema/users.ts)")
        return

    wb = open_wb()
    ws = wb["Role & Permission Matrix"]
    before = ws.max_row - 1

    resolved_count = 0
    to_delete = []

    for r in range(2, ws.max_row + 1):
        raw = ws.cell(row=r, column=3).value
        if not isinstance(raw, str) or not raw.strip():
            continue

        tokens = [t.strip() for t in raw.split(",") if t.strip()]

        # Resolve any ...CONSTANT_NAME spreads
        expanded: list[str] = []
        had_spread = False
        for tok in tokens:
            if tok.startswith("..."):
                const_name = tok[3:]
                expansion = role_constants.get(const_name)
                if expansion is not None:
                    expanded.extend(expansion)
                    had_spread = True
                else:
                    # Unknown constant — keep as-is so we don't silently drop it
                    expanded.append(tok)
            else:
                expanded.append(tok)

        # De-duplicate while preserving order
        seen: set[str] = set()
        deduped: list[str] = []
        for role in expanded:
            if role not in seen:
                seen.add(role)
                deduped.append(role)

        if had_spread:
            new_value = ", ".join(deduped)
            ws.cell(row=r, column=3, value=new_value)
            ws.cell(row=r, column=4, value=len(deduped))
            resolved_count += 1

        # Pass 2: drop the row if zero valid roles remain
        valid = [role for role in deduped if role in company_role_set]
        if not valid:
            to_delete.append(r)

    for r in sorted(to_delete, reverse=True):
        ws.delete_rows(r, 1)

    after = ws.max_row - 1
    apply_autofilter(ws, ws.max_row)
    save_wb(wb)

    print(f"Role & Permission Matrix: {before} → {after} rows")
    if resolved_count:
        print(f"  {resolved_count} spread(s) resolved to explicit role lists")
    if to_delete:
        print(f"  {len(to_delete)} row(s) removed (all roles no longer in COMPANY_ROLES)")


if __name__ == "__main__":
    main()
