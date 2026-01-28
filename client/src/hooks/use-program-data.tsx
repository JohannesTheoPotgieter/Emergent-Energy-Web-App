import { createContext, useContext, ReactNode } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { dashboardApi, uploadApi, budgetsApi, DashboardData, CreateBudget, exportApi } from "../lib/api";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";

interface ProgramContextType {
  data: DashboardData | null;
  isLoading: boolean;
  error: Error | null;
  refreshData: () => void;
  importFiles: (files: File[]) => Promise<void>;
  addBudgetEntry: (entry: CreateBudget) => Promise<void>;
  exportUrl: (type: "projects" | "expenses" | "revenues" | "tasks") => string;
}

const ProgramContext = createContext<ProgramContextType | undefined>(undefined);

export function ProgramProvider({ children }: { children: ReactNode }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { isAuthenticated, isLoading: authLoading } = useAuth();

  const { data, isLoading, error } = useQuery({
    queryKey: ["dashboard"],
    queryFn: dashboardApi.getData,
    enabled: isAuthenticated && !authLoading,
    staleTime: 30000,
    refetchOnWindowFocus: true,
  });

  const refreshMutation = useMutation({
    mutationFn: dashboardApi.refresh,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      toast({
        title: "Data Refreshed",
        description: "Dashboard data has been updated.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Refresh Failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const uploadMutation = useMutation({
    mutationFn: uploadApi.uploadFiles,
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      const successCount = result.results.filter(r => r.status === "success").length;
      const errorCount = result.results.filter(r => r.status === "error").length;
      
      toast({
        title: "Upload Complete",
        description: `${successCount} file(s) processed successfully${errorCount > 0 ? `, ${errorCount} failed` : ""}`,
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

  const importFiles = async (files: File[]) => {
    await uploadMutation.mutateAsync(files);
  };

  const addBudgetEntry = async (entry: CreateBudget) => {
    await budgetMutation.mutateAsync(entry);
  };

  const exportUrl = (type: "projects" | "expenses" | "revenues" | "tasks") => {
    switch (type) {
      case "projects": return exportApi.projects();
      case "expenses": return exportApi.expenses();
      case "revenues": return exportApi.revenues();
      case "tasks": return exportApi.tasks();
    }
  };

  return (
    <ProgramContext.Provider value={{ 
      data: data || null, 
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
