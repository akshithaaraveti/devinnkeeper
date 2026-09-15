import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useTheme } from "@/contexts/ThemeContext";
import { AppRole, ROLE_NAMES, useAuthContext } from "@/contexts/AuthContext";
import {
  LayoutDashboard,
  LogOut,
  CreditCard,
  ChevronLeft,
  ChevronRight,
  Sun,
  Moon,
  Users,
  CalendarDays,
  Sparkles,
  ShieldCheck,
  Wrench,
  Car,
  BookOpen,
  ClipboardList,
  PanelLeft,
  Settings,
  Globe,
  X,
  ArrowUp,
} from "lucide-react";
import { useState, useEffect, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useLocation } from "wouter";
import { DashboardLayoutSkeleton } from "./DashboardLayoutSkeleton";
import { Switch } from "./ui/switch";
import SettingsModal from "./dashboard/SettingsModal";
import { useTranslation } from "react-i18next";

export interface NavItem {
  icon: any;
  key: string;
  label: string;
  path: string;
  isSettings?: boolean;
  roles: AppRole[];
}

export const PREVIOUS_NAV_ITEMS: NavItem[] = [
  { icon: LayoutDashboard, key: "dashboard", label: "Dashboard", path: "/dashboard", roles: ["admin", "manager", "receptionist"] },
  { icon: CalendarDays, key: "reservations", label: "Reservations", path: "/reservations", roles: ["admin", "manager", "receptionist"] },
  { icon: ShieldCheck, key: "checkin", label: "Check-In & Keys", path: "/checkin", roles: ["admin", "manager", "receptionist"] },
  { icon: Users, key: "guests", label: "Guests", path: "/guests", roles: ["admin", "manager", "receptionist"] },
  { icon: CreditCard, key: "payments", label: "Payments", path: "/payments", roles: ["admin", "manager", "receptionist"] },
  { icon: Sparkles, key: "housekeeping", label: "Housekeeping", path: "/housekeeping", roles: ["admin", "manager"] },
  { icon: Wrench, key: "maintenance", label: "Maintenance", path: "/maintenance", roles: ["admin", "manager"] },
  { icon: Car, key: "vehicles", label: "Vehicles", path: "/vehicles", roles: ["admin", "manager", "receptionist"] },
  { icon: BookOpen, key: "cashLedger", label: "Cash Ledger", path: "/cash-ledger", roles: ["admin", "manager", "receptionist"] },
  { icon: ClipboardList, key: "shiftAudits", label: "Shift Audits", path: "/shift-audits", roles: ["admin", "manager"] },
  { icon: Settings, key: "settings", label: "Settings", path: "/settings", isSettings: true, roles: ["admin"] },
];

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { user, loading, currentRole, setDemoRole, logout } = useAuthContext();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [location, setLocation] = useLocation();
  const { theme, toggleTheme, switchable } = useTheme();
  const { t, i18n } = useTranslation();

  const [scrollProgress, setScrollProgress] = useState(0);
  const [isScrolled, setIsScrolled] = useState(false);
  const [showScrollTop, setShowScrollTop] = useState(false);

  useEffect(() => {
    const saved = localStorage.getItem("sidebar-collapsed");
    if (saved === "true") setCollapsed(true);

    const handleScroll = () => {
      const currentScrollY = window.scrollY;
      const scrollHeight = document.documentElement.scrollHeight - window.innerHeight;
      if (scrollHeight > 0) {
        setScrollProgress(Math.min(100, Math.max(0, (currentScrollY / scrollHeight) * 100)));
      }
      setIsScrolled(currentScrollY > 15);
      setShowScrollTop(currentScrollY > 260);
    };

    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  const scrollToTop = () => {
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const toggleCollapsed = () => {
    const next = !collapsed;
    setCollapsed(next);
    localStorage.setItem("sidebar-collapsed", String(next));
  };

  const getLocaleDateStr = () => {
    const currentLang = i18n.language || "en";
    const localeMap: Record<string, string> = { hi: "hi-IN", te: "te-IN", en: "en-US" };
    try {
      return new Date().toLocaleDateString(localeMap[currentLang] || "en-US", {
        weekday: "long",
        month: "long",
        day: "numeric",
      });
    } catch (e) {
      return new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
    }
  };

  const navItems = useMemo(() => {
    return PREVIOUS_NAV_ITEMS.filter((item) => item.roles.includes(currentRole));
  }, [currentRole]);

  if (loading) return <DashboardLayoutSkeleton />;

  const activeNavItem = navItems.find((i) =>
    (i as any).isSettings
      ? isSettingsOpen
      : i.path === "/"
      ? location === "/"
      : location.startsWith(i.path)
  );

  return (
    <div className="flex min-h-screen bg-background relative overflow-x-hidden">
      {/* Scroll Progress Bar */}
      <div className="fixed top-0 left-0 right-0 h-[3px] z-[9999] pointer-events-none bg-border/20">
        <div
          className="h-full bg-gradient-to-r from-[#8B6748] via-[#C4A882] to-[#D6B98F] transition-all duration-150 ease-out"
          style={{ width: `${scrollProgress}%` }}
        />
      </div>

      {/* Mobile backdrop */}
      {mobileOpen && (
        <div
          onClick={() => setMobileOpen(false)}
          className="fixed inset-0 z-40 bg-black/60 backdrop-blur-xs md:hidden"
        />
      )}

      {/* Sidebar */}
      <aside
        className={`fixed top-0 bottom-0 left-0 z-50 flex flex-col border-r border-border bg-card transition-all duration-300 md:static w-72 max-w-[85vw] ${
          collapsed ? "md:w-18" : "md:w-64"
        } ${mobileOpen ? "translate-x-0 shadow-2xl" : "-translate-x-full md:translate-x-0"}`}
      >
        {/* Brand */}
        <div className="flex h-16 items-center justify-between px-4 border-b border-border">
          <div className={`flex items-center gap-2.5 ${collapsed ? "md:hidden" : ""}`}>
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary text-primary-foreground font-black text-base shadow-sm">
              IK
            </div>
            <div className="leading-tight">
              <span className="text-base font-bold tracking-tight text-foreground">
                InnKeeper
              </span>
              <span className="block text-[10px] text-muted-foreground uppercase font-semibold tracking-wider">
                Hotel Operations
              </span>
            </div>
          </div>
          {collapsed && (
            <div className="hidden md:flex mx-auto h-9 w-9 items-center justify-center rounded-xl bg-primary text-primary-foreground font-black text-base shadow-sm">
              IK
            </div>
          )}
          {/* Mobile close button */}
          <button
            onClick={() => setMobileOpen(false)}
            className="md:hidden flex h-8 w-8 items-center justify-center rounded-lg border border-border text-muted-foreground hover:text-foreground hover:bg-accent cursor-pointer"
            aria-label="Close sidebar menu"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Role Badge Indicator in Sidebar */}
        <div className={`px-4 pt-3 pb-1 ${collapsed ? "md:hidden" : ""}`}>
          <div className="flex items-center justify-between px-2.5 py-1.5 rounded-lg bg-primary/5 border border-primary/15">
            <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Active Role</span>
            <Badge variant="secondary" className="text-[10px] font-bold bg-primary/15 text-primary border border-primary/20 capitalize">
              {currentRole}
            </Badge>
          </div>
        </div>

        {/* Nav list of Previous Features */}
        <nav className="flex-1 overflow-y-auto px-3 py-2 space-y-1">
          {navItems.map((item) => {
            const isActive = (item as any).isSettings
              ? isSettingsOpen
              : item.path === "/"
              ? location === "/"
              : location.startsWith(item.path);
            const translatedLabel = t(`navigation.${item.key}`, item.label);

            return (
              <button
                key={item.key}
                onClick={() => {
                  if ((item as any).isSettings) {
                    setIsSettingsOpen(true);
                  } else {
                    setLocation(item.path);
                  }
                  setMobileOpen(false);
                }}
                title={translatedLabel}
                className={`flex w-full items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium transition-all duration-150 cursor-pointer ${
                  isActive
                    ? "bg-primary text-primary-foreground shadow-sm font-semibold"
                    : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                }`}
              >
                <item.icon className="h-4.5 w-4.5 shrink-0" />
                <span className={`truncate ${collapsed ? "md:hidden" : ""}`}>{translatedLabel}</span>
              </button>
            );
          })}
        </nav>

        {/* Theme switcher footer */}
        {switchable && (
          <div className={`border-t border-border p-3 ${collapsed ? "md:hidden" : ""}`}>
            <div className="flex items-center justify-between rounded-xl bg-accent/60 px-3 py-2">
              <div className="flex items-center gap-2">
                {theme === "dark" ? (
                  <Moon className="h-3.5 w-3.5 text-muted-foreground" />
                ) : (
                  <Sun className="h-3.5 w-3.5 text-muted-foreground" />
                )}
                <span className="text-xs font-medium">
                  {theme === "dark" ? "Dark" : "Light"} Mode
                </span>
              </div>
              <Switch
                checked={theme === "dark"}
                onCheckedChange={() => toggleTheme?.()}
                className="scale-75"
              />
            </div>
          </div>
        )}
      </aside>

      {/* Main content wrapper */}
      <div className="flex flex-1 flex-col min-w-0 overflow-x-hidden">
        {/* Top Header Bar - Dynamic Sticky on Scroll */}
        <header
          className={`sticky top-0 z-30 flex h-16 shrink-0 items-center justify-between transition-all duration-300 backdrop-blur-md px-3.5 sm:px-6 border-b ${
            isScrolled
              ? "bg-card/90 border-border/80 shadow-sm"
              : "bg-card/60 border-border"
          }`}
        >
          <div className="flex items-center gap-2 sm:gap-3 min-w-0">
            <button
              onClick={() => setMobileOpen(!mobileOpen)}
              className="flex md:hidden h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-border bg-card hover:bg-accent text-muted-foreground hover:text-foreground transition-colors shadow-2xs cursor-pointer"
              title="Toggle mobile menu"
              aria-label="Toggle mobile menu"
            >
              <PanelLeft className="h-4.5 w-4.5 text-foreground" />
            </button>
            <button
              onClick={toggleCollapsed}
              className="hidden md:flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-border bg-card hover:bg-accent text-muted-foreground hover:text-foreground transition-colors shadow-2xs cursor-pointer"
              title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
              aria-label="Toggle sidebar"
            >
              {collapsed ? (
                <ChevronRight className="h-4.5 w-4.5 text-foreground" />
              ) : (
                <ChevronLeft className="h-4.5 w-4.5 text-foreground" />
              )}
            </button>
            <div className="min-w-0">
              <h2 className="text-sm sm:text-base font-bold text-foreground capitalize leading-tight truncate max-w-[130px] xs:max-w-[200px] sm:max-w-none">
                {activeNavItem ? t(`navigation.${activeNavItem.key}`, activeNavItem.label) : "InnKeeper Operations"}
              </h2>
              <p className="text-xs text-muted-foreground hidden sm:block truncate">
                {getLocaleDateStr()}
              </p>
            </div>
          </div>

          {/* Header Right Actions */}
          <div className="flex items-center gap-2 sm:gap-3">
            {/* Language Switcher */}
            <div className="flex items-center gap-1 bg-card/80 border border-border px-2 py-1.5 rounded-xl text-xs font-semibold text-muted-foreground shadow-2xs">
              <Globe className="h-3.5 w-3.5 text-muted-foreground/80" />
              <select
                value={i18n.language || "en"}
                onChange={(e) => i18n.changeLanguage(e.target.value)}
                aria-label="Language selector"
                className="bg-transparent text-xs font-bold text-foreground focus:outline-none cursor-pointer pr-1"
              >
                <option value="en" className="bg-card text-foreground">EN</option>
                <option value="hi" className="bg-card text-foreground">हिन्दी</option>
                <option value="te" className="bg-card text-foreground">తెలుగు</option>
              </select>
            </div>

            {/* Profile Menu */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="flex items-center gap-2.5 rounded-2xl border border-border bg-card/80 px-3 py-1.5 hover:bg-accent transition-colors shadow-2xs cursor-pointer">
                  <Avatar className="h-7 w-7 border border-border">
                    <AvatarFallback className="text-xs font-semibold bg-primary text-primary-foreground">
                      {user?.name?.charAt(0).toUpperCase() || "U"}
                    </AvatarFallback>
                  </Avatar>
                  <div className="text-left hidden sm:block leading-tight">
                    <p className="text-xs font-semibold text-foreground">{user?.name || "User"}</p>
                    <p className="text-[10px] font-medium text-emerald-600 dark:text-emerald-400 capitalize leading-none mt-0.5">{ROLE_NAMES[currentRole]}</p>
                  </div>
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-64 mt-2 z-[9999] bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xl rounded-2xl p-2 opacity-100">
                <div className="px-3 py-2.5 border-b border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/60 rounded-xl mb-1.5">
                  <p className="text-sm font-bold text-slate-900 dark:text-white leading-tight">{user?.name || "User"}</p>
                  <p className="text-xs text-slate-500 dark:text-slate-400 truncate mt-0.5">{user?.email || "example@gmail.com"}</p>
                  <div className="flex items-center gap-1.5 mt-2">
                    <span className="text-[10px] uppercase font-bold text-slate-400">Role:</span>
                    <Badge variant="secondary" className="text-[10px] font-semibold bg-primary/10 text-primary border border-primary/20">
                      {ROLE_NAMES[currentRole]}
                    </Badge>
                  </div>
                </div>

                <DropdownMenuItem
                  onClick={() => setIsSettingsOpen(true)}
                  className="cursor-pointer mt-1 rounded-xl py-2 px-3 text-sm font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 focus:bg-slate-100 dark:focus:bg-slate-800"
                >
                  <Settings className="mr-2.5 h-4 w-4 text-sky-600 dark:text-sky-400" />
                  <span>{t("settings.title")}</span>
                </DropdownMenuItem>
                <DropdownMenuSeparator className="my-1 border-slate-100 dark:border-slate-800" />
                <DropdownMenuItem
                  onClick={logout}
                  className="cursor-pointer rounded-xl py-2 px-3 text-sm font-semibold text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/50 focus:bg-rose-50 dark:focus:bg-rose-950/50"
                >
                  <LogOut className="mr-2.5 h-4 w-4 text-rose-600 dark:text-rose-400" />
                  <span>{t("navigation.signOut")}</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>

        {/* Content body */}
        <main className="flex-1 p-3.5 sm:p-6 lg:p-8 w-full max-w-[1720px] mx-auto min-w-0 animate-fade-in">
          {children}
        </main>
      </div>

      {/* Settings Modal */}
      <SettingsModal isOpen={isSettingsOpen} onClose={() => setIsSettingsOpen(false)} />

      {/* Floating Scroll-to-Top Button */}
      <AnimatePresence>
        {showScrollTop && (
          <motion.button
            initial={{ opacity: 0, scale: 0.8, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.8, y: 12 }}
            transition={{ duration: 0.22, ease: "easeOut" }}
            onClick={scrollToTop}
            title="Scroll to top"
            aria-label="Scroll to top"
            className="fixed bottom-6 right-6 z-40 flex h-11 w-11 items-center justify-center rounded-2xl border border-border/80 bg-card/95 text-foreground shadow-xl backdrop-blur-md hover:bg-primary hover:text-primary-foreground hover:border-primary/50 transition-colors group cursor-pointer"
          >
            <ArrowUp className="h-5 w-5 transition-transform duration-200 group-hover:-translate-y-0.5" />
          </motion.button>
        )}
      </AnimatePresence>
    </div>
  );
}
