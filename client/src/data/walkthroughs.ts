export interface WalkthroughStep {
  stepNumber: number;
  title: string;
  content: string;
  description?: string;
  tip?: string;
  targetPage?: string;
}

export interface Walkthrough {
  id: string;
  title: string;
  description: string;
  category: string;
  roles: string[];
  steps: WalkthroughStep[];
  estimatedMinutes?: number;
}

export interface WalkthroughCategory {
  label: string;
  description?: string;
  color?: string;
}

export const WALKTHROUGHS: Walkthrough[] = [
  {
    id: "finance-revenue-tracker-overview",
    title: "Revenue Tracker Overview",
    description: "Navigate to the canonical revenue tracker workspace.",
    category: "finance",
    roles: ["CEO_ADMIN", "COO_ADMIN", "FINANCE_ADMIN"],
    steps: [
      {
        stepNumber: 1,
        title: "Open Revenue Tracker",
        content: "Use the canonical Revenue Tracker workspace.",
        targetPage: "/revenue-tracker",
      },
    ],
    estimatedMinutes: 2,
  },
];

export const WALKTHROUGH_CATEGORIES: Record<string, WalkthroughCategory> = {};
