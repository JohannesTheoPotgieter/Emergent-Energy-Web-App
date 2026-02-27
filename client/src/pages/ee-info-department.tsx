import { useRoute, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { 
  ArrowLeft, 
  Search, 
  ChevronDown, 
  ChevronUp, 
  Layout, 
  FileText, 
  CheckCircle2, 
  Clock, 
  AlertCircle 
} from "lucide-react";
import { useState, useMemo } from "react";
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Skeleton } from "@/components/ui/skeleton";

interface Process {
  id: string;
  slug: string;
  title: string;
  status: string;
  tags: string[];
  contentMarkdown?: string;
}

interface Stage {
  id: string;
  slug: string;
  title: string;
}

interface StageGroup {
  stage: Stage;
  processes: Process[];
}

interface DepartmentData {
  department: {
    id: string;
    slug: string;
    title: string;
    contentMarkdown: string;
  };
  stageGroups: StageGroup[];
  edges: any[];
  totalProcesses: number;
}

export default function DepartmentDrilldown() {
  const [, params] = useRoute("/ee-info/os/department/:slug");
  const [, setLocation] = useLocation();
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [stageFilter, setStageFilter] = useState<string>("all");
  const [openStages, setOpenStages] = useState<Record<string, boolean>>({});

  const { data, isLoading, error } = useQuery<DepartmentData>({
    queryKey: [`/api/ee-info/os/departments/${params?.slug}`],
    queryFn: async () => {
      const res = await fetch(`/api/ee-info/os/departments/${params?.slug}`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to fetch department data");
      return res.json();
    },
    enabled: !!params?.slug,
  });

  const toggleStage = (slug: string) => {
    setOpenStages(prev => ({ ...prev, [slug]: !prev[slug] }));
  };

  const filteredStageGroups = useMemo(() => {
    if (!data) return [];

    return data.stageGroups
      .map(group => ({
        ...group,
        processes: group.processes.filter(proc => {
          const matchesSearch = proc.title.toLowerCase().includes(searchTerm.toLowerCase());
          const matchesStatus = statusFilter === "all" || proc.status === statusFilter;
          const matchesStage = stageFilter === "all" || group.stage.slug === stageFilter;
          return matchesSearch && matchesStatus && matchesStage;
        })
      }))
      .filter(group => group.processes.length > 0);
  }, [data, searchTerm, statusFilter, stageFilter]);

  const stats = useMemo(() => {
    if (!data) return { total: 0, active: 0, draft: 0 };
    
    let total = 0;
    let active = 0;
    let draft = 0;

    data.stageGroups.forEach(group => {
      group.processes.forEach(proc => {
        total++;
        if (proc.status === "published" || proc.status === "active") active++;
        if (proc.status === "draft") draft++;
      });
    });

    return { total, active, draft };
  }, [data]);

  if (isLoading) {
    return (
      <div className="container mx-auto p-6 space-y-6">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-32 w-full" />
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Skeleton className="h-24" />
          <Skeleton className="h-24" />
          <Skeleton className="h-24" />
        </div>
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="container mx-auto p-6">
        <Card className="bg-destructive/10 border-destructive">
          <CardContent className="pt-6">
            <div className="flex items-center gap-2 text-destructive">
              <AlertCircle className="h-5 w-5" />
              <p>Error loading department data. Please try again later.</p>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-6 space-y-6 pb-20">
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink href="/ee-info/os" data-testid="link-os-map">OS Map</BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbPage data-testid="text-breadcrumb-current">{data.department.title}</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <Button 
            variant="ghost" 
            size="sm" 
            className="mb-2 -ml-2" 
            onClick={() => setLocation("/ee-info/os")}
            data-testid="button-back"
          >
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to OS Map
          </Button>
          <h1 className="text-3xl font-bold tracking-tight" data-testid="text-dept-title">{data.department.title}</h1>
          <p className="text-muted-foreground mt-1" data-testid="text-dept-description">
            {data.department.contentMarkdown || "No description available."}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card data-testid="card-stats-total">
          <CardHeader className="pb-2">
            <CardDescription>Total Processes</CardDescription>
            <CardTitle className="text-2xl">{stats.total}</CardTitle>
          </CardHeader>
        </Card>
        <Card data-testid="card-stats-active">
          <CardHeader className="pb-2">
            <CardDescription>Active</CardDescription>
            <CardTitle className="text-2xl text-green-600">{stats.active}</CardTitle>
          </CardHeader>
        </Card>
        <Card data-testid="card-stats-draft">
          <CardHeader className="pb-2">
            <CardDescription>Draft</CardDescription>
            <CardTitle className="text-2xl text-amber-600">{stats.draft}</CardTitle>
          </CardHeader>
        </Card>
      </div>

      <div className="flex flex-col md:flex-row gap-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input 
            placeholder="Search processes..." 
            className="pl-9"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            data-testid="input-search"
          />
        </div>
        <div className="flex gap-2">
          <Select value={stageFilter} onValueChange={setStageFilter}>
            <SelectTrigger className="w-[180px]" data-testid="select-stage-filter">
              <SelectValue placeholder="All Stages" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Stages</SelectItem>
              {data.stageGroups.map(g => (
                <SelectItem key={g.stage.slug} value={g.stage.slug}>{g.stage.title}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-[180px]" data-testid="select-status-filter">
              <SelectValue placeholder="All Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Status</SelectItem>
              <SelectItem value="published">Published</SelectItem>
              <SelectItem value="draft">Draft</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="space-y-4">
        {filteredStageGroups.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center text-muted-foreground">
              <p>No processes found matching your criteria.</p>
            </CardContent>
          </Card>
        ) : (
          filteredStageGroups.map((group) => (
            <Collapsible
              key={group.stage.slug}
              open={openStages[group.stage.slug] !== false}
              onOpenChange={() => toggleStage(group.stage.slug)}
              className="border rounded-lg overflow-hidden"
              data-testid={`collapsible-stage-${group.stage.slug}`}
            >
              <CollapsibleTrigger asChild>
                <Button 
                  variant="ghost" 
                  className="w-full flex items-center justify-between p-4 h-auto hover:bg-muted/50"
                  data-testid={`button-toggle-stage-${group.stage.slug}`}
                >
                  <div className="flex items-center gap-2">
                    <Layout className="h-5 w-5 text-primary" />
                    <span className="font-semibold text-lg">{group.stage.title}</span>
                    <Badge variant="secondary" className="ml-2">{group.processes.length}</Badge>
                  </div>
                  {openStages[group.stage.slug] !== false ? (
                    <ChevronUp className="h-5 w-5 text-muted-foreground" />
                  ) : (
                    <ChevronDown className="h-5 w-5 text-muted-foreground" />
                  )}
                </Button>
              </CollapsibleTrigger>
              <CollapsibleContent className="border-t">
                <div className="divide-y">
                  {group.processes.map((proc) => (
                    <div 
                      key={proc.id}
                      className="p-4 hover:bg-muted/30 cursor-pointer transition-colors flex items-center justify-between group"
                      onClick={() => setLocation(`/ee-info/os/process/${proc.slug}`)}
                      data-testid={`card-process-${proc.slug}`}
                    >
                      <div className="flex items-center gap-3">
                        <div className="p-2 rounded-md bg-primary/10 text-primary">
                          <FileText className="h-5 w-5" />
                        </div>
                        <div>
                          <div className="font-medium group-hover:text-primary transition-colors" data-testid={`text-process-title-${proc.id}`}>
                            {proc.title}
                          </div>
                          <div className="flex gap-1 mt-1">
                            {proc.tags && proc.tags.map(tag => (
                              <Badge key={tag} variant="outline" className="text-[10px] py-0 h-4">
                                {tag}
                              </Badge>
                            ))}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-4">
                        <Badge 
                          variant={proc.status === 'published' ? 'default' : 'secondary'}
                          className="capitalize"
                          data-testid={`status-process-${proc.id}`}
                        >
                          {proc.status === 'published' && <CheckCircle2 className="h-3 w-3 mr-1" />}
                          {proc.status === 'draft' && <Clock className="h-3 w-3 mr-1" />}
                          {proc.status}
                        </Badge>
                        <Button variant="ghost" size="sm" className="opacity-0 group-hover:opacity-100 transition-opacity">
                          View Details
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              </CollapsibleContent>
            </Collapsible>
          ))
        )}
      </div>
    </div>
  );
}
