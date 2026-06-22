import { useState, useRef, useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { X, Check, Search, User, Building2 } from "lucide-react";
import {
  type AssignableDirectoryEntry,
  type AssigneeType,
  fetchAssignables,
} from "@/lib/assignables";

function getInitials(name: string): string {
  return name.split(" ").map(w => w[0]).join("").toUpperCase().slice(0, 2);
}

function getAvatarColor(name: string): string {
  const colors = [
    "bg-blue-500", "bg-emerald-500", "bg-violet-500", "bg-amber-500",
    "bg-rose-500", "bg-cyan-500", "bg-indigo-500", "bg-teal-500",
    "bg-orange-500", "bg-pink-500",
  ];
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return colors[Math.abs(hash) % colors.length];
}

export interface UserPickerValue {
  assigneeType: AssigneeType;
  assigneeId: number;
  displayLabel: string;
}

interface UserPickerProps {
  /** Current selected ID (internal user ID, counterparty ID, or contact ID) */
  value: number | string | null;
  /** Optional: assignee type of the current value (defaults to "internal_user") */
  valueType?: AssigneeType;
  /** Called when selection changes; provides full selection info */
  onValueChange: (userId: number | null, userName: string | null, assigneeType?: AssigneeType) => void;
  placeholder?: string;
  size?: "sm" | "xs";
  disabled?: boolean;
  /** Header label inside the popover */
  label?: string;
  className?: string;
  "data-testid"?: string;
  /**
   * Lock the picker to one directory and hide the Team/External toggle.
   * Use "internal" for fields that store a user id (FK to users), and
   * "external" for fields that store a counterparty id. Omit to show both.
   */
  restrictTo?: "internal" | "external";
}

/**
 * Standardized user picker component for forms.
 * Matches the UserAssignmentPicker visual style with Team/External toggle
 * and populates counterparties. Works as a controlled form input.
 */
export default function UserPicker({
  value,
  valueType = "internal_user",
  onValueChange,
  placeholder = "Select user...",
  size = "sm",
  disabled = false,
  label,
  className,
  "data-testid": testId,
  restrictTo,
}: UserPickerProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [directoryMode, setDirectoryMode] = useState<"internal" | "external">(restrictTo ?? "internal");
  const inputRef = useRef<HTMLInputElement>(null);

  const { data: assignables = [] } = useQuery<AssignableDirectoryEntry[]>({
    queryKey: ["/api/assignables", "user-picker"],
    queryFn: async () => fetchAssignables(),
    staleTime: 30000,
    refetchOnWindowFocus: true,
  });

  const internalUsers = useMemo(
    () => assignables.filter((entry) => entry.assigneeType === "internal_user"),
    [assignables],
  );

  const externalEntries = useMemo(
    () => assignables.filter((entry) => entry.assigneeType !== "internal_user"),
    [assignables],
  );

  const numericValue = value != null ? Number(value) : null;

  // Find the selected entry across both internal and external
  const selectedEntry = useMemo(() => {
    if (!numericValue) return null;
    if (valueType === "internal_user") {
      return internalUsers.find((u) => u.assigneeId === numericValue) ?? null;
    }
    return externalEntries.find(
      (e) => e.assigneeType === valueType && e.assigneeId === numericValue,
    ) ?? null;
  }, [numericValue, valueType, internalUsers, externalEntries]);

  useEffect(() => {
    if (open && inputRef.current) {
      const timer = setTimeout(() => inputRef.current?.focus(), 100);
      return () => clearTimeout(timer);
    }
  }, [open]);

  const matchesSearch = (entry: AssignableDirectoryEntry) => {
    if (!search) return true;
    const query = search.toLowerCase();
    return [entry.displayLabel, entry.secondaryLabel, entry.sourceLabel, ...entry.roleTags]
      .filter(Boolean)
      .some((v) => String(v).toLowerCase().includes(query));
  };

  const filteredUsers = useMemo(
    () => internalUsers.filter(matchesSearch),
    [internalUsers, search],
  );

  const filteredExternalEntries = useMemo(
    () => externalEntries.filter(matchesSearch),
    [externalEntries, search],
  );

  const isXs = size === "xs";
  const isExternal = selectedEntry && selectedEntry.assigneeType !== "internal_user";

  return (
    <div className={className} data-testid={testId}>
      <Popover open={open} onOpenChange={(next) => { if (!disabled) setOpen(next); }}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            className={`w-full justify-start gap-2 ${isXs ? 'h-7 text-[10px] px-2' : 'h-8 text-xs px-3'} font-normal ${!selectedEntry ? 'text-muted-foreground' : 'text-foreground'}`}
            disabled={disabled}
            data-testid={testId ? `${testId}-trigger` : undefined}
          >
            {selectedEntry ? (
              <span className="inline-flex items-center gap-1.5">
                {isExternal ? (
                  <span className={`inline-flex items-center justify-center ${isXs ? 'w-4 h-4' : 'w-5 h-5'} rounded-full bg-amber-100 text-amber-700 shadow-sm`}>
                    <Building2 className={isXs ? "h-2.5 w-2.5" : "h-3 w-3"} />
                  </span>
                ) : (
                  <span className={`inline-flex items-center justify-center ${isXs ? 'w-4 h-4 text-[7px]' : 'w-5 h-5 text-[9px]'} rounded-full text-white font-bold shadow-sm ${getAvatarColor(selectedEntry.displayLabel)}`}>
                    {getInitials(selectedEntry.displayLabel)}
                  </span>
                )}
                <span className="truncate">{selectedEntry.displayLabel}</span>
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5">
                <User className={isXs ? "h-3 w-3" : "h-3.5 w-3.5"} />
                {placeholder}
              </span>
            )}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-80 p-0" align="start" side="bottom">
          <div className="px-3 pt-3 pb-2 border-b border-border/60">
            <p className="text-xs font-semibold text-foreground mb-2">{label || "Select user"}</p>
            {!restrictTo && (
              <div className="flex items-center gap-1 mb-2">
                <Button size="sm" variant={directoryMode === "internal" ? "default" : "outline"} className="h-7 text-xs flex-1" onClick={() => setDirectoryMode("internal")}>
                  <User className="h-3 w-3 mr-1" />Team
                </Button>
                <Button size="sm" variant={directoryMode === "external" ? "default" : "outline"} className="h-7 text-xs flex-1" onClick={() => setDirectoryMode("external")}>
                  <Building2 className="h-3 w-3 mr-1" />External
                </Button>
              </div>
            )}
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
              <Input
                ref={inputRef}
                className="h-8 text-xs pl-8 bg-muted/40 border-border/60"
                placeholder={directoryMode === "internal" ? "Search team members..." : "Search external parties..."}
                value={search}
                onChange={e => setSearch(e.target.value)}
                data-testid={testId ? `${testId}-search` : undefined}
              />
            </div>
          </div>
          <div className="max-h-56 overflow-y-auto p-1">
            {numericValue && (
              <button
                className="w-full flex items-center gap-2 px-3 py-2 rounded-md text-xs text-red-600 hover:bg-red-50 transition-colors mb-0.5"
                onClick={() => {
                  onValueChange(null, null, undefined);
                  setOpen(false);
                }}
                data-testid={testId ? `${testId}-clear` : undefined}
              >
                <X className="h-3.5 w-3.5" />
                Remove assignment
              </button>
            )}

            {directoryMode === "internal" && filteredUsers.map((entry) => {
              const isSelected = numericValue === entry.assigneeId && valueType === "internal_user";
              return (
                <button
                  key={entry.assigneeId}
                  className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-md text-xs transition-colors ${isSelected ? 'bg-blue-50 text-blue-700 border border-blue-200' : 'hover:bg-muted/60 text-foreground'}`}
                  onClick={() => {
                    if (!isSelected) {
                      onValueChange(entry.assigneeId, entry.displayLabel, "internal_user");
                      setOpen(false);
                    }
                  }}
                  disabled={isSelected}
                  data-testid={testId ? `${testId}-option-${entry.assigneeId}` : undefined}
                >
                  <span className={`inline-flex items-center justify-center w-6 h-6 rounded-full text-white text-[10px] font-bold shadow-sm ${getAvatarColor(entry.displayLabel)}`}>
                    {getInitials(entry.displayLabel)}
                  </span>
                  <div className="flex-1 text-left min-w-0">
                    <div className="truncate font-medium">{entry.displayLabel}</div>
                    {entry.secondaryLabel && <div className="text-[10px] text-muted-foreground truncate">{entry.secondaryLabel}</div>}
                  </div>
                  {isSelected && <Check className="h-4 w-4 text-blue-600" />}
                </button>
              );
            })}

            {directoryMode === "external" && filteredExternalEntries.map((entry) => {
              const isSelected = numericValue === entry.assigneeId && valueType === entry.assigneeType;
              return (
                <button
                  key={`${entry.assigneeType}-${entry.assigneeId}`}
                  className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-md text-xs transition-colors ${isSelected ? 'bg-blue-50 text-blue-700 border border-blue-200' : 'hover:bg-muted/60 text-foreground'}`}
                  onClick={() => {
                    if (!isSelected) {
                      onValueChange(entry.assigneeId, entry.displayLabel, entry.assigneeType);
                      setOpen(false);
                    }
                  }}
                  disabled={isSelected}
                  data-testid={testId ? `${testId}-ext-${entry.assigneeType}-${entry.assigneeId}` : undefined}
                >
                  <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-amber-100 text-amber-700 shadow-sm">
                    <Building2 className="h-3.5 w-3.5" />
                  </span>
                  <div className="flex-1 text-left min-w-0">
                    <div className="truncate font-medium">{entry.displayLabel}</div>
                    {(entry.secondaryLabel || entry.sourceLabel) && (
                      <div className="text-[10px] text-muted-foreground truncate">
                        {[entry.secondaryLabel, entry.sourceLabel].filter(Boolean).join(" — ")}
                      </div>
                    )}
                  </div>
                  {isSelected && <Check className="h-4 w-4 text-blue-600" />}
                </button>
              );
            })}

            {directoryMode === "internal" && filteredUsers.length === 0 && (
              <div className="flex flex-col items-center justify-center py-6 text-muted-foreground">
                <User className="h-5 w-5 mb-1.5 opacity-40" />
                <p className="text-xs">No team members found</p>
              </div>
            )}
            {directoryMode === "external" && filteredExternalEntries.length === 0 && (
              <div className="flex flex-col items-center justify-center py-6 text-muted-foreground">
                <Building2 className="h-5 w-5 mb-1.5 opacity-40" />
                <p className="text-xs">No external parties found</p>
              </div>
            )}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
