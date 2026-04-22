import { useQuery } from "@tanstack/react-query";

interface UserRecord {
  id: number;
  fullName?: string | null;
  full_name?: string | null;
  name?: string | null;
  username?: string | null;
}

function getAuthHeaders(): Record<string, string> {
  const token = localStorage.getItem("auth_token");
  const h: Record<string, string> = { "Content-Type": "application/json" };
  if (token) h["Authorization"] = `Bearer ${token}`;
  const csrf = document.cookie
    .split(";")
    .map((c) => c.trim())
    .find((c) => c.startsWith("csrf-token="))
    ?.split("=")[1];
  if (csrf) h["X-CSRF-Token"] = csrf;
  return h;
}

function pickDisplayName(u: UserRecord): string {
  return (
    u.fullName ||
    u.full_name ||
    u.name ||
    u.username ||
    `User ${u.id}`
  );
}

export function useUserNames() {
  const { data: users = [] } = useQuery<UserRecord[]>({
    queryKey: ["users-list"],
    queryFn: async () => {
      const res = await fetch("/api/users", {
        headers: getAuthHeaders(),
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to load users");
      return res.json();
    },
    staleTime: 60_000,
  });

  const map = new Map<number, string>();
  for (const u of users) {
    if (u && typeof u.id === "number") {
      map.set(u.id, pickDisplayName(u));
    }
  }

  function resolveName(
    ownerUserId: number | null | undefined,
    fallbackName: string | null | undefined,
  ): string | null {
    if (ownerUserId != null) {
      const live = map.get(ownerUserId);
      if (live) return live;
    }
    return fallbackName || null;
  }

  return { resolveName, userMap: map };
}
