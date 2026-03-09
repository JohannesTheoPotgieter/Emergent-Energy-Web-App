type RoleAwareInteractionPayload = {
  action: "suggestion_accepted" | "suggestion_overridden";
  suggestion: string;
  finalValue: string;
  reason?: string;
  role?: string | null;
};

export async function logRoleAwareInteraction(payload: RoleAwareInteractionPayload): Promise<void> {
  try {
    await fetch("/api/ux/role-aware-interaction", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch {
    // best effort
  }
}
