import { useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CalendarIcon, X } from "lucide-react";
import { format, parseISO } from "date-fns";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface DateOverridePopoverProps {
  currentDate: string | null;
  originalDate: string | null;
  hasOverride: boolean;
  overrideReason?: string | null;
  overrideAt?: string | null;
  onSave: (dateOverride: string | null, reason?: string) => void;
  disabled?: boolean;
  testId?: string;
}

export function DateOverridePopover({
  currentDate,
  originalDate,
  hasOverride,
  overrideReason,
  overrideAt,
  onSave,
  disabled = false,
  testId,
}: DateOverridePopoverProps) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState(overrideReason || "");
  const [selectedDate, setSelectedDate] = useState<Date | undefined>(
    currentDate ? parseISO(currentDate) : undefined
  );

  const handleSave = () => {
    if (selectedDate) {
      onSave(format(selectedDate, "yyyy-MM-dd"), reason || undefined);
    }
    setOpen(false);
  };

  const handleClear = () => {
    onSave(null);
    setSelectedDate(undefined);
    setReason("");
    setOpen(false);
  };

  const displayDate = currentDate
    ? format(parseISO(currentDate), "dd MMM")
    : "\u2014";

  const overrideTooltip = hasOverride
    ? `Override: ${currentDate}${overrideReason ? ` \u2014 ${overrideReason}` : ""}${overrideAt ? ` (${format(parseISO(overrideAt), "dd MMM yyyy HH:mm")})` : ""}${originalDate ? `\nOriginal: ${originalDate}` : ""}`
    : undefined;

  if (disabled) {
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <span
              className={`text-xs ${hasOverride ? "text-amber-600 font-medium" : "text-muted-foreground"}`}
            >
              {displayDate}
              {hasOverride && (
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-amber-500 ml-1 align-middle" />
              )}
            </span>
          </TooltipTrigger>
          {overrideTooltip && (
            <TooltipContent side="top" className="max-w-xs whitespace-pre-line text-xs">
              {overrideTooltip}
            </TooltipContent>
          )}
        </Tooltip>
      </TooltipProvider>
    );
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <PopoverTrigger asChild>
              <button
                className={`flex items-center gap-1 px-1 py-0.5 rounded text-xs hover:bg-blue-50 cursor-pointer transition-colors ${
                  hasOverride
                    ? "text-amber-600 font-medium"
                    : "text-muted-foreground"
                }`}
                data-testid={testId}
              >
                <CalendarIcon className="h-3 w-3 shrink-0" />
                <span>{displayDate}</span>
                {hasOverride && (
                  <span className="inline-block w-1.5 h-1.5 rounded-full bg-amber-500 ml-0.5" />
                )}
              </button>
            </PopoverTrigger>
          </TooltipTrigger>
          {overrideTooltip && (
            <TooltipContent side="top" className="max-w-xs whitespace-pre-line text-xs">
              {overrideTooltip}
            </TooltipContent>
          )}
        </Tooltip>
      </TooltipProvider>

      <PopoverContent className="w-auto p-0" align="start" side="bottom">
        <Calendar
          mode="single"
          selected={selectedDate}
          onSelect={(date) => setSelectedDate(date ?? undefined)}
          initialFocus
        />
        <div className="border-t px-3 py-2 space-y-2">
          <Input
            placeholder="Reason for override..."
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            className="h-7 text-xs"
            data-testid={testId ? `${testId}-reason` : undefined}
          />
          <div className="flex items-center justify-between gap-2">
            {hasOverride && (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-xs text-red-600 hover:text-red-700 hover:bg-red-50"
                onClick={handleClear}
                data-testid={testId ? `${testId}-clear` : undefined}
              >
                <X className="h-3 w-3 mr-1" />
                Clear Override
              </Button>
            )}
            <div className="flex-1" />
            <Button
              size="sm"
              className="h-7 text-xs"
              onClick={handleSave}
              disabled={!selectedDate}
              data-testid={testId ? `${testId}-save` : undefined}
            >
              Save Override
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
