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

export const WALKTHROUGHS: Walkthrough[] = [];

export const WALKTHROUGH_CATEGORIES: Record<string, WalkthroughCategory> = {};
