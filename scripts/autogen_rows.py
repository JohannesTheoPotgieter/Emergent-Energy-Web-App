"""
Generate Screen Actions rows mechanically from the extracted data.

Each page contributes:
- One row per unique API (method + URL)
- One row per unique data-testid (button / input / select / tab / link)

Descriptions are derived from:
- API verb + path → read/write sentence
- data-testid prefix (button-, input-, select-, tab-, link-) + suffix
"""
from pathlib import Path
import sys
sys.path.insert(0, str(Path(__file__).parent))
from extract_page_actions import extract


def describe_api(method, url, screen):
    """Return a (label, type, what_it_does, data_rw, nav, tables) tuple for an API."""
    # Normalise URL — strip template literal vars to make it readable
    clean = url.replace("${", "{").replace("}", "}")
    if method == "GET":
        return (
            f"(page load) GET {clean}",
            "Auto",
            f"On load, the {screen} screen calls {clean} to fetch data it needs to render.",
            "Read from the server.",
            f"Populates a section of the {screen} page.",
            "See Data Sources sheet for the handler + tables.",
        )
    else:
        return (
            f"{method} {clean}",
            "Mutation",
            f"Sends a {method} to {clean} when the user saves / triggers an action on this screen.",
            "Writes to the server.",
            "Usually re-queries the affected lists on success, shows a toast.",
            "See Data Sources sheet for the handler + tables.",
        )


def describe_testid(tid, screen, url):
    """Return a row for a data-testid."""
    prefix, _, name = tid.partition("-")
    readable = name.replace("-", " ").strip() or tid
    if prefix == "button":
        return (
            screen, url, f"`{tid}` button",
            "Button",
            f"'{readable.capitalize()}' button — triggers the '{readable}' action on the {screen} screen.",
            "Depends on the action; typically triggers a mutation or navigation (see Data Sources).",
            "Varies — some close dialogs, some save, some navigate. See the page source for the exact onClick.",
            "See Data Sources sheet.",
        )
    if prefix == "input":
        return (
            screen, url, f"`{tid}` input",
            "Form field",
            f"Input for '{readable}'. Captures the value to be submitted.",
            "Submitted as part of a form mutation.",
            "N/A until submit.",
            "Saved by the parent form's mutation.",
        )
    if prefix == "select":
        return (
            screen, url, f"`{tid}` selector",
            "Form field / Filter",
            f"Dropdown for '{readable}'. Either filters the list client-side or captures a choice to submit.",
            "Client-side filter, or submitted as part of a form.",
            "Re-renders or N/A until submit.",
            "See parent action.",
        )
    if prefix == "tab":
        return (
            screen, url, f"`{tid}` tab",
            "Tab",
            f"Switches the {screen} view to the '{readable}' tab.",
            "Switches local state; may trigger a new query.",
            "Stays on the same URL.",
            "Depends on the tab's content.",
        )
    if prefix == "link":
        return (
            screen, url, f"`{tid}` link",
            "Link",
            f"Navigates to the '{readable}' destination.",
            "Nothing on click.",
            "Varies — see source.",
            "None on click.",
        )
    return (
        screen, url, f"`{tid}`", "Other",
        f"Control '{readable}'.", "—", "—", "—",
    )


def generate_rows(tsx_path, screen, url):
    data = extract(Path(tsx_path))
    rows = []
    for method, api_url in data["apis"]:
        rows.append([screen, url, *describe_api(method, api_url, screen)[0:6]])
    for tid in data["test_ids"]:
        rows.append(list(describe_testid(tid, screen, url)))
    return rows
