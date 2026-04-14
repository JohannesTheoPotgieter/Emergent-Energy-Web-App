"""
Extract API calls, button labels, and form fields from a single React page file.

Usage:
  python3 scripts/extract_page_actions.py <path-to-tsx> <screen-label> <screen-url>

Prints tab-separated rows suitable for appending to the Screen Actions sheet.
Use alongside workbook_helpers to write rows.
"""
import re
import sys
from pathlib import Path


def extract(path: Path):
    text = path.read_text(errors="replace")

    # ---- APIs ----
    apis = set()
    # apiRequest("GET", "/api/..."), apiRequest("POST", "/api/...", ...)
    for m in re.finditer(r'apiRequest\(\s*["\'](GET|POST|PUT|PATCH|DELETE)["\']\s*,\s*[`"\']([^`"\']+)', text):
        apis.add((m.group(1), m.group(2)))
    # fetch("/api/...") with optional method
    for m in re.finditer(r'fetch\(\s*[`"\']([/][^`"\']+)[`"\']', text):
        apis.add(("GET", m.group(1)))
    # useQuery(["/api/..."])
    for m in re.finditer(r'queryKey:\s*\[\s*[`"\']([/][^`"\'\]]+)', text):
        apis.add(("GET", m.group(1)))
    # queryClient.fetchQuery({ queryKey: [...] })
    # router.post/get (not applicable for frontend)

    # ---- Buttons / actions ----
    # data-testid="button-..."
    test_ids = set()
    for m in re.finditer(r'data-testid=["\'](button-[^"\']+|link-[^"\']+|tab-[^"\']+|input-[^"\']+|select-[^"\']+)["\']', text):
        test_ids.add(m.group(1))

    # Plain <Button ...>Label</Button> with simple text children
    button_labels = set()
    for m in re.finditer(r'<Button[^>]*>([^<{]{2,60})</Button>', text):
        label = m.group(1).strip()
        if label and not label.startswith("{"):
            button_labels.add(label)

    # onSubmit handlers (form submits)
    form_submits = re.findall(r'onSubmit=\{([^}]{1,60})\}', text)

    # onClick handlers (for counting)
    onclicks = re.findall(r'onClick=\{', text)

    # Mutations
    mutations = re.findall(r'useMutation\(', text)

    # Dialogs declared
    dialogs = len(re.findall(r'<Dialog\b', text))

    return {
        "apis": sorted(apis),
        "test_ids": sorted(test_ids),
        "button_labels": sorted(button_labels),
        "form_submits": form_submits,
        "onclick_count": len(onclicks),
        "mutation_count": len(mutations),
        "dialog_count": dialogs,
    }


if __name__ == "__main__":
    path = Path(sys.argv[1])
    result = extract(path)
    print(f"File: {path}")
    print(f"APIs ({len(result['apis'])}):")
    for m, u in result["apis"]:
        print(f"  {m:6s} {u}")
    print(f"data-testids ({len(result['test_ids'])}):")
    for t in result["test_ids"]:
        print(f"  {t}")
    print(f"Button labels ({len(result['button_labels'])}):")
    for b in result["button_labels"]:
        print(f"  {b}")
    print(f"onClick count: {result['onclick_count']}")
    print(f"useMutation count: {result['mutation_count']}")
    print(f"Dialog count: {result['dialog_count']}")
    print(f"Form submits: {result['form_submits']}")
