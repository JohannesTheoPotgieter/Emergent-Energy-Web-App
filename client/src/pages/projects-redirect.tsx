import { Redirect } from "wouter";

// The legacy "All Projects" (/projects) page was retired — its remaining
// functionality (PM assignment, escalation, Edit Project Info, CSV export)
// was migrated into the Execution board. Any stray link or bookmark to
// /projects lands on the board, which is now the all-projects directory.
export default function ProjectsRedirect() {
  return <Redirect to="/execution" />;
}
