import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Calendar } from "lucide-react";
import { useProgramData } from "@/hooks/use-program-data";
import type { ProjectSummary } from "@/lib/api";

interface DateRangeBarProps {
  onDateChange?: (startDate: string | null, endDate: string | null) => void;
  onProjectChange?: (projectName: string | null) => void;
}

export function DateRangeBar({ onDateChange, onProjectChange }: DateRangeBarProps) {
  const { projectsSummary } = useProgramData();
  const [selectedProject, setSelectedProject] = useState<string>("all");
  const [startDate, setStartDate] = useState<string>("");
  const [endDate, setEndDate] = useState<string>("");

  const getCurrentFY = () => {
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth() + 1;
    
    if (month >= 9) {
      return {
        start: `${year}-09-01`,
        end: `${year + 1}-08-31`
      };
    } else {
      return {
        start: `${year - 1}-09-01`,
        end: `${year}-08-31`
      };
    }
  };

  const handleThisFY = () => {
    const fy = getCurrentFY();
    setStartDate(fy.start);
    setEndDate(fy.end);
    onDateChange?.(fy.start, fy.end);
  };

  const handleProjectChange = (value: string) => {
    setSelectedProject(value);
    onProjectChange?.(value === "all" ? null : value);
  };

  const handleDateInputChange = () => {
    const start = startDate || null;
    const end = endDate || null;
    onDateChange?.(start, end);
  };

  const handleClearDates = () => {
    setStartDate("");
    setEndDate("");
    onDateChange?.(null, null);
  };

  useEffect(() => {
    handleThisFY();
  }, []);

  return (
    <div className="bg-card border-b border-border px-6 py-4">
      <div className="flex items-center gap-4 flex-wrap">
        <div className="flex items-center gap-2">
          <Calendar className="h-5 w-5 text-muted-foreground" />
          <span className="text-sm font-medium text-foreground">Filter by:</span>
        </div>

        <Select value={selectedProject} onValueChange={handleProjectChange}>
          <SelectTrigger className="w-[250px]" data-testid="select-project">
            <SelectValue placeholder="All Projects" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Projects</SelectItem>
            {(projectsSummary || []).map((project: ProjectSummary) => (
              <SelectItem key={project.project_name} value={project.project_name}>
                {project.project_name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <div className="flex items-center gap-2">
          <Input
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            onBlur={handleDateInputChange}
            className="w-[160px]"
            data-testid="input-start-date"
          />
          <span className="text-muted-foreground">to</span>
          <Input
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            onBlur={handleDateInputChange}
            className="w-[160px]"
            data-testid="input-end-date"
          />
        </div>

        <Button
          onClick={handleThisFY}
          variant="outline"
          size="sm"
          data-testid="button-this-fy"
        >
          This FY
        </Button>

        <Button
          onClick={handleClearDates}
          variant="ghost"
          size="sm"
          data-testid="button-clear-dates"
        >
          Clear
        </Button>
      </div>
    </div>
  );
}
