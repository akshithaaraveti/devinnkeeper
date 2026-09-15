import { useMemo } from "react";
import { motion } from "framer-motion";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Bed, IndianRupee, TrendingUp, BarChart3, Sparkles, ArrowUpRight, DoorOpen, CheckCircle2, AlertTriangle, CalendarDays } from "lucide-react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  AreaChart,
  Area,
} from "recharts";
import { useTranslation } from "react-i18next";

interface Room {
  id: number;
  number: string;
  name: string;
  type: string;
  floor: number;
  status: string;
  rate: number;
  capacity: number;
  isAvailable: number;
}

interface Reservation {
  id: number;
  roomId: number | null;
  checkIn: Date;
  checkOut: Date;
  status: string;
  totalCharges: number | null;
}

interface MetricsDashboardProps {
  rooms: Room[];
  reservations: Reservation[];
  role?: string;
}

export default function MetricsDashboard({ rooms, reservations, role = "admin" }: MetricsDashboardProps) {
  const { t } = useTranslation();

  const metrics = useMemo(() => {
    const totalRooms = rooms.length;
    const occupiedRooms = rooms.filter((r) => r.status === "occupied").length;
    const vacantRooms = rooms.filter((r) => r.status === "vacant").length;
    const dirtyRooms = rooms.filter((r) => r.status === "dirty").length;
    const maintenanceRooms = rooms.filter((r) => r.status === "maintenance").length;
    const occupancyRate = totalRooms > 0 ? Math.round((occupiedRooms / totalRooms) * 100) : 0;

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const todayArrivals = reservations.filter((r) => {
      const ci = new Date(r.checkIn);
      ci.setHours(0, 0, 0, 0);
      return ci.getTime() === today.getTime() && (r.status || "").toLowerCase() !== "cancelled";
    });

    const todayDepartures = reservations.filter((r) => {
      const co = new Date(r.checkOut);
      co.setHours(0, 0, 0, 0);
      return co.getTime() === today.getTime() && (r.status || "").toLowerCase() !== "cancelled";
    });

    const activeReservations = reservations.filter(
      (r) => r.status === "checked_in" || r.status === "confirmed"
    );
    const totalRevenue = activeReservations.reduce(
      (sum, r) => sum + (r.totalCharges || 0),
      0
    );
    const adr = activeReservations.length > 0 ? totalRevenue / activeReservations.length : 0;
    const revpar = adr * (occupancyRate / 100);

    return {
      occupancyRate,
      adr,
      revpar,
      totalRooms,
      occupiedRooms,
      vacantRooms,
      dirtyRooms,
      maintenanceRooms,
      todayArrivalsCount: todayArrivals.length,
      todayDeparturesCount: todayDepartures.length,
    };
  }, [rooms, reservations]);

  const weeklyData = useMemo(() => {
    const days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
    const today = new Date();
    const totalRooms = rooms.length;

    return days.map((day, i) => {
      const date = new Date(today);
      date.setDate(today.getDate() - (6 - i));
      const dayReservations = reservations.filter((r) => {
        const ci = new Date(r.checkIn);
        const co = new Date(r.checkOut);
        return ci <= date && co > date && (r.status === "checked_in" || r.status === "confirmed");
      });
      const dayOccupied = dayReservations.length;
      const dayOccupancy = totalRooms > 0 ? Math.round((dayOccupied / totalRooms) * 100) : 0;
      const dayRevenue = dayReservations.reduce((sum, r) => sum + (r.totalCharges || 0), 0);
      const dayAdr = dayReservations.length > 0
        ? Math.round(dayRevenue / dayReservations.length)
        : 0;

      return {
        day,
        occupancy: dayOccupancy,
        adr: dayAdr,
        revpar: Math.round((dayAdr * dayOccupancy) / 100),
      };
    });
  }, [rooms, reservations]);

  const adrTrend = useMemo(() => {
    const withData = weeklyData.filter((d) => d.adr > 0);
    if (withData.length < 2) return null;
    const first = withData[0].adr;
    const last = withData[withData.length - 1].adr;
    if (first === 0) return null;
    return Math.round(((last - first) / first) * 1000) / 10;
  }, [weeklyData]);

  const isReceptionist = role === "receptionist";
  const isManager = role === "manager";
  const isAdmin = role === "admin";

  // Build role-specific metric cards
  const cards = useMemo(() => {
    if (isReceptionist) {
      return [
        {
          title: t("dashboard.occupancy", "Occupancy"),
          value: `${metrics.occupancyRate}%`,
          detail: `${metrics.occupiedRooms} of ${metrics.totalRooms} rooms occupied`,
          icon: Bed,
          accent: "from-sky-500/15 to--500/5",
          tint: "text-sky-600",
          progress: metrics.occupancyRate,
        },
        {
          title: "Available Rooms",
          value: `${metrics.vacantRooms}`,
          detail: "Vacant & ready for guest check-in",
          icon: CheckCircle2,
          accent: "from-emerald-500/15 to-teal-500/5",
          tint: "text-emerald-600",
          progress: metrics.totalRooms > 0 ? (metrics.vacantRooms / metrics.totalRooms) * 100 : 0,
        },
        {
          title: "Today's Arrivals",
          value: `${metrics.todayArrivalsCount}`,
          detail: "Expected guest check-ins today",
          icon: DoorOpen,
          accent: "from--500/15 to-indigo-500/5",
          tint: "text-blue-600",
          progress: Math.min(metrics.todayArrivalsCount * 10, 100),
        },
        {
          title: "Today's Departures",
          value: `${metrics.todayDeparturesCount}`,
          detail: "Expected guest check-outs today",
          icon: CalendarDays,
          accent: "from-amber-500/15 to-orange-500/5",
          tint: "text-amber-600",
          progress: Math.min(metrics.todayDeparturesCount * 10, 100),
        },
      ];
    }

    if (isManager) {
      return [
        {
          title: t("dashboard.occupancy", "Occupancy"),
          value: `${metrics.occupancyRate}%`,
          detail: `${metrics.occupiedRooms} of ${metrics.totalRooms} rooms occupied`,
          icon: Bed,
          accent: "from-sky-500/15 to-blue-500/5",
          tint: "text-sky-600",
          progress: metrics.occupancyRate,
        },
        {
          title: "Housekeeping Queue",
          value: `${metrics.dirtyRooms} Dirty`,
          detail: "Rooms needing turnaround & cleaning",
          icon: Sparkles,
          accent: "from-amber-500/15 to-orange-500/5",
          tint: "text-amber-600",
          progress: metrics.totalRooms > 0 ? (metrics.dirtyRooms / metrics.totalRooms) * 100 : 0,
        },
        {
          title: "Maintenance Alerts",
          value: `${metrics.maintenanceRooms} Rooms`,
          detail: "Under active repair or out of order",
          icon: AlertTriangle,
          accent: "from-rose-500/15 to-red-500/5",
          tint: "text-rose-600",
          progress: metrics.totalRooms > 0 ? (metrics.maintenanceRooms / metrics.totalRooms) * 100 : 0,
        },
        {
          title: "Today's Turnaround",
          value: `${metrics.todayArrivalsCount} In / ${metrics.todayDeparturesCount} Out`,
          detail: "Total check-ins & check-outs today",
          icon: DoorOpen,
          accent: "from-violet-500/15 to-fuchsia-500/5",
          tint: "text-violet-600",
          progress: Math.min((metrics.todayArrivalsCount + metrics.todayDeparturesCount) * 8, 100),
        },
      ];
    }

    // Default: ADMIN (Full Financial & Executive view)
    return [
      {
        title: t("dashboard.occupancy", "Occupancy"),
        value: `${metrics.occupancyRate}%`,
        detail: t("dashboard.occupancyDetail", { occupied: metrics.occupiedRooms, total: metrics.totalRooms }),
        icon: Bed,
        accent: "from-sky-500/15 to-blue-500/5",
        tint: "text-sky-600",
        progress: metrics.occupancyRate,
      },
      {
        title: t("dashboard.todayRevenue", "Today's revenue"),
        value: `₹${metrics.adr.toFixed(0)}`,
        detail: t("dashboard.averageDailyRate", "Average Daily Rate"),
        icon: IndianRupee,
        accent: "from-emerald-500/15 to-teal-500/5",
        tint: "text-emerald-600",
        progress: Math.min(metrics.adr / 180, 100),
      },
      {
        title: t("dashboard.revPar", "RevPAR"),
        value: `₹${metrics.revpar.toFixed(0)}`,
        detail: t("dashboard.revenuePerAvailableRoom", "Revenue per available room"),
        icon: TrendingUp,
        accent: "from-violet-500/15 to-fuchsia-500/5",
        tint: "text-violet-600",
        progress: Math.min(metrics.revpar / 220, 100),
      },
      {
        title: t("dashboard.rooms", "Rooms"),
        value: `${metrics.totalRooms}`,
        detail: t("dashboard.roomSummaryDetail", {
          vacant: metrics.vacantRooms,
          occupied: metrics.occupiedRooms,
        }),
        icon: BarChart3,
        accent: "from-amber-500/15 to-orange-500/5",
        tint: "text-amber-600",
        progress: metrics.totalRooms > 0 ? (metrics.occupiedRooms / metrics.totalRooms) * 100 : 0,
      },
    ];
  }, [isReceptionist, isManager, metrics, t]);

  const container = {
    hidden: { opacity: 0 },
    show: {
      opacity: 1,
      transition: { staggerChildren: 0.05 },
    },
  };

  const item = {
    hidden: { opacity: 0, y: 20 },
    show: { opacity: 1, y: 0, transition: { duration: 0.3, ease: "easeOut" as const } },
  };

  return (
    <motion.div
      variants={container}
      initial="hidden"
      animate="show"
      className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-5"
    >
      {/* 4 Metric Cards */}
      {cards.map((metric, index) => {
        const Icon = metric.icon;
        return (
          <motion.div key={metric.title} variants={item}>
            <Card className="relative overflow-hidden border-border bg-card shadow-xs hover:shadow-md transition-shadow">
              <div className={`absolute -right-4 -top-4 h-24 w-24 rounded-full bg-gradient-to-br ${metric.accent} blur-xl`} />
              <CardContent className="p-4 sm:p-5 relative">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">{metric.title}</span>
                  <div className={`rounded-xl bg-accent p-2 ${metric.tint}`}>
                    <Icon className="h-4 w-4" />
                  </div>
                </div>
                <div className="mt-3 flex items-baseline gap-2">
                  <span className="text-2xl font-bold tracking-tight text-foreground">{metric.value}</span>
                </div>
                <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-muted">
                  <motion.div
                    initial={{ width: 0 }}
                    animate={{ width: `${metric.progress}%` }}
                    transition={{ duration: 0.7, delay: index * 0.05, ease: [0.23, 1, 0.32, 1] }}
                    className={`h-full rounded-full bg-gradient-to-r ${metric.accent.includes("sky") || metric.accent.includes("blue")
                      ? "from-sky-500 to-blue-600"
                      : metric.accent.includes("emerald") || metric.accent.includes("teal")
                        ? "from-emerald-500 to-teal-600"
                        : metric.accent.includes("violet")
                          ? "from-violet-500 to-fuchsia-600"
                          : "from-amber-500 to-orange-600"
                      }`}
                  />
                </div>
                <p className="mt-2 text-xs text-muted-foreground">{metric.detail}</p>
              </CardContent>
            </Card>
          </motion.div>
        );
      })}

      {/* Weekly Occupancy Trend Chart (Shown to all roles) */}
      <motion.div variants={item} className={isAdmin ? "md:col-span-2" : "col-span-full"}>
        <Card className="overflow-hidden border-border bg-card">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-semibold text-foreground">{t("dashboard.weeklyOccupancyTrend", "Weekly Occupancy Trend")}</CardTitle>
              <div className="flex items-center gap-2 rounded-full bg-sky-500/10 px-2.5 py-1 text-xs font-semibold text-sky-600 dark:text-sky-400">
                <Sparkles className="h-3.5 w-3.5" />
                {t("dashboard.liveOutlook", "Live Outlook")}
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div style={{ width: "100%", height: 180, minHeight: 180 }}>
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={weeklyData} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
                  <defs>
                    <linearGradient id="occupancyGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="oklch(0.62 0.18 245)" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="oklch(0.62 0.18 245)" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="day" tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
                  <YAxis tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" domain={[0, 100]} unit="%" />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "hsl(var(--card))",
                      border: "1px solid hsl(var(--border))",
                      borderRadius: "12px",
                      fontSize: "12px",
                    }}
                  />
                  <Area
                    type="monotone"
                    dataKey="occupancy"
                    stroke="oklch(0.62 0.18 245)"
                    fill="url(#occupancyGrad)"
                    strokeWidth={2}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      </motion.div>

      {/* ADR Financial Performance Chart (ADMIN ONLY - Hidden from Receptionist & Manager) */}
      {isAdmin && (
        <motion.div variants={item} className="md:col-span-2">
          <Card className="overflow-hidden border-border bg-card">
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-semibold text-foreground">{t("dashboard.adrPerformance", "ADR Performance")}</CardTitle>
                {adrTrend !== null && (
                  <div
                    className={`flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold ${adrTrend >= 0 ? "bg-emerald-500/10 text-emerald-600" : "bg-red-500/10 text-red-600"
                      }`}
                  >
                    <ArrowUpRight className={`h-3.5 w-3.5 ${adrTrend < 0 ? "rotate-180" : ""}`} />
                    {adrTrend >= 0 ? "Up" : "Down"} {Math.abs(adrTrend)}%
                  </div>
                )}
              </div>
            </CardHeader>
            <CardContent>
              <div style={{ width: "100%", height: 180, minHeight: 180 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={weeklyData} margin={{ top: 5, right: 5, left: -10, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="day" tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
                    <YAxis tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" domain={[0, "auto"]} tickFormatter={(value) => `₹${value}`} />
                    <Tooltip
                      formatter={(value: any) => [`₹${value}`, "ADR"]}
                      contentStyle={{
                        backgroundColor: "hsl(var(--card))",
                        border: "1px solid hsl(var(--border))",
                        borderRadius: "12px",
                        fontSize: "12px",
                      }}
                    />
                    <Bar dataKey="adr" fill="oklch(0.58 0.15 150)" radius={[6, 6, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
        </motion.div>
      )}
    </motion.div>
  );
}
