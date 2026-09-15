import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@/lib/api";
import { useStore } from "@/lib/store";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Form, FormItem, FormLabel, FormControl } from "@/components/ui/form";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import confetti from "canvas-confetti";
import { useTranslation } from "react-i18next";
import { DataTablePagination } from "@/components/ui/DataTablePagination";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Sparkles, Plus, RefreshCw, Wrench, CheckCircle2, ClipboardCheck, BedDouble, ShieldCheck, Clock } from "lucide-react";

function LiveStopwatch({ startTime }: { startTime?: string | number }) {
  const [seconds, setSeconds] = useState(0);

  useEffect(() => {
    const startMs = startTime ? new Date(startTime).getTime() : Date.now();
    const updateTimer = () => {
      const elapsed = Math.max(0, Math.floor((Date.now() - startMs) / 1000));
      setSeconds(elapsed);
    };
    updateTimer();
    const interval = setInterval(updateTimer, 1000);
    return () => clearInterval(interval);
  }, [startTime]);

  const mins = String(Math.floor(seconds / 60)).padStart(2, "0");
  const secs = String(seconds % 60).padStart(2, "0");

  return <span className="font-mono text-sm font-bold text-amber-900 dark:text-amber-300">{mins}:{secs}</span>;
}

function fireConfettiBlast() {
  confetti({
    particleCount: 100,
    spread: 70,
    origin: { y: 0.6 },
    colors: ["#38bdf8", "#0284c7", "#10b981", "#f59e0b", "#ec4899", "#8b5cf6"],
  });
}

function normalizeList(data: any) {
  if (Array.isArray(data)) return { items: data, total: data.length };
  if (data?.items) return data;
  return { items: [], total: 0 };
}

const STATUS_CONFIG: Record<string, { label: string; color: string; bg: string }> = {
  pending:     { label: "Pending",     color: "text-amber-700",  bg: "bg-amber-50 border-amber-200" },
  "in-progress": { label: "In Progress", color: "text-blue-700", bg: "bg-blue-50 border-blue-200" },
  clean:       { label: "Clean",       color: "text-green-700", bg: "bg-green-50 border-green-200" },
  inspected:   { label: "Inspected",   color: "text-violet-700", bg: "bg-violet-50 border-violet-200" },
};

function getRoomForTask(targetRoomId: any, allRooms: any[]) {
  if (targetRoomId == null) return null;
  const targetStr = String(targetRoomId).trim();
  return allRooms.find((r: any) =>
    String(r.id) === targetStr ||
    String(r.number) === targetStr ||
    String(r.room_number) === targetStr
  );
}

export default function HousekeepingPage() {
  const { t } = useTranslation();
  const storeRooms = useStore((state) => state.rooms);
  const updateRoomStatus = useStore((state) => state.updateRoomStatus);
  const [hkTab, setHkTab] = useState<'cleaning' | 'status' | 'tasks'>('cleaning');
  const [filterStatus, setFilterStatus] = useState("all");
  const [filterFloor, setFilterFloor] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [page, setPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(8);
  const [dialogOpen, setDialogOpen] = useState(false);
  const qc = useQueryClient();

  const hkQ = useQuery({
    queryKey: ["housekeeping", filterStatus, filterFloor, searchQuery, storeRooms],
    queryFn: async () => {
      const [{ data: hkData }, { data: roomsData }] = await Promise.all([
        apiClient.housekeeping.list({ limit: 250 }),
        apiClient.rooms.list({ limit: 250 }),
      ]);
      const hkList = normalizeList(hkData).items;
      const apiRooms = normalizeList(roomsData).items;
      const allRooms = storeRooms.length > 0 ? storeRooms : apiRooms;

      // Housekeeping items are STRICTLY derived from rooms whose status is 'dirty' in the rooms table
      const activeDirtyList: any[] = [];

      allRooms.forEach((r: any) => {
        const roomStatus = r.status?.toLowerCase();
        
        // ONLY rooms whose status in the Rooms list is 'dirty' should appear in Housekeeping!
        if (roomStatus === "dirty") {
          const existingTask = hkList.find((t: any) =>
            String(t.roomId) === String(r.id) ||
            String(t.roomId) === String(r.number) ||
            String(t.roomId) === String(r.room_number)
          );

          activeDirtyList.push(existingTask || {
            id: `dirty-${r.id}`,
            roomId: r.id,
            status: "pending",
            assignedTo: "Maria Rodriguez",
            notes: "Room marked dirty - Turnaround cleaning required",
            isAutoGenerated: true,
          });
        }
      });

      let filtered = activeDirtyList;

      if (filterFloor !== "all") {
        filtered = filtered.filter((t: any) => {
          const roomObj = getRoomForTask(t.roomId, allRooms);
          return String(roomObj?.floor) === filterFloor;
        });
      }

      if (filterStatus !== "all") {
        filtered = filtered.filter((r: any) => r.status === filterStatus);
      }

      if (searchQuery) {
        filtered = filtered.filter((t: any) => {
          const roomObj = getRoomForTask(t.roomId, allRooms);
          const roomNum = roomObj?.number || roomObj?.room_number || String(t.roomId || "");
          return roomNum.toLowerCase().includes(searchQuery.toLowerCase()) || (t.assignedTo || "").toLowerCase().includes(searchQuery.toLowerCase());
        });
      }

      return filtered;
    },
  });

  const roomsQ = useQuery({
    queryKey: ["rooms-hk"],
    queryFn: async () => {
      const { data } = await apiClient.rooms.list({ limit: 250 });
      return normalizeList(data).items;
    },
  });

  const mainQ = useQuery({
    queryKey: ["maintenance-hk"],
    queryFn: async () => {
      const { data } = await apiClient.maintenance.list({ limit: 100 });
      return normalizeList(data).items;
    },
  });

  const form = useForm({
    defaultValues: { roomId: "", status: "pending", assignedTo: "", notes: "" },
  });

  const createM = useMutation({
    mutationFn: (d: any) => apiClient.housekeeping.create({ ...d, roomId: Number(d.roomId) || null }),
    onSuccess: (_, variables) => {
      qc.invalidateQueries({ queryKey: ["housekeeping"] });
      qc.invalidateQueries({ queryKey: ["rooms"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      apiClient.notifications.create({
        type: "housekeeping",
        title: "New Housekeeping Task",
        message: `Housekeeping task assigned for Room #${variables.roomId || 'General'}`,
      }).then(() => qc.invalidateQueries({ queryKey: ["notifications"] })).catch(() => {});
      toast.success(t("housekeeping.toastTaskCreated"));
      setDialogOpen(false);
      form.reset();
    },
    onError: (e: any) => toast.error(e?.response?.data?.error || t("housekeeping.toastFailed")),
  });

  const updateM = useMutation({
    mutationFn: async ({ id, data }: any) => {
      if (typeof id === "string" && id.startsWith("dirty-")) {
        const roomId = Number(id.replace("dirty-", ""));
        return apiClient.housekeeping.create({
          roomId,
          status: data.status || "in-progress",
          assignedTo: "Maria Rodriguez",
          notes: "Room marked dirty - Turnaround cleaning required",
        });
      }
      return apiClient.housekeeping.update(id, data);
    },
    onSuccess: (_, variables) => {
      qc.invalidateQueries({ queryKey: ["housekeeping"] });
      qc.invalidateQueries({ queryKey: ["rooms"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      const newStatus = (variables.data?.status || "updated").toUpperCase();
      apiClient.notifications.create({
        type: "housekeeping",
        title: `Housekeeping Alert`,
        message: `Housekeeping status updated to ${newStatus}`,
      }).then(() => qc.invalidateQueries({ queryKey: ["notifications"] })).catch(() => {});
      toast.success(t("housekeeping.toastStatusUpdated"));
    },
    onError: () => toast.error(t("housekeeping.toastFailedUpdate")),
  });

  const updateRoomM = useMutation({
    mutationFn: ({ roomId, status }: { roomId: number; status: string }) => {
      updateRoomStatus(roomId, status as any);
      return apiClient.rooms.update(String(roomId), { status, isAvailable: status === "vacant" || status === "clean" });
    },
    onSuccess: (_, variables) => {
      qc.invalidateQueries({ queryKey: ["rooms"] });
      qc.invalidateQueries({ queryKey: ["rooms-hk"] });
      qc.invalidateQueries({ queryKey: ["housekeeping"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      apiClient.notifications.create({
        type: "housekeeping",
        title: "Room Ready Status",
        message: `Room #${variables.roomId} status changed to ${variables.status.toUpperCase()}`,
      }).then(() => qc.invalidateQueries({ queryKey: ["notifications"] })).catch(() => {});
      toast.success(t("housekeeping.toastRoomStatusUpdated"));
    },
  });

  const items = hkQ.data ?? [];
  const allRooms = roomsQ.data ?? [];
  const maintItems = mainQ.data ?? [];

  return (
    <div className="space-y-6">
      {/* Top Hero Banner with Housekeeping Image */}
      <div className="relative overflow-hidden rounded-3xl bg-gradient-to-r from-[#2A1D15] via-[#3D2B1E] to-[#543A29] text-white p-6 sm:p-7 shadow-xl border border-[#8B6748]/30">
        {/* Background Decorative Housekeeping Photo */}
        <div className="absolute right-0 top-0 bottom-0 w-full sm:w-1/2 lg:w-2/5 overflow-hidden opacity-25 sm:opacity-35 pointer-events-none">
          <img
            src="/housekeeping.png"
            alt="Housekeeping Staff"
            className="w-full h-full object-cover object-center mix-blend-luminosity"
          />
          <div className="absolute inset-0 bg-gradient-to-r from-[#2A1D15] via-[#2A1D15]/70 to-transparent" />
        </div>

        <div className="relative z-10 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-5">
          <div className="flex items-center gap-4">
            <div className="relative h-16 w-16 sm:h-20 sm:w-20 rounded-2xl overflow-hidden border-2 border-white/30 shadow-lg shrink-0">
              <img
                src="/housekeeping_square.png"
                alt="Housekeeping Team"
                className="h-full w-full object-cover"
              />
              <div className="absolute bottom-1 right-1 h-3.5 w-3.5 rounded-full bg-emerald-400 ring-2 ring-[#2A1D15]" title="Active on duty" />
            </div>
            <div>
              <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-white/15 text-[#EFE7DE] text-[11px] font-bold mb-1.5 border border-white/20">
                <Sparkles className="h-3 w-3 text-amber-300" /> Cleanliness & Turnaround Operations
              </div>
              <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-white">{t("housekeeping.title")}</h1>
              <p className="text-xs sm:text-sm text-[#E2D4C3] mt-1 max-w-lg">{t("housekeeping.subtitle")}</p>
            </div>
          </div>

          <div className="flex items-center gap-3 w-full sm:w-auto">
            <Button
              size="sm"
              onClick={() => { form.reset(); setDialogOpen(true); }}
              className="bg-[#8B6748] hover:bg-[#745539] text-white gap-2 rounded-xl font-bold shadow-md cursor-pointer px-4 py-2.5 text-sm border border-white/20"
            >
              <Plus className="h-4 w-4" /> {t("common.create")}
            </Button>
          </div>
        </div>
      </div>

      {/* Department Sub-Navigation: Room Cleaning | Room Status | Tasks */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-3">
        <Tabs value={hkTab} onValueChange={(v) => setHkTab(v as any)} className="w-full sm:w-auto">
          <TabsList className="bg-card border border-border p-1 rounded-2xl grid grid-cols-3 h-auto shadow-2xs">
            <TabsTrigger value="cleaning" className="rounded-xl py-2 px-2 sm:px-4 gap-1.5 sm:gap-2 text-[11px] sm:text-sm font-bold data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">
              <Sparkles className="h-3.5 w-3.5 sm:h-4 sm:w-4 text-amber-500" />
              <span>Room Cleaning</span>
            </TabsTrigger>
            <TabsTrigger value="status" className="rounded-xl py-2 px-2 sm:px-4 gap-1.5 sm:gap-2 text-[11px] sm:text-sm font-bold data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">
              <CheckCircle2 className="h-3.5 w-3.5 sm:h-4 sm:w-4 text-emerald-500" />
              <span>Room Status</span>
            </TabsTrigger>
            <TabsTrigger value="tasks" className="rounded-xl py-2 px-2 sm:px-4 gap-1.5 sm:gap-2 text-[11px] sm:text-sm font-bold data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">
              <ClipboardCheck className="h-3.5 w-3.5 sm:h-4 sm:w-4 text-sky-500" />
              <span>Tasks</span>
            </TabsTrigger>
          </TabsList>
        </Tabs>
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-pink-500/10 text-pink-600 font-bold border border-pink-500/20">
            Dirty: {allRooms.filter((r: any) => r.status?.toLowerCase() === 'dirty').length}
          </span>
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-500/10 text-emerald-600 font-bold border border-emerald-500/20">
            Clean: {allRooms.filter((r: any) => r.status?.toLowerCase() === 'clean' || r.status?.toLowerCase() === 'vacant').length}
          </span>
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-violet-500/10 text-violet-600 font-bold border border-violet-500/20">
            Inspected: {allRooms.filter((r: any) => r.status?.toLowerCase() === 'inspected').length}
          </span>
        </div>
      </div>

      {/* Housekeeping Content: Cleaning Queue Tab */}
      {hkTab === "cleaning" && (
        <div className="space-y-6">
          <div className="space-y-6">
            {/* Filtering Bar */}
            <div className="rounded-2xl bg-card border border-border p-4 flex flex-wrap items-center justify-between gap-4">
              <div className="flex-1 min-w-[240px]">
                <Input
                  placeholder={t("housekeeping.searchPlaceholder")}
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="bg-accent/40"
                />
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <Select value={filterFloor} onValueChange={setFilterFloor}>
                  <SelectTrigger className="w-36"><SelectValue placeholder={t("dashboard.allFloors")} /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">{t("dashboard.allFloors")}</SelectItem>
                    <SelectItem value="1">{t("dashboard.floor", { floor: 1 })}</SelectItem>
                    <SelectItem value="2">{t("dashboard.floor", { floor: 2 })}</SelectItem>
                    <SelectItem value="3">{t("dashboard.floor", { floor: 3 })}</SelectItem>
                    <SelectItem value="4">{t("dashboard.floor", { floor: 4 })}</SelectItem>
                  </SelectContent>
                </Select>

                <Select value={filterStatus} onValueChange={setFilterStatus}>
                  <SelectTrigger className="w-40"><SelectValue placeholder={t("housekeeping.allStatuses")} /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">{t("housekeeping.allStatuses")}</SelectItem>
                    <SelectItem value="pending">{t("housekeeping.dirtyPending")}</SelectItem>
                    <SelectItem value="in-progress">{t("housekeeping.inProgress")}</SelectItem>
                    <SelectItem value="clean">{t("housekeeping.clean")}</SelectItem>
                    <SelectItem value="inspected">{t("housekeeping.inspection")}</SelectItem>
                  </SelectContent>
                </Select>

                <Button variant="outline" size="icon" onClick={() => qc.invalidateQueries({ queryKey: ["housekeeping"] })}>
                  <RefreshCw className="h-4 w-4" />
                </Button>
              </div>
            </div>

            {/* Housekeeping Room Cards Grid / Empty State */}
            {items.length === 0 ? (
              <div className="rounded-3xl border border-dashed border-border bg-card/60 p-8 sm:p-12 text-center space-y-4 max-w-lg mx-auto shadow-2xs">
                <div className="relative mx-auto w-36 h-36 aspect-square rounded-2xl overflow-hidden shadow-md border border-emerald-500/30">
                  <img
                    src="/housekeeping.png"
                    alt="All Rooms Clean"
                    className="h-full w-full object-cover"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-emerald-950/75 via-transparent to-transparent flex items-end justify-center pb-2">
                    <span className="text-xs font-bold text-white flex items-center gap-1">
                      <Sparkles className="h-3.5 w-3.5 text-amber-300" /> All Rooms Clean
                    </span>
                  </div>
                </div>
                <h3 className="text-lg font-bold text-foreground">{t("housekeeping.noDirtyRooms")}</h3>
                <p className="text-xs text-muted-foreground max-w-sm mx-auto">
                  {t("housekeeping.allRoomsClean")}
                </p>
              </div>
            ) : (
              <>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 sm:gap-5">
                {(itemsPerPage === 0 ? items : items.slice((page - 1) * itemsPerPage, page * itemsPerPage)).map((task: any) => {
                  const roomObj = getRoomForTask(task.roomId, allRooms);
                  const roomNum = roomObj?.number || roomObj?.room_number || String(task.roomId || "1001");
                  const roomType = roomObj?.type || "King Suite";
                  const floor = roomObj?.floor || 1;
                  const status = task.status || "pending";
                  const priority = task.priority || (status === "pending" ? "HIGH" : status === "in-progress" ? "HIGH" : "MEDIUM");

                  return (
                    <div key={task.id} className="rounded-2xl border border-border/80 bg-card p-4 sm:p-5 space-y-4 shadow-md hover:shadow-lg transition-all flex flex-col justify-between overflow-hidden">
                      <div className="space-y-3">
                        {/* Housekeeping Task Card 1:1 Square Image */}
                        <div className="relative w-full aspect-square rounded-2xl overflow-hidden mb-2 border border-border/60 group-hover:border-primary/40 transition-colors shrink-0 max-h-48 sm:max-h-56">
                          <img
                            src="/housekeeping.png"
                            alt={`Housekeeping Room ${roomNum}`}
                            className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                            loading="lazy"
                          />
                          <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/20 to-transparent" />
                          <div className="absolute top-2 left-2 px-2 py-0.5 rounded-md bg-black/60 backdrop-blur-xs text-[10px] font-bold text-white uppercase tracking-wider flex items-center gap-1">
                            <Sparkles className="h-2.5 w-2.5 text-amber-300" /> Housekeeping
                          </div>
                          <div className="absolute bottom-2 left-2.5 right-2.5 flex items-center justify-between text-white text-xs">
                            <span className="font-extrabold text-sm drop-shadow-sm">Room {roomNum}</span>
                            <span className="text-[11px] font-medium opacity-90">{roomType}</span>
                          </div>
                        </div>

                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <span className="text-lg font-black text-foreground">{t("roomDrawer.roomNumber", { number: roomNum })}</span>
                            <span className="text-xs text-muted-foreground font-semibold">({String(t("dashboard." + roomType.toLowerCase(), roomType))})</span>
                          </div>
                          <span className="text-xs text-muted-foreground font-mono">{t("dashboard.floor", { floor })}</span>
                        </div>

                        <div className="flex items-center justify-between text-xs pt-1">
                          <span className="font-semibold text-muted-foreground">{t("housekeeping.cleaningStatus")}</span>
                          {status === "pending" && (
                            <>
                              <span className="px-3 py-0.5 rounded-full text-xs font-bold bg-pink-500/15 text-pink-600 border border-pink-500/20 uppercase tracking-wider flex items-center gap-1">
                                <span className="h-1.5 w-1.5 rounded-full bg-pink-500"></span> {t("housekeeping.dirty")}
                              </span>
                            </>
                          )}
                          {status === "in-progress" && (
                            <>
                              <span className="px-3 py-0.5 rounded-full text-xs font-bold bg-amber-500/15 text-amber-600 border border-amber-500/20 uppercase tracking-wider flex items-center gap-1">
                                <span className="h-1.5 w-1.5 rounded-full bg-amber-500 animate-pulse"></span> {t("housekeeping.inProgressUpper")}
                              </span>
                            </>
                          )}
                          {status === "clean" && (
                            <>
                              <span className="px-3 py-0.5 rounded-full text-xs font-bold bg-sky-500/15 text-sky-600 border border-sky-500/20 uppercase tracking-wider flex items-center gap-1">
                                <span className="h-1.5 w-1.5 rounded-full bg-sky-500"></span> {t("housekeeping.cleanUpper")}
                              </span>
                            </>
                          )}
                          {status === "inspected" && (
                            <>
                              <span className="px-3 py-0.5 rounded-full text-xs font-bold bg-emerald-500/15 text-emerald-600 border border-emerald-500/20 uppercase tracking-wider flex items-center gap-1">
                                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500"></span> {t("housekeeping.inspectedUpper")}
                              </span>
                            </>
                          )}
                        </div>

                        <div className="p-3.5 rounded-xl bg-accent/40 text-xs text-muted-foreground leading-relaxed">
                          {task.notes || t("housekeeping.defaultTurnaroundNotes")}
                        </div>

                        <div className="flex items-center justify-between text-xs pt-1">
                          <div>
                            <span className="text-muted-foreground">{t("housekeeping.assignedTo")} </span>
                            <span className="font-bold text-foreground">{task.assignedTo || "Maria Rodriguez"}</span>
                          </div>
                          <span className={`px-2 py-0.5 rounded text-[10px] font-extrabold uppercase tracking-wider ${
                            priority === "HIGH" ? "bg-rose-500/10 text-rose-600 border border-rose-500/20" : "bg-blue-500/10 text-blue-600 border border-blue-500/20"
                          }`}>
                            {priority === "HIGH" ? t("housekeeping.highPriority") : t("housekeeping.mediumPriority")}
                          </span>
                        </div>
                      </div>

                      <div className="border-t border-border pt-3 space-y-3">
                        {status === "in-progress" && (
                          <div className="flex items-center justify-between p-2 rounded-xl bg-amber-500/10 border border-amber-500/20 text-xs font-bold text-amber-700 dark:text-amber-300">
                            <span className="flex items-center gap-1.5">
                              <span className="h-2 w-2 rounded-full bg-amber-500 animate-ping"></span> {t("housekeeping.liveCleaningTimer")}
                            </span>
                            <LiveStopwatch startTime={task.cleaningStartedAt || task.createdAt} />
                          </div>
                        )}

                        <div className="flex gap-2">
                          {status === "pending" && (
                            <Button
                              onClick={() => updateM.mutate({ id: task.id, data: { status: "in-progress", cleaningStartedAt: new Date().toISOString() } })}
                              className="flex-1 bg-primary hover:bg-primary/90 text-primary-foreground font-bold rounded-xl shadow-md shadow-primary/20 py-2.5 cursor-pointer"
                            >
                              ▶ {t("housekeeping.startCleaning")}
                            </Button>
                          )}
                          {status === "in-progress" && (
                            <Button
                              onClick={() => {
                                fireConfettiBlast();
                                updateM.mutate({ id: task.id, data: { status: "clean" } });
                                if (task.roomId) {
                                  updateRoomM.mutate({ roomId: Number(task.roomId), status: "vacant" });
                                }
                              }}
                              className="flex-1 bg-primary hover:bg-primary/90 text-primary-foreground font-bold rounded-xl shadow-md shadow-primary/20 py-2.5 cursor-pointer"
                            >
                              ✓ {t("housekeeping.markCleanVacant")}
                            </Button>
                          )}
                          {status === "clean" && (
                            <Button
                              onClick={() => {
                                fireConfettiBlast();
                                updateM.mutate({ id: task.id, data: { status: "inspected" } });
                              }}
                              className="flex-1 bg-primary hover:bg-primary/90 text-primary-foreground font-bold rounded-xl shadow-md shadow-primary/20 py-2.5 cursor-pointer"
                            >
                              🛡 {t("housekeeping.approveInspection")}
                            </Button>
                          )}
                          {status === "inspected" && (
                            <Button
                              onClick={() => updateM.mutate({ id: task.id, data: { status: "pending" } })}
                              className="flex-1 bg-[#8B6748]/80 hover:bg-[#8B6748] text-white font-bold rounded-xl shadow-md shadow-primary/20 py-2.5 cursor-pointer"
                            >
                              ↻ {t("housekeeping.markDirty")}
                            </Button>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
                </div>

                {/* Pagination Controls */}
                <DataTablePagination
                  currentPage={page}
                  totalPages={itemsPerPage === 0 ? 1 : Math.ceil(items.length / itemsPerPage) || 1}
                  totalItems={items.length}
                  pageSize={itemsPerPage}
                  onPageChange={setPage}
                  onPageSizeChange={setItemsPerPage}
                  pageSizeOptions={[8, 16, 24, 0]}
                  itemName="tasks"
                />
              </>
            )}
          </div>
        </div>
      )}

      {/* Housekeeping Content: Room Status Board Tab */}
      {hkTab === "status" && (
        <div className="space-y-4">
          <div className="rounded-2xl border border-border bg-card p-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="font-bold text-foreground">Room Status Board</h3>
              <p className="text-xs text-muted-foreground">Real-time room cleanliness and inspection states across all floors</p>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-mono font-semibold text-muted-foreground">Total: {allRooms.length} Rooms</span>
              <Button variant="outline" size="sm" onClick={() => roomsQ.refetch()} className="rounded-xl gap-1.5">
                <RefreshCw className="h-3.5 w-3.5" /> Refresh
              </Button>
            </div>
          </div>

          <motion.div
            initial={{ opacity: 0 }}
            whileInView={{ opacity: 1 }}
            viewport={{ once: true, margin: "-30px" }}
            className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3"
          >
            {allRooms.map((room: any, idx: number) => {
              const rStatus = (room.status || "vacant").toLowerCase();
              const isDirty = rStatus === "dirty";
              const isClean = rStatus === "clean" || rStatus === "vacant";
              const isInspected = rStatus === "inspected";
              const isMaint = rStatus === "maintenance";

              return (
                <motion.div
                  key={room.id}
                  initial={{ opacity: 0, y: 12 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ duration: 0.22, delay: Math.min(idx * 0.015, 0.25), ease: "easeOut" }}
                  className="rounded-xl border border-border bg-card p-3.5 space-y-3 shadow-2xs hover:shadow-md card-hover-lift transition-all flex flex-col justify-between"
                >
                  <div className="flex items-center gap-2.5">
                    <img
                      src={
                        room.image ||
                        (String(room.type).toLowerCase().includes("premium")
                          ? "/rooms/premium.png"
                          : String(room.type).toLowerCase().includes("family")
                          ? "/rooms/family.png"
                          : String(room.type).toLowerCase().includes("standard")
                          ? "/rooms/standard.png"
                          : String(room.type).toLowerCase().includes("suite")
                          ? "/rooms/suite.png"
                          : "/rooms/deluxe.png")
                      }
                      alt={room.type || "Room"}
                      className="h-10 w-10 aspect-square rounded-lg object-cover border border-border/80 shrink-0 shadow-2xs"
                      loading="lazy"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between">
                        <span className="text-base font-black text-foreground">#{room.number || room.room_number}</span>
                        <span className="text-[10px] text-muted-foreground font-mono">Floor {room.floor || 1}</span>
                      </div>
                      <p className="text-[11px] text-muted-foreground truncate">{room.type || "Standard"}</p>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <span className={`inline-block w-full text-center py-1 rounded-md text-[10px] font-bold uppercase tracking-wider ${
                      isDirty ? "bg-pink-500/15 text-pink-600 border border-pink-500/30" :
                      isClean ? "bg-emerald-500/15 text-emerald-600 border border-emerald-500/30" :
                      isInspected ? "bg-violet-500/15 text-violet-600 border border-violet-500/30" :
                      "bg-amber-500/15 text-amber-600 border border-amber-500/30"
                    }`}>
                      {rStatus}
                    </span>

                    <div className="grid grid-cols-3 gap-1 pt-1">
                      <button
                        type="button"
                        onClick={() => updateRoomM.mutate({ roomId: room.id, status: "clean" })}
                        title="Mark Clean"
                        className="py-1 text-[10px] font-bold rounded bg-emerald-500/10 hover:bg-emerald-500 text-emerald-700 hover:text-white transition-colors cursor-pointer"
                      >
                        Clean
                      </button>
                      <button
                        type="button"
                        onClick={() => updateRoomM.mutate({ roomId: room.id, status: "dirty" })}
                        title="Mark Dirty"
                        className="py-1 text-[10px] font-bold rounded bg-pink-500/10 hover:bg-pink-500 text-pink-700 hover:text-white transition-colors cursor-pointer"
                      >
                        Dirty
                      </button>
                      <button
                        type="button"
                        onClick={() => updateRoomM.mutate({ roomId: room.id, status: "inspected" })}
                        title="Approve Inspection"
                        className="py-1 text-[10px] font-bold rounded bg-violet-500/10 hover:bg-violet-500 text-violet-700 hover:text-white transition-colors cursor-pointer"
                      >
                        Inspect
                      </button>
                    </div>
                  </div>
                </motion.div>
              );
            })}
          </motion.div>
        </div>
      )}

      {/* Housekeeping Content: Tasks Tab */}
      {hkTab === "tasks" && (
        <div className="space-y-4">
          <div className="rounded-2xl border border-border bg-card p-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="font-bold text-foreground">Housekeeping Staff Tasks</h3>
              <p className="text-xs text-muted-foreground">Daily room assignments, turnaround checklists, and work notes</p>
            </div>
            <Button size="sm" onClick={() => { form.reset(); setDialogOpen(true); }} className="rounded-xl font-bold bg-primary text-primary-foreground gap-2 cursor-pointer">
              <Plus className="h-4 w-4" /> Assign New Task
            </Button>
          </div>

          <div className="rounded-2xl border border-border bg-card overflow-hidden shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="bg-muted/50 text-xs uppercase font-bold text-muted-foreground border-b border-border">
                  <tr>
                    <th className="p-3.5">Room</th>
                    <th className="p-3.5">Assigned Staff</th>
                    <th className="p-3.5">Status</th>
                    <th className="p-3.5">Task Description / Notes</th>
                    <th className="p-3.5 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {items.map((task: any) => {
                    const roomObj = getRoomForTask(task.roomId, allRooms);
                    const roomNum = roomObj?.number || roomObj?.room_number || String(task.roomId || "");
                    return (
                      <tr key={task.id} className="hover:bg-accent/40 transition-colors">
                        <td className="p-3.5 font-bold text-foreground">Room #{roomNum}</td>
                        <td className="p-3.5 font-medium text-foreground">{task.assignedTo || "Maria Rodriguez"}</td>
                        <td className="p-3.5">
                          <span className="px-2.5 py-0.5 rounded-full text-xs font-bold uppercase tracking-wider bg-accent text-foreground">
                            {task.status || "pending"}
                          </span>
                        </td>
                        <td className="p-3.5 text-xs text-muted-foreground max-w-xs truncate">
                          {task.notes || "Turnaround cleaning required"}
                        </td>
                        <td className="p-3.5 text-right">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              fireConfettiBlast();
                              updateM.mutate({ id: task.id, data: { status: "clean" } });
                              if (task.roomId) updateRoomM.mutate({ roomId: Number(task.roomId), status: "vacant" });
                            }}
                            className="rounded-xl text-xs font-semibold h-8 cursor-pointer"
                          >
                            Mark Completed
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* New Task Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle className="text-2xl font-bold text-slate-900">{t("housekeeping.newTask")}</DialogTitle></DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(d => {
              if (!d.roomId || d.roomId === "") {
                toast.error(t("housekeeping.validationSelectRoom"));
                return;
              }
              if (!d.assignedTo || !d.assignedTo.trim()) {
                toast.error(t("housekeeping.validationStaffRequired"));
                return;
              }
              if (!d.notes || !d.notes.trim()) {
                toast.error(t("housekeeping.validationNotesRequired"));
                return;
              }
              createM.mutate(d);
            })} className="space-y-4 pt-2">
              <FormItem>
                <FormLabel className="font-semibold text-slate-800">{t("housekeeping.roomLabel")}</FormLabel>
                <FormControl>
                  <Select value={form.watch("roomId")} onValueChange={v => form.setValue("roomId", v)}>
                    <SelectTrigger><SelectValue placeholder={t("housekeeping.selectRoom")} /></SelectTrigger>
                    <SelectContent>
                      {allRooms.map((r: any) => (
                        <SelectItem key={r.id} value={String(r.id)}>{t("roomDrawer.roomNumber", { number: r.number || r.room_number })} ({String(t("dashboard." + (r.type || "Standard").toLowerCase(), r.type || "Standard"))})</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </FormControl>
              </FormItem>
              <FormItem>
                <FormLabel className="font-semibold text-slate-800">{t("housekeeping.assignedTo")}</FormLabel>
                <FormControl><Input placeholder={t("housekeeping.placeholderNotes")} {...form.register("assignedTo")} /></FormControl>
              </FormItem>
              <FormItem>
                <FormLabel className="font-semibold text-slate-800">{t("housekeeping.status")}</FormLabel>
                <FormControl>
                  <Select value={form.watch("status")} onValueChange={v => form.setValue("status", v)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="pending">{t("housekeeping.dirtyPending")}</SelectItem>
                      <SelectItem value="in-progress">{t("housekeeping.inProgress")}</SelectItem>
                      <SelectItem value="clean">{t("housekeeping.clean")}</SelectItem>
                      <SelectItem value="inspected">{t("housekeeping.inspection")}</SelectItem>
                    </SelectContent>
                  </Select>
                </FormControl>
              </FormItem>
              <FormItem>
                <FormLabel className="font-semibold text-slate-800">{t("housekeeping.notesInstructions")}</FormLabel>
                <FormControl><Input placeholder={t("housekeeping.placeholderNotes")} {...form.register("notes")} /></FormControl>
              </FormItem>
              <div className="flex gap-3 justify-end pt-4">
                <Button type="button" variant="outline" className="h-11 rounded-2xl border-border bg-card hover:bg-accent text-foreground font-medium px-6" onClick={() => setDialogOpen(false)}>
                  {t("common.cancel")}
                </Button>
                <Button type="submit" className="h-11 rounded-2xl bg-primary hover:bg-primary/90 text-primary-foreground font-semibold px-6 shadow-md shadow-primary/20" disabled={createM.isPending}>
                  {createM.isPending ? t("common.submitting") : t("housekeeping.saveTask")}
                </Button>
              </div>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
