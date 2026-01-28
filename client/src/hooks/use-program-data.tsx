import { createContext, useContext, ReactNode, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { dashboardApi, uploadApi, budgetsApi, overviewApi, DashboardData, CreateBudget, exportApi, OverviewData, ProjectSummary, UploadResult } from "../lib/api";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";

interface ProgramContextType {
  data: DashboardData | null;
  overview: OverviewData | null;
  projectsSummary: ProjectSummary[] | null;
  lastUploadResult: UploadResult | null;
  isLoading: boolean;
  error: Error | null;
  refreshData: () => void;
  importFiles: (files: File[]) => Promise<UploadResult>;
  addBudgetEntry: (entry: CreateBudget) => Promise<void>;
  exportUrl: (type: "projects" | "expenses" | "revenues" | "tasks" | "projects-summary") => string;
}

const ProgramContext = createContext<ProgramContextType | undefined>(undefined);

export function ProgramProvider({ children }: { children: ReactNode }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const [lastUploadResult, setLastUploadResult] = useState<UploadResult | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ["dashboard"],
    queryFn: dashboardApi.getData,
    enabled: isAuthenticated && !authLoading,
    staleTime: 30000,
    refetchOnWindowFocus: true,
  });

  const { data: overview } = useQuery({
    queryKey: ["overview"],
    queryFn: overviewApi.getData,
    enabled: isAuthenticated && !authLoading,
    staleTime: 30000,
    refetchOnWindowFocus: true,
  });

  const { data: projectsSummary } = useQuery({
    queryKey: ["projects-summary"],
    queryFn: overviewApi.getProjectsSummary,
    enabled: isAuthenticated && !authLoading,
    staleTime: 30000,
    refetchOnWindowFocus: true,
  });

  const refreshMutation = useMutation({
    mutationFn: dashboardApi.reprocessAll,
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      queryClient.invalidateQueries({ queryKey: ["overview"] });
      queryClient.invalidateQueries({ queryKey: ["projects-summary"] });
      const successCount = result.results.filter(r => r.status === "success").length;
      toast({
        title: "Data Reprocessed",
        description: `Successfully reprocessed ${successCount} of ${result.results.length} project file(s).`,
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Reprocess Failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const uploadMutation = useMutation({
    mutationFn: uploadApi.uploadFiles,
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      queryClient.invalidateQueries({ queryKey: ["overview"] });
      queryClient.invalidateQueries({ queryKey: ["projects-summary"] });
      setLastUploadResult(result);
      
      const successCount = result.results.filter(r => r.status === "success").length;
      const errorCount = result.results.filter(r => r.status === "error").length;
      const totalRecords = result.results.reduce((sum, r) => 
        sum + (r.expensesParsed || 0) + (r.inflowsParsed || 0) + (r.planParsed || 0), 0);
      
      toast({
        title: "Upload Complete",
        description: `${successCount} file(s) processed (${totalRecords} records)${errorCount > 0 ? `, ${errorCount} failed` : ""}`,
        variant: errorCount > 0 ? "destructive" : "default",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Upload Failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const budgetMutation = useMutation({
    mutationFn: budgetsApi.create,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      toast({
        title: "Budget Entry Saved",
        description: "Manual budget entry has been recorded.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Save Failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const refreshData = () => {
    refreshMutation.mutate();
  };

  const importFiles = async (files: File[]): Promise<UploadResult> => {
    return await uploadMutation.mutateAsync(files);
  };

  const addBudgetEntry = async (entry: CreateBudget) => {
    await budgetMutation.mutateAsync(entry);
  };

  const exportUrl = (type: "projects" | "expenses" | "revenues" | "tasks" | "projects-summary") => {
    switch (type) {
      case "projects": return exportApi.projects();
      case "expenses": return exportApi.expenses();
      case "revenues": return exportApi.revenues();
      case "tasks": return exportApi.tasks();
      case "projects-summary": return exportApi.projectsSummary();
    }
  };

  return (
    <ProgramContext.Provider value={{ 
      data: data || null, 
      overview: overview || null,
      projectsSummary: projectsSummary || null,
      lastUploadResult,
      isLoading: isLoading || uploadMutation.isPending || refreshMutation.isPending, 
      error: error as Error | null,
      refreshData, 
      importFiles,
      addBudgetEntry,
      exportUrl,
    }}>
      {children}
    </ProgramContext.Provider>
  );
}

export function useProgramData() {
  const context = useContext(ProgramContext);
  if (context === undefined) {
    throw new Error("useProgramData must be used within a ProgramProvider");
  }
  return context;
}
