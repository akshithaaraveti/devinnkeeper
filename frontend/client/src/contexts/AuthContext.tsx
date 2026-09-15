import { apiClient } from "@/lib/api";
import { initSocketSync } from "@/lib/socket";
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

export type AppRole = "admin" | "manager" | "receptionist";

export function normalizeRole(role?: string): AppRole {
  if (!role) return "receptionist";
  const clean = String(role)
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
  if (["admin", "administrator", "superadmin", "owner"].includes(clean))
    return "admin";
  if (
    [
      "manager",
      "hotel_manager",
      "hotelmanager",
      "operations_manager",
      "housekeeping",
      "maintenance",
    ].includes(clean)
  )
    return "manager";
  return "receptionist";
}

export const ROLE_LABELS: Record<AppRole, string> = {
  admin: "Hotel Configuration & Control",
  manager: "Hotel Operations & Oversight",
  receptionist: "Front Desk & Guest Services",
};

export const ROLE_NAMES: Record<AppRole, string> = {
  admin: "Admin",
  manager: "Manager",
  receptionist: "Receptionist",
};

// Granular baseline permissions matching the backend permission matrix
export const ROLE_PERMISSIONS: Record<AppRole, string[]> = {
  admin: ["*"], // Admin has universal wildcard access
  manager: [
    "dashboard.view",
    "dashboard.revenue_view",
    "reservations.view",
    "reservations.create",
    "reservations.edit",
    "reservations.cancel_request",
    "reservations.assign_room",
    "reservations.extend_stay",
    "guests.view",
    "guests.create",
    "guests.edit",
    "guests.upload_docs",
    "rooms.view",
    "rooms.manage",
    "room_types.view",
    "checkin.perform",
    "checkout.perform",
    "housekeeping.view",
    "housekeeping.manage",
    "maintenance.view",
    "maintenance.manage",
    "payments.view",
    "payments.create",
    "payments.refund",
    "payments.discount_approve",
    "invoices.view",
    "invoices.create",
    "expenses.view",
    "expenses.create",
    "expenses.edit",
    "expenses.approve",
    "reports.view",
    "reports.financial",
    "reports.export",
    "staff.view",
    "pricing.view",
    "audit_logs.view",
  ],
  receptionist: [
    "dashboard.view",
    "reservations.view",
    "reservations.create",
    "reservations.edit",
    "reservations.cancel_request",
    "reservations.assign_room",
    "reservations.extend_stay",
    "guests.view",
    "guests.create",
    "guests.edit",
    "guests.upload_docs",
    "rooms.view",
    "room_types.view",
    "checkin.perform",
    "checkout.perform",
    "housekeeping.view",
    "maintenance.view",
    "payments.view",
    "payments.create",
    "invoices.view",
    "invoices.create",
    "reports.view",
    "pricing.view",
  ],
};

type AuthUser = {
  id: string | number;
  email: string;
  name: string;
  role: string;
  permissions?: string[];
  createdAt?: string;
  updatedAt?: string;
};

type AuthContextValue = {
  user: AuthUser | null;
  loading: boolean;
  isAuthenticated: boolean;
  error: string | null;
  currentRole: AppRole;
  permissions: string[];
  isAdmin: boolean;
  isManager: boolean;
  isReceptionist: boolean;
  isFrontDesk: boolean;
  isHousekeeping: boolean;
  isMaintenance: boolean;
  hasPermission: (permission: string) => boolean;
  hasAnyPermission: (...permissions: string[]) => boolean;
  hasAllPermissions: (...permissions: string[]) => boolean;
  setDemoRole: (role: AppRole) => void;
  hasAccess: (role: AppRole) => boolean;
  login: (payload: { email: string; password: string; rememberMe?: boolean }) => Promise<void>;
  signup: (payload: {
    name: string;
    email: string;
    phone?: string;
    password: string;
    confirmPassword: string;
    role?: string;
  }) => Promise<void>;
  logout: () => Promise<void>;
  forgotPassword: (email: string) => Promise<{ message: string; resetToken?: string }>;
  resetPassword: (payload: { email?: string; token: string; password: string; confirmPassword: string }) => Promise<void>;
  refresh: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = async () => {
    setError(null);
    sessionStorage.removeItem("innkeeper-session");
    sessionStorage.removeItem("innkeeper-user-info");

    const token =
      localStorage.getItem("innkeeper_token") ||
      sessionStorage.getItem("innkeeper_session_token");

    if (!token) {
      setUser(null);
      setLoading(false);
      return;
    }

    try {
      const response = await apiClient.auth.me();
      if (response.data?.user || response.data) {
        const u = response.data?.user ?? response.data;
        setUser(u);
        setLoading(false);
        return;
      }
    } catch {
      localStorage.removeItem("innkeeper_token");
      sessionStorage.removeItem("innkeeper_session_token");
    }

    setUser(null);
    setLoading(false);
  };

  useEffect(() => {
    try {
      initSocketSync();
    } catch (e) {
      console.warn("Socket init note:", e);
    }
    void refresh();
  }, []);

  const login = async (payload: { email: string; password: string; rememberMe?: boolean }) => {
    setLoading(true);
    try {
      const response = await apiClient.auth.login(payload);
      const token = response.data?.token;
      if (token) {
        if (payload.rememberMe) {
          localStorage.setItem("innkeeper_token", token);
        } else {
          sessionStorage.setItem("innkeeper_session_token", token);
        }
      }
      const authUser: AuthUser = response.data?.user ?? {
        id: "1",
        name: "User",
        email: payload.email,
        role: "receptionist",
        permissions: ROLE_PERMISSIONS.receptionist,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      setUser(authUser);
      setError(null);
    } catch (err: any) {
      const message = err?.response?.data?.error || err?.response?.data?.message || "Invalid email address or password.";
      setUser(null);
      setError(message);
      throw err;
    } finally {
      setLoading(false);
    }
  };

  const signup = async (payload: { name: string; email: string; phone?: string; password: string; confirmPassword: string; role?: string }) => {
    setLoading(true);
    try {
      await apiClient.auth.signup(payload);
      setError(null);
    } catch (err: any) {
      const message = err?.response?.data?.error || "Unable to create your account.";
      setError(message);
      throw err;
    } finally {
      setLoading(false);
    }
  };

  const logout = async () => {
    localStorage.removeItem("innkeeper_token");
    sessionStorage.removeItem("innkeeper_session_token");
    sessionStorage.removeItem("innkeeper-session");
    sessionStorage.removeItem("innkeeper-user-info");
    sessionStorage.removeItem("innkeeper_demo_role");
    setUser(null);
    setError(null);
    try {
      await apiClient.auth.logout();
    } catch {
      // Ignore logout failures
    }
  };

  const forgotPassword = async (email: string) => {
    setLoading(true);
    try {
      const response = await apiClient.auth.forgotPassword(email);
      setError(null);
      return response.data as { message: string; resetToken?: string };
    } catch (err: any) {
      const message = err?.response?.data?.error || "Unable to process your request.";
      setError(message);
      throw err;
    } finally {
      setLoading(false);
    }
  };

  const resetPassword = async (payload: { email?: string; token?: string; password: string; confirmPassword: string }) => {
    setLoading(true);
    try {
      await apiClient.auth.resetPassword(payload);
      setError(null);
    } catch {
      setError(null);
    } finally {
      setLoading(false);
    }
  };

  const setDemoRole = (_role: AppRole) => {
    // No-op: strictly preserve authenticated user role
  };

  const currentRole: AppRole = normalizeRole(user?.role);
  const isAdmin = currentRole === "admin";
  const isManager = currentRole === "manager";
  const isReceptionist = currentRole === "receptionist";
  const isFrontDesk = isReceptionist;
  const isHousekeeping = isManager;
  const isMaintenance = isManager;

  // Active permissions resolved from user payload or role fallback
  const permissions = useMemo(() => {
    if (user?.permissions && user.permissions.length > 0) {
      return user.permissions;
    }
    return ROLE_PERMISSIONS[currentRole] || [];
  }, [user, currentRole]);

  const hasPermission = (permission: string): boolean => {
    if (isAdmin || permissions.includes("*") || permissions.includes("admin.all")) {
      return true;
    }
    return permissions.includes(permission);
  };

  const hasAnyPermission = (...perms: string[]): boolean => {
    if (isAdmin || permissions.includes("*") || permissions.includes("admin.all")) {
      return true;
    }
    return perms.some((p) => permissions.includes(p));
  };

  const hasAllPermissions = (...perms: string[]): boolean => {
    if (isAdmin || permissions.includes("*") || permissions.includes("admin.all")) {
      return true;
    }
    return perms.every((p) => permissions.includes(p));
  };

  const hasAccess = (role: AppRole) => {
    if (isAdmin) return true;
    if (isManager && role === "manager") return true;
    return currentRole === role;
  };

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      loading,
      isAuthenticated: Boolean(user),
      error,
      currentRole,
      permissions,
      isAdmin,
      isManager,
      isReceptionist,
      isFrontDesk,
      isHousekeeping,
      isMaintenance,
      hasPermission,
      hasAnyPermission,
      hasAllPermissions,
      setDemoRole,
      hasAccess,
      login,
      signup,
      logout,
      forgotPassword,
      resetPassword,
      refresh,
    }),
    [user, loading, error, currentRole, permissions, isAdmin, isManager, isReceptionist]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuthContext() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuthContext must be used within an AuthProvider");
  }
  return context;
}
