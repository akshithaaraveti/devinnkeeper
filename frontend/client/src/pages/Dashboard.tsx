import { useState, useMemo, useCallback, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useStore } from "@/lib/store";
import { apiClient } from "@/lib/api";
import { useAuthContext, ROLE_NAMES } from "@/contexts/AuthContext";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Bed,
  Search,
  Calendar,
  ChevronLeft,
  ChevronRight,
  Bell,
  BellOff,
  Sparkles,
  X,
  DoorOpen,
  Users,
  ShieldAlert,
  ShieldCheck,
  CheckCircle2,
  XCircle,
  Clock,
  ArrowRight,
  ClipboardList,
  Sparkle,
} from "lucide-react";
import MetricsDashboard from "@/components/dashboard/MetricsDashboard";
import RoomStatusBoard from "@/components/dashboard/RoomStatusBoard";
import TapeChart from "@/components/dashboard/TapeChart";
import ArrivalsDepartures from "@/components/dashboard/ArrivalsDepartures";
import NotificationCenter from "@/components/dashboard/NotificationCenter";
import RoomDetailsDrawer from "@/components/dashboard/RoomDetailsDrawer";
import Module5Widgets from "@/components/dashboard/Module5Widgets";
import { useTheme } from "@/contexts/ThemeContext";
import { Skeleton } from "@/components/ui/skeleton";
import { useTranslation } from "react-i18next";
import { useLocation } from "wouter";
import { toast } from "sonner";

export default function Dashboard() {
  const { t, i18n } = useTranslation();
  const [, setLocation] = useLocation();
  const { currentRole, hasPermission } = useAuthContext();

  const {
    rooms, setRooms,
    filterType, setFilterType,
    filterFloor, setFilterFloor,
    filterStatus, setFilterStatus,
    searchQuery, setSearchQuery,
    selectedRoom, setSelectedRoom,
    tapeChartStartDate, setTapeChartStartDate,
    reservations, setReservations,
    guests, setGuests,
    notifications, setNotifications,
    unreadCount, setUnreadCount,
  } = useStore();

  const { theme } = useTheme();
  const [showNotifications, setShowNotifications] = useState(false);
  const [activeTab, setActiveTab] = useState("overview");
  const [isLoading, setIsLoading] = useState(false);

  const fetchAll = useCallback(async (isInitial = false) => {
    if (isInitial) setIsLoading(true);
    try {
      const [roomsResult, reservationsResult, guestsResult, notificationsResult] = await Promise.allSettled([
        apiClient.rooms.list({ limit: 250 }),
        apiClient.reservations.list(),
        apiClient.guests.list(),
        apiClient.notifications.list(),
      ]);

      if (roomsResult.status === "fulfilled") {
        const roomsResp = roomsResult.value;
        const roomsData = roomsResp?.data?.items ?? roomsResp?.data ?? [];
        setRooms(roomsData as any);
      }

      if (reservationsResult.status === "fulfilled") {
        const reservationsResp = reservationsResult.value;
        const reservationsData = reservationsResp?.data?.items ?? reservationsResp?.data ?? [];
        setReservations(reservationsData as any);
      }

      if (guestsResult.status === "fulfilled") {
        const guestsResp = guestsResult.value;
        const guestsData = guestsResp?.data?.items ?? guestsResp?.data ?? [];
        setGuests(guestsData as any);
      }

      if (notificationsResult.status === "fulfilled") {
        const notificationsResp = notificationsResult.value;
        const notificationsData = notificationsResp?.data?.items ?? notificationsResp?.data ?? [];
        setNotifications(notificationsData as any);
        setUnreadCount((notificationsData as any[]).filter((n: any) => !n.isRead && !n.readAt).length || 0);
      }
    } catch (e) {
      console.warn("Failed to fetch dashboard data", e);
    } finally {
      if (isInitial) setIsLoading(false);
    }
  }, [setRooms, setReservations, setGuests, setNotifications, setUnreadCount]);

  useEffect(() => {
    fetchAll(true);
    const interval = setInterval(() => fetchAll(false), 15000);
    return () => clearInterval(interval);
  }, [fetchAll]);

  // Extract available floors and types dynamically from rooms
  const availableFloors = useMemo(() => {
    const floors = Array.from(new Set(rooms.map((r: any) => Number(r.floor))))
      .filter((f) => !isNaN(f))
      .sort((a, b) => a - b);
    return floors.length > 0 ? floors : [1, 2, 3, 4];
  }, [rooms]);

  const availableTypes = useMemo(() => {
    const types = Array.from(new Set(rooms.map((r: any) => r.type)))
      .filter((t): t is string => Boolean(t))
      .sort();
    return types.length > 0 ? types : ["Standard", "Deluxe", "Suite", "Premium", "Family"];
  }, [rooms]);

  // Filtered rooms
  const filteredRooms = useMemo(() => {
    const list = rooms.filter((room: any) => {
      if (filterType !== "all" && String(room.type || "").toLowerCase() !== String(filterType).toLowerCase()) return false;
      if (filterFloor !== null && Number(room.floor) !== Number(filterFloor)) return false;
      if (filterStatus !== "all" && String(room.status || "").toLowerCase() !== String(filterStatus).toLowerCase()) return false;
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        const guest = guests.find((g: any) => {
          const res = reservations.find((r: any) => r.roomId === room.id && r.guestId === g.id);
          return res;
        });
        const matchesName = `${room.number || room.room_number || ""} ${room.name || ""}`.toLowerCase().includes(q);
        const matchesGuest = guest ?
          `${(guest as any).firstName} ${(guest as any).lastName}`.toLowerCase().includes(q) :
          false;
        return matchesName || matchesGuest;
      }
      return true;
    });

    return list.sort((a: any, b: any) => {
      const floorA = Number(a.floor) || 0;
      const floorB = Number(b.floor) || 0;
      if (floorA !== floorB) return floorA - floorB;
      return String(a.number || a.room_number || "").localeCompare(String(b.number || b.room_number || ""), undefined, { numeric: true });
    });
  }, [rooms, filterType, filterFloor, filterStatus, searchQuery, guests, reservations]);

  const navigateTapeChart = useCallback((direction: number) => {
    const newDate = new Date(tapeChartStartDate);
    newDate.setDate(newDate.getDate() + direction);
    setTapeChartStartDate(newDate);
  }, [tapeChartStartDate, setTapeChartStartDate]);

  const statusColors: Record<string, string> = {
    vacant: "bg-emerald-500",
    occupied: "bg-[#8B6748]",
    dirty: "bg-amber-500",
    maintenance: "bg-red-500",
    reserved: "bg-purple-500",
  };

  const statusLabels: Record<string, string> = {
    vacant: t("dashboard.vacant"),
    occupied: t("dashboard.occupied"),
    dirty: t("dashboard.dirty"),
    maintenance: t("dashboard.maintenance"),
    reserved: t("dashboard.reserved"),
  };

  const getDashboardLocaleDate = () => {
    const currentLang = i18n.language || "en";
    const localeMap: Record<string, string> = { hi: "hi-IN", te: "te-IN", en: "en-US" };
    try {
      return new Date().toLocaleDateString(localeMap[currentLang] || "en-US", {
        weekday: "long",
        year: "numeric",
        month: "long",
        day: "numeric",
      });
    } catch (e) {
      return new Date().toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" });
    }
  };

  // Pending approval requests for Manager/Admin
  const pendingApprovals = useMemo(() => {
    return reservations.filter((r: any) => (r.status || "").toLowerCase() === "cancellation_requested");
  }, [reservations]);

  const handleReviewCancellation = async (reservationId: number, status: 'approved' | 'rejected') => {
    try {
      await apiClient.reservations.update(String(reservationId), {
        status: status === 'approved' ? 'cancelled' : 'confirmed'
      });
      toast.success(`Cancellation ${status === 'approved' ? 'approved' : 'rejected'}`);
      fetchAll(false);
    } catch (err: any) {
      toast.error(err?.response?.data?.message || "Failed to process cancellation request");
    }
  };

  return (
    <div className="space-y-6">
      {/* Header Banner */}
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, ease: "easeOut" }}
        className="rounded-[2rem] border border-[#C4A882] bg-gradient-to-r from-[#F9F2EA] via-[#F3EDE4] to-[#FFFDF8] p-5 shadow-sm backdrop-blur-xl card-hover-lift"
      >
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="mb-2 flex items-center gap-2 text-sm font-medium text-[#8B6748] dark:text-[#D6B98F]">
              <Sparkles className="h-4 w-4" />
              <span>{t("dashboard.subtitle")}</span>
            </div>
            <h1 className="text-2xl font-black tracking-tight text-[#4B3628] dark:text-[#F5EBDD]">{t("dashboard.title")}</h1>
            <p className="mt-1 text-xs sm:text-sm text-muted-foreground">
              {getDashboardLocaleDate()}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5 sm:gap-3">
            {/* Role Quick Action Shortcuts */}
            {currentRole === "receptionist" && (
              <>
                <Button size="sm" onClick={() => setLocation("/checkin")} className="rounded-xl font-bold text-xs gap-1.5 cursor-pointer">
                  <ShieldCheck className="h-3.5 w-3.5" /> Check-In Guest
                </Button>
                <Button size="sm" variant="outline" onClick={() => setLocation("/reservations")} className="rounded-xl font-bold text-xs gap-1.5 cursor-pointer">
                  <Calendar className="h-3.5 w-3.5" /> Bookings
                </Button>
              </>
            )}

            {currentRole === "manager" && (
              <>
                <Button size="sm" onClick={() => setLocation("/housekeeping")} className="rounded-xl font-bold text-xs gap-1.5 cursor-pointer">
                  <Sparkles className="h-3.5 w-3.5" /> Housekeeping Tasks
                </Button>
                <Button size="sm" variant="outline" onClick={() => setLocation("/shift-audits")} className="rounded-xl font-bold text-xs gap-1.5 cursor-pointer">
                  <ClipboardList className="h-3.5 w-3.5" /> Shift Audits
                </Button>
              </>
            )}

            {currentRole === "admin" && (
              <>
                <Button size="sm" onClick={() => setLocation("/reservations")} className="rounded-xl font-bold text-xs gap-1.5 cursor-pointer">
                  <Calendar className="h-3.5 w-3.5" /> All Reservations
                </Button>
                <Button size="sm" variant="outline" onClick={() => setLocation("/shift-audits")} className="rounded-xl font-bold text-xs gap-1.5 cursor-pointer">
                  <ClipboardList className="h-3.5 w-3.5" /> Full Audit Reports
                </Button>
              </>
            )}

            <Button
              variant="ghost"
              size="icon"
              className="relative rounded-2xl cursor-pointer"
              onClick={() => setShowNotifications(!showNotifications)}
            >
              {unreadCount > 0 ? <Bell className="h-5 w-5" /> : <BellOff className="h-5 w-5" />}
              {unreadCount > 0 && (
                <span className="absolute -top-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full bg-destructive text-[10px] font-bold text-destructive-foreground">
                  {unreadCount > 9 ? "9+" : unreadCount}
                </span>
              )}
            </Button>
          </div>
        </div>
      </motion.div>

      {/* Admin Pending Approvals Alert */}
      {currentRole === "admin" && pendingApprovals.length > 0 && (
        <Card className="border-amber-500/30 bg-amber-500/5 shadow-xs">
          <CardContent className="p-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-amber-500/20 text-amber-600 shrink-0">
                  <Clock className="h-5 w-5" />
                </div>
                <div>
                  <h4 className="text-sm font-bold text-foreground">
                    {pendingApprovals.length} Pending Cancellation Approval{pendingApprovals.length !== 1 ? "s" : ""}
                  </h4>
                  <p className="text-xs text-muted-foreground">
                    Front Desk / Manager submitted cancellation request{pendingApprovals.length !== 1 ? "s" : ""} awaiting your approval.
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Button size="sm" variant="outline" onClick={() => setLocation("/reservations")} className="text-xs font-bold rounded-xl cursor-pointer">
                  Review in Reservations
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Notification Center */}
      <AnimatePresence>
        {showNotifications && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.2 }}
          >
            <NotificationCenter onClose={() => setShowNotifications(false)} />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid w-full grid-cols-2 sm:grid-cols-4 lg:w-auto h-auto p-1 gap-1">
          <TabsTrigger value="overview" className="py-2 text-xs sm:text-sm font-semibold rounded-xl cursor-pointer">{t("dashboard.overview")}</TabsTrigger>
          <TabsTrigger value="tape-chart" className="py-2 text-xs sm:text-sm font-semibold rounded-xl cursor-pointer">{t("dashboard.tapeChart")}</TabsTrigger>
          <TabsTrigger value="rooms" className="py-2 text-xs sm:text-sm font-semibold rounded-xl cursor-pointer">{t("dashboard.rooms")}</TabsTrigger>
          <TabsTrigger value="arrivals" className="py-2 text-xs sm:text-sm font-semibold rounded-xl cursor-pointer">{t("dashboard.arrivals")}</TabsTrigger>
        </TabsList>

        {/* Overview Tab */}
        <TabsContent value="overview" className="space-y-6 mt-6">
          {isLoading ? (
            <div className="space-y-4">
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
                {[1, 2, 3, 4].map((i) => (
                  <Skeleton key={i} className="h-32 rounded-[1.5rem]" />
                ))}
              </div>
              <Skeleton className="h-50 rounded-[1.5rem]" />
              <Skeleton className="h-50 rounded-[1.5rem]" />
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
                {[1, 2, 3].map((i) => (
                  <Skeleton key={i} className="h-40 rounded-[1.5rem]" />
                ))}
              </div>
              <Skeleton className="h-75 rounded-[1.5rem]" />
            </div>
          ) : (
            <>
              {/* Metrics Dashboard tailored by authenticated role */}
              <motion.div
                initial={{ opacity: 0, y: 14 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: "-20px" }}
                transition={{ duration: 0.35, ease: "easeOut" }}
              >
                <MetricsDashboard rooms={filteredRooms} reservations={reservations} role={currentRole} />
              </motion.div>

              {/* Module 5 Executive Financial Widgets (ADMIN ONLY) */}
              {currentRole === "admin" && (
                <motion.div
                  initial={{ opacity: 0, y: 14 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true, margin: "-20px" }}
                  transition={{ duration: 0.35, ease: "easeOut" }}
                >
                  <Module5Widgets />
                </motion.div>
              )}

              {/* Live Room Status & Daily Schedule */}
              <motion.div
                initial={{ opacity: 0, y: 18 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: "-30px" }}
                transition={{ duration: 0.4, ease: "easeOut" }}
                className="grid grid-cols-1 2xl:grid-cols-4 gap-6 items-start"
              >
                <div className="2xl:col-span-3 min-w-0">
                  <RoomStatusBoard
                    rooms={filteredRooms as any}
                    onRoomClick={(data: any) => setSelectedRoom(data as any)}
                  />
                </div>
                <div className="2xl:col-span-1 space-y-4 min-w-0">
                  <ArrivalsDepartures rooms={rooms as any} reservations={reservations as any} guests={guests as any} />
                </div>
              </motion.div>
            </>
          )}
        </TabsContent>

        {/* Tape Chart Tab */}
        <TabsContent value="tape-chart" className="mt-6">
          <Card className="overflow-hidden border-border bg-card shadow-xs">
            <CardHeader className="pb-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-4">
                  <CardTitle className="flex items-center gap-2 text-lg font-semibold">
                    <Calendar className="h-5 w-5 text-sky-600" />
                    {t("dashboard.tapeChart")}
                  </CardTitle>
                  <div className="flex items-center gap-2">
                    <Button variant="outline" size="icon" onClick={() => navigateTapeChart(-7)}>
                      <ChevronLeft className="h-4 w-4" />
                    </Button>
                    <span className="min-w-50 text-center text-sm font-medium">
                      {tapeChartStartDate.toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                      {" — "}
                      {new Date(tapeChartStartDate.getTime() + 13 * 86400000).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                    </span>
                    <Button variant="outline" size="icon" onClick={() => navigateTapeChart(7)}>
                      <ChevronRight className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => setTapeChartStartDate(new Date())}>
                      {t("dashboard.today")}
                    </Button>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  {Object.entries(statusLabels).map(([status, label]) => (
                    <div key={status} className="flex items-center gap-1.5">
                      <div className={`h-2.5 w-2.5 rounded-full ${statusColors[status]}`} />
                      <span className="text-xs text-muted-foreground">{label}</span>
                    </div>
                  ))}
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <TapeChart
                rooms={filteredRooms as any}
                reservations={reservations as any}
                startDate={tapeChartStartDate}
                days={14}
                guests={guests as any}
                onRoomClick={(data: any) => setSelectedRoom(data as any)}
              />
            </CardContent>
          </Card>
        </TabsContent>

        {/* Rooms Tab */}
        <TabsContent value="rooms" className="space-y-6 mt-6">
          {/* Filters */}
          <Card>
            <CardContent className="pt-6">
              <div className="flex flex-col lg:flex-row lg:items-center gap-3 sm:gap-4">
                <div className="relative flex-1 min-w-0">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder={t("dashboard.searchPlaceholder")}
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="pl-10 h-10 w-full"
                  />
                  {searchQuery && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="absolute right-1 top-1/2 -translate-y-1/2 h-7 w-7"
                      onClick={() => setSearchQuery("")}
                    >
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 sm:gap-3 shrink-0">
                  <Select value={filterType} onValueChange={(v) => setFilterType(v as any)}>
                    <SelectTrigger className="w-full sm:w-36 md:w-40 h-10">
                      <SelectValue placeholder={t("dashboard.allTypes")} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">{t("dashboard.allTypes")}</SelectItem>
                      {availableTypes.map((type) => (
                        <SelectItem key={type} value={type} className="capitalize">
                          {t(`dashboard.${type.toLowerCase()}`, type)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>

                  <Select
                    value={String(filterFloor ?? "all")}
                    onValueChange={(v) => setFilterFloor(v === "all" ? null : Number(v))}
                  >
                    <SelectTrigger className="w-full sm:w-32 md:w-36 h-10">
                      <SelectValue placeholder={t("dashboard.allFloors")} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">{t("dashboard.allFloors")}</SelectItem>
                      {availableFloors.map((floorNum) => (
                        <SelectItem key={floorNum} value={String(floorNum)}>
                          {t("dashboard.floor", { floor: floorNum })}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>

                  <Select value={filterStatus} onValueChange={(v) => setFilterStatus(v as any)}>
                    <SelectTrigger className="w-full sm:w-36 md:w-40 h-10">
                      <SelectValue placeholder={t("dashboard.allStatus")} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">{t("dashboard.allStatus")}</SelectItem>
                      <SelectItem value="vacant">{t("dashboard.vacant")}</SelectItem>
                      <SelectItem value="occupied">{t("dashboard.occupied")}</SelectItem>
                      <SelectItem value="dirty">{t("dashboard.dirty")}</SelectItem>
                      <SelectItem value="maintenance">{t("dashboard.maintenance")}</SelectItem>
                      <SelectItem value="reserved">{t("dashboard.reserved")}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Search Results Summary */}
          {searchQuery && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Search className="h-4 w-4" />
              <span>Showing {filteredRooms.length} result{filteredRooms.length !== 1 ? "s" : ""} for "{searchQuery}"</span>
              {filteredRooms.length === 0 && (
                <span className="text-destructive">— No rooms or guests match your search</span>
              )}
            </div>
          )}

          {/* Room Grid */}
          <RoomStatusBoard
            rooms={filteredRooms as any}
            onRoomClick={(data: any) => setSelectedRoom(data as any)}
          />
        </TabsContent>

        {/* Arrivals & Departures Tab */}
        <TabsContent value="arrivals" className="mt-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <ArrivalsDepartures rooms={rooms as any} reservations={reservations as any} guests={guests as any} />
          </div>
        </TabsContent>
      </Tabs>

      {/* Room Details Drawer */}
      <RoomDetailsDrawer
        isOpen={!!selectedRoom}
        onClose={() => setSelectedRoom(null)}
        room={selectedRoom?.room ?? null}
        guest={selectedRoom?.guest ?? null}
        reservation={selectedRoom?.reservation ?? null}
      />
    </div>
  );
}
