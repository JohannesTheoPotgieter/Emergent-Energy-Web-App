# My Tool UI Discovery

## Component Tree

```
MyToolLayout (shared shell — header, nav tabs, sidebar)
├── Header: title, date, search toggle, quick add input, sidebar toggle
├── Nav tabs: Today | Week | Backlog | Priorities | Cockpit | Settings | Help
├── Main content slot (children)
└── Sidebar (right, collapsible, 272px):
    ├── Priorities (from /api/mytool/company-priorities, active only)
    ├── Next Actions (tasks with nextStep, sorted by priority, top 7)
    ├── Blocked (tasks with status=blocked|waiting)
    └── Keyboard shortcuts hint

MyToolTodayPage (/my-tool)
├── Stats strip (pinned, in_progress, planned, blocked, done counts)
├── Quick Add mobile
├── 3-column grid (lg:grid-cols-12):
│   ├── Left (col-span-3): Open Tasks grouped by project
│   │   ├── Project groups (collapsible, draggable tasks)
│   │   └── Done section (collapsed default)
│   ├── Center (col-span-5): Daily Planner
│   │   ├── All-day events banner
│   │   ├── Add block form
│   │   ├── Timeline view (6AM–9PM, 48px slots)
│   │   │   ├── Hour grid lines (clickable, droppable)
│   │   │   ├── Now indicator (red line)
│   │   │   ├── Calendar events (blue, from Outlook)
│   │   │   └── Time blocks (violet, editable/deletable)
│   │   └── Legend
│   └── Right (col-span-4): Email & Priorities
│       ├── Email Inbox section
│       │   ├── Folder browser
│       │   ├── Compose form
│       │   ├── Email detail view (with reply/replyAll/forward)
│       │   └── Email list (draggable, with email-to-task button)
│       └── Company Priorities section
│           ├── Horizon selector (today/week/month/quarter)
│           ├── Add priority form
│           ├── Escalated items
│           └── Active priorities (with convert-to-task, delete)
├── DoD Prompt Modal
└── TaskDetailDrawer (Sheet component)

MyToolWeekPage (/my-tool/week)
├── Week grid with day columns
└── Task cards per day

MyToolBacklogPage (/my-tool/backlog)
├── Filters, search
└── Full task list with TaskCard components

MyToolPrioritiesPage (/my-tool/priorities)
├── Priority CRUD with edit/delete dialogs
└── Grouped by severity

ExecCockpitPage (/my-tool/cockpit)
├── Projects at risk table
├── Milestones table
└── Overdue tasks by owner

MyToolSettingsPage (/my-tool/settings)
MyToolHelpPage (/my-tool/help)
```

## Data Sources

| Feature | API Endpoint | Query Key |
|---------|-------------|-----------|
| Tasks | GET /api/mytool/tasks?date=YYYY-MM-DD | /api/mytool/tasks?date=... |
| Time Blocks | GET /api/mytool/timeblocks?date=YYYY-MM-DD | /api/mytool/timeblocks?date=... |
| Calendar Events | GET /api/outlook/events?start=&end= | /api/outlook/events |
| Priorities | GET /api/mytool/company-priorities?horizon= | /api/mytool/company-priorities?horizon=... |
| Escalated Items | GET /api/mytool/escalated-priorities | /api/mytool/escalated-priorities |
| Emails | GET /api/outlook/messages?top=20&folder=&search= | /api/outlook/messages |
| Email Detail | GET /api/outlook/messages/:id | /api/outlook/messages/:id |
| Mail Folders | GET /api/outlook/folders | /api/outlook/folders |
| Projects | GET /api/projects-summary | /api/projects-summary |
| Cockpit | GET /api/mytool/cockpit | /api/mytool/cockpit |

## State Management

- **Server state**: TanStack React Query (useQuery/useMutation) for all API data
- **Local state**: useState hooks (no Redux/Zustand)
  - ~35 useState calls in MyToolTodayPage alone
  - Selection states: drawerTask, emailDetailId, replyMode, composeOpen
  - UI toggle states: emailInboxOpen, prioritiesOpen, doneCollapsed, showFolders, addBlockOpen, addPriorityOpen, showSearch
  - Form states: quickAddText, blockStart/End/Label, newPriority, dodPromptTask/Text, composeTo/Cc/Subject/Body, replyText, forwardTo
- **Derived state**: useMemo for tasksByProject grouping
- **localStorage**: Not currently used in Today page (no persisted UI preferences)

## Rerender Analysis

- MyToolTodayPage rerenders on ANY useState change (35+ state vars in one component)
- No React.memo on child components within the page
- tasksByProject uses useMemo (good)
- Calendar/email queries refetch based on folder/search state changes
- Mutations invalidate broad query keys, causing full list refetches

## Scroll Behavior

- Main content area: overflow-y-auto on `<main>` element
- Open tasks list: max-h-[calc(100vh-220px)] overflow-y-auto
- Planner timeline: max-h-[600px] overflow-y-auto
- Email list: max-h-[400px] overflow-y-auto
- Email detail body: max-h-[250px] overflow-y-auto
- Sidebar: overflow-y-auto on aside element
- **Issue**: 4-5 independent scroll regions on one page

## Layout Breakpoints (Current)

- lg (1024px+): 3-column grid shows
- Below 1024px: columns stack vertically
- sm (640px+): Quick add in header visible
- Mobile: Quick add inline, single column

## Dependencies on My Tool Components

- MyToolLayout used by: Today, Week, Backlog, Priorities, Settings, Help, Cockpit pages
- TaskCard used by: Today (inline rendering), Week, Backlog pages
- TaskDetailDrawer used by: Today, Backlog pages
- my-tool-nav.tsx: Standalone nav component (used by triage-inbox, unclassified-tasks)

## Performance Hotspots

1. **Monolithic MyToolTodayPage** (1334 lines, 35+ state vars) — any state change rerenders everything
2. **No list virtualization** — all tasks/emails rendered in DOM
3. **Inline planner rendering** — complex IIFE with cluster/overlap calculations runs on every render
4. **No component memoization** — task rows, email items, priority items all re-render together
5. **Broad query invalidation** — invalidateAll() triggers refetch of tasks, timeblocks, priorities simultaneously
