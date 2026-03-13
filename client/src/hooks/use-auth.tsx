import { createContext, useContext, useState, useEffect, ReactNode } from "react";
import { authApi, User, setAuthToken } from "../lib/api";
import { useLocation } from "wouter";
import { useToast } from "@/hooks/use-toast";
import { getErrorMessage } from "@/lib/errors";
import { isSuperAdmin } from "@/lib/access-control";

interface AuthContextType {
  user: User | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  isAdmin: boolean;
  isQm: boolean;
  login: (username: string, password: string) => Promise<boolean>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  useEffect(() => {
    checkBuildVersion().then(() => checkAuth());
  }, []);

  const checkBuildVersion = async () => {
    try {
      const res = await fetch("/build-version.json", { cache: "no-store" });
      if (res.ok) {
        const { buildId } = await res.json();
        const storedBuild = localStorage.getItem("app_build_id");
        if (storedBuild && storedBuild !== buildId) {
          localStorage.removeItem("auth_token");
          localStorage.removeItem("company_role");
          localStorage.setItem("app_build_id", buildId);
          window.location.href = "/auth/login";
          return;
        }
        localStorage.setItem("app_build_id", buildId);
      }
    } catch {
    }
  };

  const checkAuth = async () => {
    try {
      const response = await authApi.me();
      setUser(response.user);
      if (response.user?.role) {
        localStorage.setItem("company_role", response.user.role);
      }
    } catch {
      setUser(null);
    } finally {
      setIsLoading(false);
    }
  };

  const login = async (username: string, password: string): Promise<boolean> => {
    try {
      const response = await authApi.login(username, password);
      setUser(response.user);
      setAuthToken(response.token);
      localStorage.setItem("company_role", response.user.role);
      toast({
        title: "Welcome back!",
        description: `Logged in as ${response.user.name}`,
      });
      return true;
    } catch (error) {
      console.error("[Login Error]", error);
      
      toast({
        title: "Login Failed",
        description: getErrorMessage(error, "An unexpected error occurred"),
        variant: "destructive",
      });
      return false;
    }
  };

  const logout = async () => {
    try {
      await authApi.logout();
      setUser(null);
      // Clear JWT token on logout
      setAuthToken(null);
      setLocation("/auth/login");
      toast({
        title: "Logged out",
        description: "You have been logged out successfully.",
      });
    } catch (error) {
      console.error("Logout error:", error);
    }
  };

  return (
    <AuthContext.Provider value={{ 
      user, 
      isLoading, 
      isAuthenticated: !!user,
      isAdmin: isSuperAdmin(user?.role, localStorage.getItem("company_role")),
      isQm: ['quality_manager', 'QUALITY_MANAGER'].includes(user?.role || ''),
      login, 
      logout 
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
