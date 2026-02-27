import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { 
  Card, CardHeader, CardTitle, CardContent, CardDescription 
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { 
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue 
} from "@/components/ui/select";
import { 
  LayoutDashboard, 
  MapPin, 
  Network, 
  CheckCircle2, 
  Clock, 
  RefreshCw,
  ArrowRight,
  Filter,
  Users,
  Box,
  ChevronRight
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Skeleton } from "@/components/ui/skeleton";

interface Process {
  id: string;
  slug: string;
  title: string;
  status: string;
  departmentSlug: string | null;
}

interface Department {
  id: string;
  slug: string;
  title: string;
}

interface Stage {
  id: string;
  slug: string;
  title: string;
  processes: Process[];
  departments: Department[];
}

interface LifecycleData {
  stages: Stage[];
  allDepartments: Department[];
  totalProcesses: number;
}

export default function LifecycleOverview() {
  const [, setLocation] = useLocation();
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [selectedDept, setSelectedDept] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [highlightedStage, setHighlightedStage] = useState<string | null>(null);

  const { data, isLoading, error } = useQuery<LifecycleData>({
    queryKey: ["/api/ee-info/os/lifecycle"],
    queryFn: async () => {
      const res = await fetch("/api/ee-info/os/lifecycle", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch lifecycle data");
      return res.json();
    }
  });

  const seedMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/ee-info/os/seed", { 
        method: "POST",
        credentials: "include" 
      });
      if (!res.ok) throw new Error("Failed to seed data");
      return res.json();
    },
    onSuccess: () => {
      toast({
        title: "Success",
        description: "OS Map data seeded successfully",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/ee-info/os/lifecycle"] });
    },
    onError: (err: Error) => {
      toast({
        title: "Error",
        description: err.message,
        variant: "destructive",
      });
    }
  });

  const isCOO = (user?.role as string) === "COO_ADMIN" || user?.role === "admin";

  if (isLoading) {
    return (
      <div className="p-8 space-y-6">
        <div className="flex justify-between items-center">
          <Skeleton className="h-10 w-64" />
          <Skeleton className="h-10 w-32" />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-32 w-full" />
          ))}
        </div>
        <div className="space-y-4">
          <Skeleton className="h-64 w-full" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-8 text-center">
        <h2 className="text-2xl font-bold text-red-600">Error loading lifecycle data</h2>
        <p className="text-muted-foreground">{(error as Error).message}</p>
      </div>
    );
  }

  const stages = data?.stages || [];
  const isEmpty = stages.length === 0;

  const filteredStages = stages.map(stage => {
    let filteredProcs = stage.processes;
    if (selectedDept !== "all") {
      filteredProcs = filteredProcs.filter(p => p.departmentSlug === selectedDept);
    }
    if (statusFilter === "active") {
      filteredProcs = filteredProcs.filter(p => p.status === "published");
    } else if (statusFilter === "draft") {
      filteredProcs = filteredProcs.filter(p => p.status === "draft" || p.status === "stub");
    }
    return { ...stage, processes: filteredProcs };
  });

  return (
    <div className="container mx-auto p-6 space-y-8 animate-in fade-in duration-500">
      {/* Header & Stats */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-emerald-900 dark:text-emerald-100" data-testid="text-page-title">
            Operating System Lifecycle
          </h1>
          <p className="text-muted-foreground mt-1">
            Visual roadmap of company lifecycle stages and standard operating procedures.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {isCOO && (
            <Button 
              variant="outline" 
              className="border-emerald-200 hover:bg-emerald-50 text-emerald-700"
              onClick={() => seedMutation.mutate()}
              disabled={seedMutation.isPending}
              data-testid="button-seed-data"
            >
              <RefreshCw className={`mr-2 h-4 w-4 ${seedMutation.isPending ? 'animate-spin' : ''}`} />
              Seed OS Data
            </Button>
          )}
        </div>
      </div>

      {/* Summary Stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="bg-emerald-50/50 border-emerald-100">
          <CardContent className="pt-6">
            <div className="flex items-center gap-4">
              <div className="p-3 bg-emerald-100 rounded-lg text-emerald-700">
                <LayoutDashboard className="h-6 w-6" />
              </div>
              <div>
                <p className="text-sm font-medium text-emerald-800 uppercase tracking-wider">Total Stages</p>
                <p className="text-2xl font-bold text-emerald-900" data-testid="text-stat-stages">{stages.length}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="bg-emerald-50/50 border-emerald-100">
          <CardContent className="pt-6">
            <div className="flex items-center gap-4">
              <div className="p-3 bg-emerald-100 rounded-lg text-emerald-700">
                <Users className="h-6 w-6" />
              </div>
              <div>
                <p className="text-sm font-medium text-emerald-800 uppercase tracking-wider">Departments</p>
                <p className="text-2xl font-bold text-emerald-900" data-testid="text-stat-depts">{data?.allDepartments.length || 0}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="bg-emerald-50/50 border-emerald-100">
          <CardContent className="pt-6">
            <div className="flex items-center gap-4">
              <div className="p-3 bg-emerald-100 rounded-lg text-emerald-700">
                <Box className="h-6 w-6" />
              </div>
              <div>
                <p className="text-sm font-medium text-emerald-800 uppercase tracking-wider">Managed Processes</p>
                <p className="text-2xl font-bold text-emerald-900" data-testid="text-stat-processes">{data?.totalProcesses || 0}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <Card className="border-emerald-100 shadow-sm">
        <CardContent className="p-4 flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-2">
            <Filter className="h-4 w-4 text-emerald-600" />
            <span className="text-sm font-medium text-muted-foreground">Filters:</span>
          </div>
          <div className="flex items-center gap-3">
            <Select value={selectedDept} onValueChange={setSelectedDept} data-testid="select-dept-filter">
              <SelectTrigger className="w-[200px] border-emerald-200 focus:ring-emerald-500">
                <SelectValue placeholder="All Departments" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Departments</SelectItem>
                {data?.allDepartments.map((dept) => (
                  <SelectItem key={dept.slug} value={dept.slug}>{dept.title}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={statusFilter} onValueChange={setStatusFilter} data-testid="select-status-filter">
              <SelectTrigger className="w-[160px] border-emerald-200 focus:ring-emerald-500">
                <SelectValue placeholder="All Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Statuses</SelectItem>
                <SelectItem value="active">Active Only</SelectItem>
                <SelectItem value="draft">Draft/Stub Only</SelectItem>
              </SelectContent>
            </Select>

            {(selectedDept !== "all" || statusFilter !== "all" || highlightedStage) && (
              <Button 
                variant="ghost" 
                size="sm" 
                onClick={() => {
                  setSelectedDept("all");
                  setStatusFilter("all");
                  setHighlightedStage(null);
                }}
                className="text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50"
                data-testid="button-clear-filters"
              >
                Clear
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Lifecycle Timeline */}
      {isEmpty ? (
        <div className="flex flex-col items-center justify-center py-20 border-2 border-dashed border-emerald-200 rounded-xl bg-emerald-50/20">
          <Network className="h-12 w-12 text-emerald-300 mb-4" />
          <h3 className="text-xl font-semibold text-emerald-900">No lifecycle stages found</h3>
          <p className="text-muted-foreground mb-6">Start by seeding the initial OS map data.</p>
          {isCOO && (
            <Button 
              className="bg-emerald-600 hover:bg-emerald-700"
              onClick={() => seedMutation.mutate()}
              disabled={seedMutation.isPending}
              data-testid="button-seed-empty"
            >
              Seed Data
            </Button>
          )}
        </div>
      ) : (
        <div className="relative overflow-x-auto pb-8">
          <div className="flex min-w-max gap-8 px-4">
            {filteredStages.map((stage, index) => {
              const isHighlighted = highlightedStage === stage.slug;
              const hasItems = stage.processes.length > 0;
              
              if (selectedDept !== "all" && !hasItems && !isHighlighted) return null;

              return (
                <div key={stage.slug} className="relative flex flex-col group">
                  {/* Connecting Line */}
                  {index < filteredStages.length - 1 && (
                    <div className="absolute top-1/2 -right-8 w-8 h-[2px] bg-emerald-200 z-0 hidden lg:block" />
                  )}

                  <Card 
                    className={`w-80 transition-all duration-300 cursor-pointer border-2 shadow-sm ${
                      isHighlighted 
                        ? 'border-emerald-500 ring-4 ring-emerald-50 shadow-md' 
                        : 'border-emerald-100 hover:border-emerald-300'
                    }`}
                    onClick={() => setHighlightedStage(isHighlighted ? null : stage.slug)}
                    data-testid={`card-stage-${stage.slug}`}
                  >
                    <CardHeader className="p-4 space-y-3">
                      <div className="flex items-center justify-between">
                        <Badge variant="outline" className="bg-emerald-50 text-emerald-700 border-emerald-200">
                          Stage {index + 1}
                        </Badge>
                        <div className="p-2 bg-emerald-100/50 rounded-full">
                          <MapPin className="h-4 w-4 text-emerald-600" />
                        </div>
                      </div>
                      <CardTitle className="text-lg font-bold text-emerald-900 leading-tight">
                        {stage.title}
                      </CardTitle>
                      
                      {/* Department chips */}
                      <div className="flex flex-wrap gap-1.5 mt-2">
                        {stage.departments.map(dept => (
                          <Badge 
                            key={dept.slug}
                            variant="secondary" 
                            className="bg-white hover:bg-emerald-50 text-[10px] px-1.5 py-0 h-5 border border-emerald-100 cursor-pointer transition-colors"
                            onClick={(e) => {
                              e.stopPropagation();
                              setLocation(`/ee-info/os/department/${dept.slug}`);
                            }}
                            data-testid={`badge-dept-${dept.slug}`}
                          >
                            {dept.title}
                          </Badge>
                        ))}
                      </div>
                    </CardHeader>

                    <CardContent className="p-4 pt-0 space-y-3">
                      <div className="text-xs font-semibold text-emerald-800/70 uppercase tracking-wider mb-2">
                        Key Processes ({stage.processes.length})
                      </div>
                      <div className="space-y-2">
                        {stage.processes.length > 0 ? (
                          stage.processes.slice(0, 5).map(proc => (
                            <div 
                              key={proc.slug}
                              className="group/proc flex items-center justify-between p-2 rounded-lg bg-emerald-50/30 hover:bg-emerald-100/50 border border-transparent hover:border-emerald-200 transition-all cursor-pointer"
                              onClick={(e) => {
                                e.stopPropagation();
                                setLocation(`/ee-info/os/process/${proc.slug}`);
                              }}
                              data-testid={`card-process-${proc.slug}`}
                            >
                              <div className="flex items-center gap-2 min-w-0">
                                {proc.status === 'published' ? (
                                  <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
                                ) : (
                                  <Clock className="h-3.5 w-3.5 text-amber-500 shrink-0" />
                                )}
                                <span className="text-sm font-medium text-emerald-900 truncate pr-2">
                                  {proc.title}
                                </span>
                              </div>
                              <ChevronRight className="h-3.5 w-3.5 text-emerald-400 opacity-0 group-hover/proc:opacity-100 transition-opacity shrink-0" />
                            </div>
                          ))
                        ) : (
                          <div className="text-sm text-muted-foreground italic py-2 text-center">
                            No processes matched filters
                          </div>
                        )}
                        {stage.processes.length > 5 && (
                          <div className="text-[11px] text-center text-emerald-600 font-medium pt-1">
                            + {stage.processes.length - 5} more processes
                          </div>
                        )}
                      </div>

                      <Button 
                        variant="ghost" 
                        size="sm" 
                        className="w-full mt-2 text-emerald-700 hover:bg-emerald-100 hover:text-emerald-800 group"
                        onClick={(e) => {
                          e.stopPropagation();
                          setHighlightedStage(stage.slug);
                        }}
                      >
                        Details
                        <ArrowRight className="ml-2 h-3 w-3 group-hover:translate-x-1 transition-transform" />
                      </Button>
                    </CardContent>
                  </Card>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Legend / Info */}
      <div className="mt-12 flex flex-wrap gap-6 text-sm text-muted-foreground bg-white p-4 rounded-lg border border-emerald-50 shadow-sm">
        <div className="flex items-center gap-2">
          <CheckCircle2 className="h-4 w-4 text-emerald-500" />
          <span>Active / Published SOP</span>
        </div>
        <div className="flex items-center gap-2">
          <Clock className="h-4 w-4 text-amber-500" />
          <span>Draft / Stub / Pending SOP</span>
        </div>
        <div className="flex items-center gap-2 ml-auto">
          <span className="font-medium text-emerald-900">Pro Tip:</span>
          <span>Click on a stage card to highlight it and focus on its processes.</span>
        </div>
      </div>
    </div>
  );
}
