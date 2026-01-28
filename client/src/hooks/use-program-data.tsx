import React, { createContext, useContext, useState, ReactNode } from "react";
import { ProgramData, ProjectInfo, ExpenditureItem, RevenueItem, ProjectTask, BudgetEntry } from "../lib/types";
import { MOCK_DATA } from "../lib/mockData";
import { format } from "date-fns";
import * as XLSX from "xlsx";
import { useToast } from "@/hooks/use-toast";

interface ProgramContextType {
  data: ProgramData;
  isLoading: boolean;
  refreshData: () => void;
  importFile: (file: File) => Promise<void>;
  addBudgetEntry: (entry: Omit<BudgetEntry, "id">) => void;
}

const ProgramContext = createContext<ProgramContextType | undefined>(undefined);

export function ProgramProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<ProgramData>(MOCK_DATA);
  const [isLoading, setIsLoading] = useState(false);
  const { toast } = useToast();

  const refreshData = () => {
    setIsLoading(true);
    // Simulate API fetch
    setTimeout(() => {
      setData({ ...data, lastRefresh: new Date().toISOString() });
      setIsLoading(false);
      toast({
        title: "Data Refreshed",
        description: "Program data has been updated from source trackers.",
      });
    }, 1500);
  };

  const importFile = async (file: File) => {
    setIsLoading(true);
    try {
      const arrayBuffer = await file.arrayBuffer();
      const workbook = XLSX.read(arrayBuffer);
      
      // Verification logic described in requirements
      const requiredSheets = ["Expenditure Breakdown", "Revenue Tracking", "Project Plan"];
      const missingSheets = requiredSheets.filter(sheet => !workbook.SheetNames.includes(sheet));

      if (missingSheets.length > 0) {
        throw new Error(`Invalid Tracker: Missing sheets - ${missingSheets.join(", ")}`);
      }

      // In a real app, we would parse rows here. 
      // For mockup, we'll simulate "parsing" by updating the timestamp and maybe adding a dummy project if it's a new file
      
      setTimeout(() => {
        setData(prev => ({
          ...prev,
          lastRefresh: new Date().toISOString()
        }));
        setIsLoading(false);
        toast({
          title: "File Processed",
          description: `Successfully consolidated data from ${file.name}`,
          variant: "default",
        });
      }, 1000);

    } catch (error: any) {
      setIsLoading(false);
      toast({
        title: "Import Failed",
        description: error.message,
        variant: "destructive",
      });
    }
  };

  const addBudgetEntry = (entry: Omit<BudgetEntry, "id">) => {
    const newEntry: BudgetEntry = {
      ...entry,
      id: `BUD-${Date.now()}`
    };
    setData(prev => ({
      ...prev,
      budgets: [...prev.budgets, newEntry]
    }));
    toast({
      title: "Budget Updated",
      description: "Manual budget entry saved to database.",
    });
  };

  return (
    <ProgramContext.Provider value={{ data, isLoading, refreshData, importFile, addBudgetEntry }}>
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
