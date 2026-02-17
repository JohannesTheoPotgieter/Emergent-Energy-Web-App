import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar, ChevronLeft, ChevronRight, Search, Clock, CalendarDays, List } from "lucide-react";
import { format, startOfMonth, endOfMonth, startOfWeek, endOfWeek, addMonths, subMonths, eachDayOfInterval, isSameMonth, isSameDay, addWeeks, subWeeks, parseISO, isWithinInterval } from "date-fns";
import { Link } from "wouter";

interface LeaveEvent {
  id: number;
  externalLeaveId: string;
  employeeDisplayName: string;
  leaveType: string | null;
  startDate: string;
  endDate: string;
  isAllDay: boolean;
  status: string;
  approvedBy: string | null;
}

interface LeaveStatus {
  isEnabled: boolean;
  lastSyncAt: string | null;
  nextSyncAt: string | null;
}

type ViewMode = "monthly" | "weekly";

const EVENT_COLORS = [
  "bg-blue-100 text-blue-800 border-blue-200",
  "bg-green-100 text-green-800 border-green-200",
  "bg-purple-100 text-purple-800 border-purple-200",
  "bg-amber-100 text-amber-800 border-amber-200",
  "bg-rose-100 text-rose-800 border-rose-200",
  "bg-teal-100 text-teal-800 border-teal-200",
  "bg-indigo-100 text-indigo-800 border-indigo-200",
  "bg-orange-100 text-orange-800 border-orange-200",
];

function getEventColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return EVENT_COLORS[Math.abs(hash) % EVENT_COLORS.length];
}

function formatEventLabel(event: LeaveEvent): string {
  if (event.leaveType) {
    return `OOO (${event.leaveType}) – ${event.employeeDisplayName}`;
  }
  return `OOO – ${event.employeeDisplayName}`;
}

function getEventsForDay(events: LeaveEvent[], day: Date): LeaveEvent[] {
  return events.filter((event) => {
    const start = parseISO(event.startDate);
    const end = parseISO(event.endDate);
    return isWithinInterval(day, { start, end }) || isSameDay(day, start) || isSameDay(day, end);
  });
}

export default function LeaveCalendarPage() {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [viewMode, setViewMode] = useState<ViewMode>("monthly");
  const [searchQuery, setSearchQuery] = useState("");

  const dateRange = viewMode === "monthly"
    ? {
        from: format(startOfWeek(startOfMonth(currentDate), { weekStartsOn: 1 }), "yyyy-MM-dd"),
        to: format(endOfWeek(endOfMonth(currentDate), { weekStartsOn: 1 }), "yyyy-MM-dd"),
      }
    : {
        from: format(startOfWeek(currentDate, { weekStartsOn: 1 }), "yyyy-MM-dd"),
        to: format(endOfWeek(currentDate, { weekStartsOn: 1 }), "yyyy-MM-dd"),
      };

  const { data: events = [], isLoading: eventsLoading } = useQuery<LeaveEvent[]>({
    queryKey: ["/api/leave/events", dateRange.from, dateRange.to, searchQuery],
    queryFn: async () => {
      const params = new URLSearchParams({ from: dateRange.from, to: dateRange.to });
      if (searchQuery.trim()) params.set("employee", searchQuery.trim());
      const res = await fetch(`/api/leave/events?${params}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load leave events");
      return res.json();
    },
  });

  const { data: status } = useQuery<LeaveStatus>({
    queryKey: ["/api/leave/status"],
    queryFn: async () => {
      const res = await fetch("/api/leave/status", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load leave status");
      return res.json();
    },
  });

  const calendarDays = viewMode === "monthly"
    ? eachDayOfInterval({
        start: startOfWeek(startOfMonth(currentDate), { weekStartsOn: 1 }),
        end: endOfWeek(endOfMonth(currentDate), { weekStartsOn: 1 }),
      })
    : eachDayOfInterval({
        start: startOfWeek(currentDate, { weekStartsOn: 1 }),
        end: endOfWeek(currentDate, { weekStartsOn: 1 }),
      });

  const navigateBack = () => {
    setCurrentDate(viewMode === "monthly" ? subMonths(currentDate, 1) : subWeeks(currentDate, 1));
  };

  const navigateForward = () => {
    setCurrentDate(viewMode === "monthly" ? addMonths(currentDate, 1) : addWeeks(currentDate, 1));
  };

  const goToToday = () => setCurrentDate(new Date());

  const weekDays = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

  return (
    <div className="space-y-6 max-w-[1200px] mx-auto" data-testid="leave-calendar-page">
      <header>
        <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-gray-900 dark:text-gray-50 flex items-center gap-2" data-testid="text-page-title">
          <CalendarDays className="h-7 w-7 text-blue-600" />
          Leave Calendar
        </h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          View team out-of-office schedules
        </p>
      </header>

      <nav className="flex items-center gap-1 border-b pb-2" data-testid="nav-leave-tabs">
        <Link href="/leave">
          <Button variant="ghost" size="sm" data-testid="link-leave-calendar">
            <CalendarDays className="h-4 w-4 mr-1" />
            Calendar
          </Button>
        </Link>
        <Link href="/leave/list">
          <Button variant="ghost" size="sm" data-testid="link-leave-list">
            <List className="h-4 w-4 mr-1" />
            List
          </Button>
        </Link>
        <Link href="/leave/ledger">
          <Button variant="ghost" size="sm" data-testid="link-leave-ledger">
            <Calendar className="h-4 w-4 mr-1" />
            Ledger
          </Button>
        </Link>
      </nav>

      {status && (
        <div className="flex flex-wrap items-center gap-4 text-sm text-gray-500 dark:text-gray-400 bg-muted/50 rounded-lg px-4 py-2" data-testid="sync-status-bar">
          <div className="flex items-center gap-1.5">
            <Clock className="h-4 w-4" />
            <span data-testid="text-last-sync">
              Last successful sync: {status.lastSyncAt ? format(parseISO(status.lastSyncAt), "dd MMM yyyy, HH:mm") : "Never"}
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            <Clock className="h-4 w-4" />
            <span data-testid="text-next-sync">
              Next scheduled sync: {status.nextSyncAt ? format(parseISO(status.nextSyncAt), "dd MMM yyyy, HH:mm") : "Not scheduled"}
            </span>
          </div>
          <Badge variant={status.isEnabled ? "default" : "secondary"} data-testid="badge-sync-status">
            {status.isEnabled ? "Sync Enabled" : "Sync Disabled"}
          </Badge>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" onClick={navigateBack} data-testid="button-prev">
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <h2 className="text-lg font-semibold min-w-[180px] text-center" data-testid="text-current-period">
            {viewMode === "monthly"
              ? format(currentDate, "MMMM yyyy")
              : `${format(startOfWeek(currentDate, { weekStartsOn: 1 }), "dd MMM")} – ${format(endOfWeek(currentDate, { weekStartsOn: 1 }), "dd MMM yyyy")}`}
          </h2>
          <Button variant="outline" size="icon" onClick={navigateForward} data-testid="button-next">
            <ChevronRight className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="sm" onClick={goToToday} data-testid="button-today">
            Today
          </Button>
        </div>

        <div className="flex items-center gap-3">
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search employee..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9 w-[200px]"
              data-testid="input-search-employee"
            />
          </div>
          <div className="flex items-center border rounded-md">
            <Button
              variant={viewMode === "monthly" ? "default" : "ghost"}
              size="sm"
              onClick={() => setViewMode("monthly")}
              data-testid="button-view-monthly"
            >
              Month
            </Button>
            <Button
              variant={viewMode === "weekly" ? "default" : "ghost"}
              size="sm"
              onClick={() => setViewMode("weekly")}
              data-testid="button-view-weekly"
            >
              Week
            </Button>
          </div>
        </div>
      </div>

      <Card data-testid="card-calendar">
        <CardContent className="p-0">
          {eventsLoading ? (
            <div className="flex items-center justify-center py-20" data-testid="loading-spinner">
              <div className="h-8 w-8 animate-spin rounded-full border-4 border-blue-500 border-t-transparent" />
            </div>
          ) : (
            <div>
              <div className="grid grid-cols-7 border-b">
                {weekDays.map((day) => (
                  <div
                    key={day}
                    className="px-2 py-2 text-center text-xs font-medium text-muted-foreground uppercase tracking-wide"
                    data-testid={`header-day-${day.toLowerCase()}`}
                  >
                    {day}
                  </div>
                ))}
              </div>

              <div className="grid grid-cols-7">
                {calendarDays.map((day) => {
                  const dayEvents = getEventsForDay(events, day);
                  const isCurrentMonth = isSameMonth(day, currentDate);
                  const isToday = isSameDay(day, new Date());

                  return (
                    <div
                      key={day.toISOString()}
                      className={`min-h-[100px] border-b border-r p-1 ${
                        !isCurrentMonth && viewMode === "monthly" ? "bg-muted/30" : ""
                      }`}
                      data-testid={`cell-day-${format(day, "yyyy-MM-dd")}`}
                    >
                      <div className="flex items-center justify-between mb-1">
                        <span
                          className={`text-xs font-medium px-1.5 py-0.5 rounded-full ${
                            isToday
                              ? "bg-blue-600 text-white"
                              : !isCurrentMonth && viewMode === "monthly"
                              ? "text-muted-foreground/50"
                              : "text-gray-700 dark:text-gray-300"
                          }`}
                          data-testid={`text-day-number-${format(day, "yyyy-MM-dd")}`}
                        >
                          {format(day, "d")}
                        </span>
                        {dayEvents.length > 0 && (
                          <Badge variant="secondary" className="text-[10px] h-4 px-1" data-testid={`badge-event-count-${format(day, "yyyy-MM-dd")}`}>
                            {dayEvents.length}
                          </Badge>
                        )}
                      </div>
                      <div className="space-y-0.5 overflow-hidden">
                        {dayEvents.slice(0, 3).map((event) => (
                          <Popover key={event.id}>
                            <PopoverTrigger asChild>
                              <button
                                className={`w-full text-left text-[10px] leading-tight px-1 py-0.5 rounded border truncate cursor-pointer hover:opacity-80 ${getEventColor(event.employeeDisplayName)}`}
                                data-testid={`event-${event.id}`}
                              >
                                {formatEventLabel(event)}
                              </button>
                            </PopoverTrigger>
                            <PopoverContent className="w-72" data-testid={`popover-event-${event.id}`}>
                              <div className="space-y-2">
                                <h4 className="font-semibold text-sm" data-testid={`popover-title-${event.id}`}>
                                  {event.employeeDisplayName}
                                </h4>
                                {event.leaveType && (
                                  <div className="flex items-center gap-2">
                                    <span className="text-xs text-muted-foreground">Type:</span>
                                    <Badge variant="outline" className="text-xs" data-testid={`popover-type-${event.id}`}>
                                      {event.leaveType}
                                    </Badge>
                                  </div>
                                )}
                                <div className="text-xs text-muted-foreground space-y-1">
                                  <div data-testid={`popover-dates-${event.id}`}>
                                    <span className="font-medium">Dates:</span>{" "}
                                    {format(parseISO(event.startDate), "dd MMM yyyy")} – {format(parseISO(event.endDate), "dd MMM yyyy")}
                                  </div>
                                  <div data-testid={`popover-allday-${event.id}`}>
                                    <span className="font-medium">All day:</span> {event.isAllDay ? "Yes" : "No"}
                                  </div>
                                  <div data-testid={`popover-status-${event.id}`}>
                                    <span className="font-medium">Status:</span>{" "}
                                    <Badge variant={event.status === "approved" ? "default" : "secondary"} className="text-[10px]">
                                      {event.status}
                                    </Badge>
                                  </div>
                                  {event.approvedBy && (
                                    <div data-testid={`popover-approved-by-${event.id}`}>
                                      <span className="font-medium">Approved by:</span> {event.approvedBy}
                                    </div>
                                  )}
                                </div>
                              </div>
                            </PopoverContent>
                          </Popover>
                        ))}
                        {dayEvents.length > 3 && (
                          <span className="text-[10px] text-muted-foreground pl-1" data-testid={`text-more-events-${format(day, "yyyy-MM-dd")}`}>
                            +{dayEvents.length - 3} more
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
