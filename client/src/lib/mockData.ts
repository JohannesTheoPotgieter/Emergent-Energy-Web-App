import { ProjectInfo, ExpenditureItem, RevenueItem, ProjectTask, BudgetEntry } from "./types";
import { addDays, subDays, format } from "date-fns";

const PROJECTS: ProjectInfo[] = [
  {
    id: "P001",
    name: "Solar Farm Alpha",
    code: "SFA-26",
    manager: "Sarah Jenkins",
    site: "Nevada Site A",
    status: "Active",
    stage: "Construction",
    startDate: "2025-01-15",
    completionDate: "2026-06-30",
    budget: 45000000,
    sourceFile: "Alpha_Tracker_v4.xlsx",
    lastUpdated: new Date().toISOString(),
  },
  {
    id: "P002",
    name: "Wind Park Beta",
    code: "WPB-26",
    manager: "David Chen",
    site: "Texas North",
    status: "Planning",
    stage: "Development",
    startDate: "2025-06-01",
    completionDate: "2027-01-15",
    budget: 82000000,
    sourceFile: "Beta_Tracker_FY26.xlsm",
    lastUpdated: new Date().toISOString(),
  },
  {
    id: "P003",
    name: "Battery Storage Gamma",
    code: "BSG-26",
    manager: "Sarah Jenkins",
    site: "California East",
    status: "Active",
    stage: "Operations",
    startDate: "2024-03-10",
    completionDate: "2025-11-20",
    budget: 28000000,
    sourceFile: "Gamma_Storage_Track.xlsx",
    lastUpdated: new Date().toISOString(),
  },
  {
    id: "P004",
    name: "Grid Stabilizer Delta",
    code: "GSD-26",
    manager: "Michael Ross",
    site: "Utah West",
    status: "On Hold",
    stage: "Development",
    startDate: "2025-02-01",
    completionDate: "2026-08-30",
    budget: 12000000,
    sourceFile: "Delta_Grid_Project.xlsx",
    lastUpdated: subDays(new Date(), 5).toISOString(),
  }
];

// Generate some mock expenses
const generateExpenses = (): ExpenditureItem[] => {
  const expenses: ExpenditureItem[] = [];
  const categories = ["Procurement", "Construction", "Legal", "Grid Connection"] as const;
  
  PROJECTS.forEach(project => {
    for (let i = 0; i < 20; i++) {
      const date = i < 10 
        ? subDays(new Date(), i * 15) 
        : addDays(new Date(), (i - 10) * 15);
      
      expenses.push({
        id: `EXP-${project.id}-${i}`,
        projectId: project.id,
        category: categories[Math.floor(Math.random() * categories.length)],
        description: `Milestone Payment ${i+1} - Phase ${Math.floor(i/5)+1}`,
        amount: Math.floor(Math.random() * 500000) + 10000,
        date: format(date, "yyyy-MM-dd"),
        vendor: `Vendor ${String.fromCharCode(65 + Math.floor(Math.random() * 5))} Corp`,
        status: date < new Date() ? "Paid" : "Forecast",
        sourceSheet: "Expenditure Breakdown",
        rowLocator: i + 12
      });
    }
  });
  return expenses;
};

// Generate revenue
const generateRevenue = (): RevenueItem[] => {
  const revenue: RevenueItem[] = [];
  PROJECTS.forEach(project => {
    if (project.stage === "Operations") {
       for (let i = 0; i < 12; i++) {
        const date = subDays(new Date(), i * 30);
        revenue.push({
          id: `REV-${project.id}-${i}`,
          projectId: project.id,
          type: "PPA",
          amount: Math.floor(Math.random() * 200000) + 50000,
          date: format(date, "yyyy-MM-dd"),
          status: "Realised",
          sourceSheet: "Revenue Tracking",
          rowLocator: i + 4
        });
       }
    }
  });
  return revenue;
};

// Generate tasks
const generateTasks = (): ProjectTask[] => {
  const tasks: ProjectTask[] = [];
  PROJECTS.forEach(project => {
    tasks.push(
      {
        id: `TSK-${project.id}-1`,
        projectId: project.id,
        taskName: "Site Survey & Analysis",
        startDate: project.startDate,
        endDate: format(addDays(new Date(project.startDate), 45), "yyyy-MM-dd"),
        progress: 100,
        status: "Complete",
        assignee: "Engineering Team",
        sourceSheet: "Project Plan",
        rowLocator: 10
      },
      {
        id: `TSK-${project.id}-2`,
        projectId: project.id,
        taskName: "Permitting & Approvals",
        startDate: format(addDays(new Date(project.startDate), 50), "yyyy-MM-dd"),
        endDate: format(addDays(new Date(project.startDate), 120), "yyyy-MM-dd"),
        progress: project.status === "Planning" ? 30 : 100,
        status: project.status === "Planning" ? "In Progress" : "Complete",
        assignee: "Legal Dept",
        sourceSheet: "Project Plan",
        rowLocator: 11
      },
      {
        id: `TSK-${project.id}-3`,
        projectId: project.id,
        taskName: "Procurement of Modules",
        startDate: format(addDays(new Date(project.startDate), 130), "yyyy-MM-dd"),
        endDate: format(addDays(new Date(project.startDate), 180), "yyyy-MM-dd"),
        progress: project.status === "Active" ? 60 : 0,
        status: project.status === "Active" ? "In Progress" : "Not Started",
        assignee: "Procurement",
        sourceSheet: "Project Plan",
        rowLocator: 15
      }
    );
  });
  return tasks;
};

export const MOCK_DATA = {
  projects: PROJECTS,
  expenses: generateExpenses(),
  revenues: generateRevenue(),
  tasks: generateTasks(),
  budgets: [],
  lastRefresh: new Date().toISOString()
};
