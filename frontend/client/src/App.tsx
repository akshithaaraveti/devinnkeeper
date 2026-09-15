import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import Payments from "@/pages/Payments";
import Vehicles from "@/pages/Vehicles";
import CashLedger from "@/pages/CashLedger";
import ShiftAudits from "@/pages/ShiftAudits";
import Reservations from "@/pages/Reservations";
import Guests from "@/pages/Guests";
import Housekeeping from "@/pages/Housekeeping";
import Maintenance from "@/pages/Maintenance";
import CheckInVerification from "@/pages/CheckInVerification";
import DigitalKeyPage from "@/pages/DigitalKeyPage";
import LandingPage from "@/pages/LandingPage";
import { NotificationsPage } from "@/pages/Notifications";
import { Redirect, Route, Switch } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import { AuthProvider, useAuthContext, AppRole, ROLE_NAMES } from "./contexts/AuthContext";
import { NotificationProvider } from "./contexts/NotificationContext";
import DashboardLayout from "./components/DashboardLayout";
import Dashboard from "./pages/Dashboard";
import LoginPage from "./pages/auth/LoginPage";
import SignupPage from "./pages/auth/SignupPage";
import ForgotPasswordPage from "./pages/auth/ForgotPasswordPage";
import ResetPasswordPage from "./pages/auth/ResetPasswordPage";
import { ShieldAlert } from "lucide-react";

export function RoleGuard({
  allowedRoles,
  children,
}: {
  allowedRoles: AppRole[];
  children: React.ReactNode;
}) {
  const { currentRole } = useAuthContext();
  if (allowedRoles.includes(currentRole)) {
    return <>{children}</>;
  }

  return (
    <div className="flex min-h-[65vh] flex-col items-center justify-center p-6 text-center">
      <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-3xl bg-rose-500/10 text-rose-600 shadow-xs">
        <ShieldAlert className="h-8 w-8" />
      </div>
      <h2 className="text-2xl font-bold text-foreground">Access Restricted</h2>
      <p className="mt-2 max-w-md text-sm text-muted-foreground">
        This module is reserved for <strong>{allowedRoles.map(r => ROLE_NAMES[r]).join(" or ")}</strong>. Your active role is <strong className="text-foreground">{ROLE_NAMES[currentRole]}</strong>.
      </p>
      <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
        <a href="/" className="rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow-sm hover:opacity-90">
          Return to Dashboard
        </a>
      </div>
    </div>
  );
}

function ProtectedApp() {
  const { isAuthenticated, loading } = useAuthContext();

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 text-slate-600">
        <div className="rounded-2xl border border-slate-200 bg-white/80 px-6 py-5 shadow-sm backdrop-blur">
          Preparing your workspace...
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Redirect to="/login" />;
  }

  return (
    <DashboardLayout>
      <Switch>
        <Route path="/" component={Dashboard} />
        <Route path="/dashboard" component={Dashboard} />
        <Route path="/reservations" component={Reservations} />
        <Route path="/checkin" component={CheckInVerification} />
        <Route path="/digital-key" component={DigitalKeyPage} />
        <Route path="/guests" component={Guests} />
        <Route path="/payments" component={Payments} />
        <Route path="/housekeeping" component={Housekeeping} />
        <Route path="/maintenance" component={Maintenance} />
        <Route path="/vehicles" component={Vehicles} />
        <Route path="/cash-ledger" component={CashLedger} />
        <Route path="/shift-audits">
          <RoleGuard allowedRoles={["admin", "manager"]}>
            <ShiftAudits />
          </RoleGuard>
        </Route>
        <Route path="/notifications" component={NotificationsPage} />
        <Route path="/404" component={NotFound} />
        <Route component={NotFound} />
      </Switch>
    </DashboardLayout>
  );
}

function CheckInRoute() {
  const { isAuthenticated, loading } = useAuthContext();
  const searchParams = new URLSearchParams(window.location.search);
  const hasCheckInToken = Boolean(searchParams.get("token") || sessionStorage.getItem("innkeeper_checkin_token"));

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 text-slate-600">
        <div className="rounded-2xl border border-slate-200 bg-white/80 px-6 py-5 shadow-sm backdrop-blur">
          Preparing check-in...
        </div>
      </div>
    );
  }

  // If accessed via a guest check-in link/token or by an unauthenticated user, render standalone guest check-in page without DashboardLayout
  if (hasCheckInToken || !isAuthenticated) {
    return <CheckInVerification isGuestMode={true} />;
  }

  // Only logged-in hotel staff navigating within the dashboard view see DashboardLayout
  return (
    <DashboardLayout>
      <CheckInVerification isGuestMode={false} />
    </DashboardLayout>
  );
}

function DigitalKeyRoute() {
  const { isAuthenticated, loading } = useAuthContext();
  const searchParams = new URLSearchParams(window.location.search);
  const hasCheckInToken = Boolean(searchParams.get("token") || sessionStorage.getItem("innkeeper_checkin_token"));

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 text-slate-600">
        <div className="rounded-2xl border border-slate-200 bg-white/80 px-6 py-5 shadow-sm backdrop-blur">
          Loading digital room pass...
        </div>
      </div>
    );
  }

  // If accessed by a guest or without staff login, show standalone DigitalKeyPage
  if (hasCheckInToken || !isAuthenticated) {
    return <DigitalKeyPage />;
  }

  return (
    <DashboardLayout>
      <DigitalKeyPage />
    </DashboardLayout>
  );
}

function PublicRoutes() {
  return (
    <Switch>
      <Route path="/login" component={LoginPage} />
      <Route path="/signup" component={SignupPage} />
      <Route path="/forgot-password" component={ForgotPasswordPage} />
      <Route path="/reset-password" component={ResetPasswordPage} />
      <Route path="/checkin" component={CheckInRoute} />
      <Route path="/dashboard" component={ProtectedApp} />
      <Route path="/payments" component={ProtectedApp} />
      <Route path="/vehicles" component={ProtectedApp} />
      <Route path="/cash-ledger" component={ProtectedApp} />
      <Route path="/shift-audits" component={ProtectedApp} />
      <Route path="/reservations" component={ProtectedApp} />
      <Route path="/digital-key" component={DigitalKeyRoute} />
      <Route path="/guests" component={ProtectedApp} />
      <Route path="/housekeeping" component={ProtectedApp} />
      <Route path="/maintenance" component={ProtectedApp} />
      <Route path="/notifications" component={ProtectedApp} />
      <Route path="/404" component={NotFound} />
      <Route path="/" component={LandingPage} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider>
        <TooltipProvider>
          <Toaster richColors closeButton />
          <AuthProvider>
            <NotificationProvider>
              <PublicRoutes />
            </NotificationProvider>
          </AuthProvider>
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
