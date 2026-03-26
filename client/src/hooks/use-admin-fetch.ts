import { useQuery } from "@tanstack/react-query";

export function useAdminFetch<T>(endpoint: string, queryKey: string[]) {
  return useQuery<T>({
    queryKey,
    queryFn: async () => {
      const token = localStorage.getItem("auth_token");
      const headers: Record<string, string> = {};
      if (token) headers["Authorization"] = `Bearer ${token}`;
      const res = await fetch(endpoint, { headers, credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch");
      return res.json();
    },
    staleTime: 30_000,
  });
}
