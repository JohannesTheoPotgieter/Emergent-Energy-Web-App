import { Redirect } from "wouter";

// The "Milestone Tracker" (/milestone-tracker, "Revenue Milestones") surface
// was retired from the Execution module. Any stray link or bookmark lands on
// the Execution board.
export default function MilestoneTrackerRedirect() {
  return <Redirect to="/execution" />;
}
