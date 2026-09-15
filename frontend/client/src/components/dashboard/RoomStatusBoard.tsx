import { useState, useMemo } from "react";
import { motion } from "framer-motion";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Form, FormItem, FormLabel, FormControl } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DataTablePagination } from "@/components/ui/DataTablePagination";
import { apiClient } from "@/lib/api";
import { useStore } from "@/lib/store";
import {
  Bed,
  Users,
  Star,
  Sparkles,
  ArrowUpRight,
  LayoutGrid,
  Grid3X3,
  List,
  Wrench,
  Brush,
  CheckCircle2,
  CalendarCheck,
  Eye,
  ArrowUpDown,
  Building2,
  Plus,
  Pencil,
  Trash2,
  Calendar,
  ArrowRight,
  Lock,
} from "lucide-react";
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
  amenities: string | null;
  image?: string | null;
  isAvailable?: number;
  bookImmediately?: boolean;
}

interface RoomStatusBoardProps {
  rooms: Room[];
  onRoomClick: (data: { room: Room; guest?: any; reservation?: any }) => void;
}

const statusConfig: Record<string, { color: string; bg: string; border: string; key: string; dotColor: string; label?: string }> = {
  vacant: { color: "text-emerald-600 dark:text-emerald-400", bg: "bg-emerald-500/10", border: "border-emerald-500/30", key: "vacant", dotColor: "#10b981", label: "Vacant" },
  occupied: { color: "text-blue-600 dark:text-blue-400", bg: "bg-blue-500/10", border: "border-blue-500/30", key: "occupied", dotColor: "#3b82f6", label: "Occupied" },
  dirty: { color: "text-amber-600 dark:text-amber-400", bg: "bg-amber-500/10", border: "border-amber-500/30", key: "dirty", dotColor: "#f59e0b", label: "Dirty" },
  maintenance: { color: "text-red-600 dark:text-red-400", bg: "bg-red-500/10", border: "border-red-500/30", key: "maintenance", dotColor: "#ef4444", label: "Out of Order / Maintenance" },
  reserved: { color: "text-purple-600 dark:text-purple-400", bg: "bg-purple-500/10", border: "border-purple-500/30", key: "reserved", dotColor: "#a855f7", label: "Reserved" },
};

const getTypeIcon = (typeStr: string) => {
  const t = (typeStr || "").toLowerCase();
  if (t.includes("family") || t.includes("accessible")) return Users;
  if (t.includes("suite") || t.includes("deluxe") || t.includes("premium")) return Star;
  return Bed;
};

export default function RoomStatusBoard({ rooms, onRoomClick }: RoomStatusBoardProps) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const setRoomsInStore = useStore((state) => state.setRooms);

  // Dashboard renders this board from a Zustand store it polls on an interval
  // (not React Query), so a plain queryClient invalidation doesn't reach it -
  // push the fresh list into that store directly after any room mutation.
  const refreshRoomsStore = async () => {
    try {
      const { data } = await apiClient.rooms.list({ limit: 250 });
      const list = Array.isArray(data) ? data : data?.items ?? [];
      setRoomsInStore(list as any);
    } catch {
      // best-effort; the 15s dashboard poll will still pick up the change
    }
  };
  const [viewMode, setViewMode] = useState<"comfortable" | "compact" | "list">("comfortable");
  const [sortOption, setSortOption] = useState<string>("floor-asc");
  const [selectedFloor, setSelectedFloor] = useState<number | "all">("all");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(20);

  const [roomDialogOpen, setRoomDialogOpen] = useState(false);
  const [editingRoom, setEditingRoom] = useState<Room | null>(null);
  const roomForm = useForm({
    defaultValues: { number: "", type: "Standard", floor: 1, rate: 100, capacity: 2, status: "vacant" },
  });

  const openAddRoom = () => {
    setEditingRoom(null);
    roomForm.reset({ number: "", type: "Standard", floor: 1, rate: 100, capacity: 2, status: "vacant" });
    setRoomDialogOpen(true);
  };

  const openEditRoom = (room: Room) => {
    setEditingRoom(room);
    roomForm.reset({
      number: room.number,
      type: room.type,
      floor: room.floor,
      rate: room.rate,
      capacity: room.capacity,
      status: room.status,
    });
    setRoomDialogOpen(true);
  };

  const createRoomM = useMutation({
    mutationFn: (d: any) => apiClient.rooms.create(d),
    onSuccess: async () => {
      qc.invalidateQueries({ queryKey: ["rooms"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      await refreshRoomsStore();
      toast.success(`Room ${roomForm.getValues("number")} created`);
      setRoomDialogOpen(false);
    },
    onError: (e: any) => toast.error(e?.response?.data?.error || "Failed to create room"),
  });

  const updateRoomM = useMutation({
    mutationFn: ({ id, data }: any) => apiClient.rooms.update(id, data),
    onSuccess: async () => {
      qc.invalidateQueries({ queryKey: ["rooms"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      await refreshRoomsStore();
      toast.success("Room updated");
      setRoomDialogOpen(false);
    },
    onError: (e: any) => toast.error(e?.response?.data?.error || "Failed to update room"),
  });

  const deleteRoomM = useMutation({
    mutationFn: (id: string) => apiClient.rooms.remove(id),
    onSuccess: async () => {
      qc.invalidateQueries({ queryKey: ["rooms"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      await refreshRoomsStore();
      toast.success("Room deleted");
    },
    onError: (e: any) => toast.error(e?.response?.data?.error || "Failed to delete room"),
  });

  const handleRoomFormSubmit = (d: any) => {
    if (!editingRoom && (!d.number || !String(d.number).trim())) {
      toast.error("Room number is required");
      return;
    }
    if (editingRoom) {
      updateRoomM.mutate({
        id: String(editingRoom.id),
        data: {
          status: d.status,
          rate: Number(d.rate),
          floor: Number(d.floor),
          isAvailable: d.status === "vacant",
        },
      });
    } else {
      createRoomM.mutate({
        number: String(d.number).trim(),
        type: d.type,
        floor: Number(d.floor),
        rate: Number(d.rate),
        capacity: Number(d.capacity),
        status: "vacant",
      });
    }
  };

  const handleDeleteRoom = (room: Room) => {
    if (!window.confirm(`Delete Room ${room.number}? This cannot be undone.`)) return;
    deleteRoomM.mutate(String(room.id));
  };

  // Available floors extracted from the room inventory
  const allFloors = useMemo(() => {
    return Array.from(new Set(rooms.map((r) => Number(r.floor))))
      .filter((f) => !isNaN(f))
      .sort((a, b) => a - b);
  }, [rooms]);

  // Filter by floor if selected
  const floorFilteredRooms = useMemo(() => {
    if (selectedFloor === "all") return rooms;
    return rooms.filter((r) => Number(r.floor) === selectedFloor);
  }, [rooms, selectedFloor]);

  // Natural numeric sorting for all rooms
  const sortedRooms = useMemo(() => {
    return [...floorFilteredRooms].sort((a, b) => {
      const floorA = Number(a.floor) || 0;
      const floorB = Number(b.floor) || 0;
      const numCompare = String(a.number).localeCompare(String(b.number), undefined, { numeric: true });

      switch (sortOption) {
        case "floor-asc":
          if (floorA !== floorB) return floorA - floorB;
          return numCompare;
        case "floor-desc":
          if (floorA !== floorB) return floorB - floorA;
          return -numCompare;
        case "room-asc":
          return numCompare;
        case "room-desc":
          return -numCompare;
        case "rate-asc":
          return (Number(a.rate) || 0) - (Number(b.rate) || 0);
        case "rate-desc":
          return (Number(b.rate) || 0) - (Number(a.rate) || 0);
        case "status":
          return String(a.status).localeCompare(String(b.status));
        default:
          if (floorA !== floorB) return floorA - floorB;
          return numCompare;
      }
    });
  }, [floorFilteredRooms, sortOption]);

  const roomsPerPage = pageSize === 0 ? sortedRooms.length || 1 : pageSize;
  const totalPages = Math.ceil(sortedRooms.length / roomsPerPage) || 1;

  const paginatedRooms = useMemo(() => {
    if (pageSize === 0) return sortedRooms;
    const start = (page - 1) * roomsPerPage;
    return sortedRooms.slice(start, start + roomsPerPage);
  }, [sortedRooms, page, roomsPerPage, pageSize]);

  // Determine floors order for current page
  const floorNumbers = useMemo(() => {
    const uniqueFloors = Array.from(new Set(paginatedRooms.map((r) => Number(r.floor))));
    if (sortOption === "floor-desc") {
      return uniqueFloors.sort((a, b) => b - a);
    }
    return uniqueFloors.sort((a, b) => a - b);
  }, [paginatedRooms, sortOption]);

  const container = {
    hidden: { opacity: 0 },
    show: {
      opacity: 1,
      transition: { staggerChildren: 0.02 },
    },
  };

  const item = {
    hidden: { opacity: 0, y: 14, scale: 0.97 },
    show: { opacity: 1, y: 0, scale: 1, transition: { duration: 0.24, ease: "easeOut" as const } },
  };

  const getStatusSubtext = (status: string) => {
    const s = (status || "").toLowerCase();
    switch (s) {
      case "vacant":
        return { label: t("dashboard.ready"), icon: ArrowUpRight };
      case "occupied":
        return { label: t("dashboard.occupied"), icon: CheckCircle2 };
      case "dirty":
        return { label: t("dashboard.dirty"), icon: Brush };
      case "maintenance":
        return { label: "Out of Order", icon: Wrench };
      case "reserved":
        return { label: t("dashboard.reserved"), icon: CalendarCheck };
      default:
        return { label: t("dashboard.ready"), icon: ArrowUpRight };
    }
  };

  return (
    <>
    <Card className="overflow-hidden border-border/70 shadow-xs">
      <CardHeader className="pb-4 border-b border-border/40">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2 sm:gap-3">
            <CardTitle className="text-base sm:text-lg font-bold flex items-center gap-2 text-foreground">
              <Bed className="h-4.5 w-4.5 sm:h-5 sm:w-5 text-primary" />
              {t("dashboard.roomStatusBoard")}
            </CardTitle>
            <div className="flex items-center gap-1.5 rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-semibold text-primary border border-primary/20">
              <Sparkles className="h-3 w-3" />
              {t("dashboard.roomsCount", { count: sortedRooms.length })}
            </div>
            <Button size="sm" onClick={openAddRoom} className="h-7 rounded-lg bg-primary hover:bg-primary/90 text-primary-foreground text-xs font-semibold px-2.5 sm:px-3 cursor-pointer">
              <Plus className="h-3.5 w-3.5 mr-1" />
              Add Room
            </Button>
          </div>

          <div className="flex flex-wrap items-center gap-2 sm:gap-2.5">
            {/* Sort Order Selector */}
            <div className="flex items-center gap-1.5 bg-muted/60 px-2.5 py-1 rounded-xl border border-border/60 text-xs">
              <ArrowUpDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              <span className="text-muted-foreground font-medium hidden sm:inline">Order:</span>
              <select
                value={sortOption}
                onChange={(e) => {
                  setSortOption(e.target.value);
                  setPage(1);
                }}
                className="bg-transparent text-xs font-semibold text-foreground focus:outline-none cursor-pointer pr-1"
                aria-label="Order rooms"
              >
                <option value="floor-asc" className="bg-card text-foreground">Floor & Room (1 → 150)</option>
                <option value="floor-desc" className="bg-card text-foreground">Floor & Room (150 → 1)</option>
                <option value="room-asc" className="bg-card text-foreground">Room # (Low to High)</option>
                <option value="room-desc" className="bg-card text-foreground">Room # (High to Low)</option>
                <option value="rate-asc" className="bg-card text-foreground">Rate (Low to High)</option>
                <option value="rate-desc" className="bg-card text-foreground">Rate (High to Low)</option>
                <option value="status" className="bg-card text-foreground">Status (Vacant, Occupied...)</option>
              </select>
            </div>

            {/* View mode toggle */}
            <div className="flex items-center gap-1 bg-muted/60 p-1 rounded-xl border border-border/60">
              <button
                onClick={() => setViewMode("comfortable")}
                className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium transition-all cursor-pointer ${
                  viewMode === "comfortable"
                    ? "bg-card text-foreground shadow-xs font-semibold"
                    : "text-muted-foreground hover:text-foreground"
                }`}
                title="Comfortable Grid View"
              >
                <LayoutGrid className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Comfortable</span>
              </button>
              <button
                onClick={() => setViewMode("compact")}
                className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium transition-all cursor-pointer ${
                  viewMode === "compact"
                    ? "bg-card text-foreground shadow-xs font-semibold"
                    : "text-muted-foreground hover:text-foreground"
                }`}
                title="Compact Grid View"
              >
                <Grid3X3 className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Compact</span>
              </button>
              <button
                onClick={() => setViewMode("list")}
                className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium transition-all cursor-pointer ${
                  viewMode === "list"
                    ? "bg-card text-foreground shadow-xs font-semibold"
                    : "text-muted-foreground hover:text-foreground"
                }`}
                title="Table View"
              >
                <List className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">List</span>
              </button>
            </div>
          </div>
        </div>

        {/* Floor Quick-Navigation Pills */}
        {allFloors.length > 1 && (
          <div className="mt-3 flex items-center gap-1.5 overflow-x-auto pb-1.5 text-xs scroll-smooth [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
            <span className="text-muted-foreground font-semibold shrink-0 flex items-center gap-1 pr-1 text-[11px]">
              <Building2 className="h-3.5 w-3.5" /> Floor:
            </span>
            <button
              onClick={() => {
                setSelectedFloor("all");
                setPage(1);
              }}
              className={`px-2.5 py-1 rounded-lg text-xs font-semibold whitespace-nowrap shrink-0 transition-all cursor-pointer ${
                selectedFloor === "all"
                  ? "bg-primary text-primary-foreground shadow-2xs"
                  : "bg-muted/60 text-muted-foreground hover:text-foreground hover:bg-muted"
              }`}
            >
              All Floors ({rooms.length})
            </button>
            {allFloors.map((fl) => {
              const count = rooms.filter((r) => Number(r.floor) === fl).length;
              const isSelected = selectedFloor === fl;
              return (
                <button
                  key={fl}
                  onClick={() => {
                    setSelectedFloor(fl);
                    setPage(1);
                  }}
                  className={`px-2.5 py-1 rounded-lg text-xs font-semibold whitespace-nowrap shrink-0 transition-all cursor-pointer ${
                    isSelected
                      ? "bg-primary text-primary-foreground shadow-2xs"
                      : "bg-muted/60 text-muted-foreground hover:text-foreground hover:bg-muted"
                  }`}
                >
                  F{fl} ({count})
                </button>
              );
            })}
          </div>
        )}

        {/* Legend */}
        <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-2 pt-2 border-t border-border/30">
          {Object.entries(statusConfig).map(([status, config]) => (
            <div key={status} className="flex items-center gap-1.5">
              <div
                className="h-2.5 w-2.5 rounded-full ring-2 ring-background"
                style={{ backgroundColor: config.dotColor }}
              />
              <span className="text-xs text-muted-foreground capitalize">
                {config.label || t(`dashboard.${config.key}`)}
              </span>
            </div>
          ))}
        </div>
      </CardHeader>

      <CardContent className="pt-5">
        {sortedRooms.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border/80 bg-muted/30 py-12 text-center text-muted-foreground">
            <Bed className="mx-auto mb-4 h-12 w-12 opacity-30" />
            <p className="font-semibold text-foreground">{t("dashboard.noRoomsFound")}</p>
            <p className="mt-1 text-sm">{t("dashboard.adjustFilters")}</p>
          </div>
        ) : (
          <div className="space-y-7">
            {floorNumbers.map((floorNum) => {
              const floorRooms = paginatedRooms
                .filter((r) => Number(r.floor) === floorNum)
                .sort((a, b) => {
                  const numCompare = String(a.number).localeCompare(String(b.number), undefined, { numeric: true });
                  if (sortOption === "floor-desc" || sortOption === "room-desc") return -numCompare;
                  if (sortOption === "rate-asc") return (Number(a.rate) || 0) - (Number(b.rate) || 0);
                  if (sortOption === "rate-desc") return (Number(b.rate) || 0) - (Number(a.rate) || 0);
                  return numCompare;
                });

              const vacantCount = floorRooms.filter((r) => String(r.status).toLowerCase() === "vacant").length;
              const occupiedCount = floorRooms.filter((r) => String(r.status).toLowerCase() === "occupied").length;
              const dirtyCount = floorRooms.filter((r) => String(r.status).toLowerCase() === "dirty").length;
              const maintenanceCount = floorRooms.filter((r) => String(r.status).toLowerCase() === "maintenance").length;

              return (
                <div key={floorNum} className="space-y-3.5">
                  {/* Floor Header */}
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1.5 border-b border-border/60 pb-2">
                    <h4 className="text-sm font-bold text-foreground flex items-center gap-2">
                      <span>{t("dashboard.floor", { floor: floorNum })}</span>
                      <Badge variant="secondary" className="text-[11px] font-semibold px-2 py-0.5 rounded-md">
                        {t("dashboard.roomsCount", { count: floorRooms.length })}
                      </Badge>
                    </h4>
                    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      <span className="text-emerald-600 dark:text-emerald-400 font-medium">
                        {vacantCount} {t("dashboard.vacant").toLowerCase()}
                      </span>
                      <span>•</span>
                      <span className="text-blue-600 dark:text-blue-400 font-medium">
                        {occupiedCount} {t("dashboard.occupied").toLowerCase()}
                      </span>
                      {dirtyCount > 0 && (
                        <>
                          <span>•</span>
                          <span className="text-amber-600 dark:text-amber-400 font-medium">
                            {dirtyCount} {t("dashboard.dirty").toLowerCase()}
                          </span>
                        </>
                      )}
                      {maintenanceCount > 0 && (
                        <>
                          <span>•</span>
                          <span className="text-rose-600 dark:text-rose-400 font-medium">
                            {maintenanceCount} out of order
                          </span>
                        </>
                      )}
                    </div>
                  </div>

                  {/* Floor Rooms Display */}
                  {viewMode === "list" ? (
                    <div className="overflow-x-auto rounded-xl border border-border/70 bg-card">
                      <table className="w-full text-left text-xs">
                        <thead className="border-b border-border/60 bg-muted/40 text-muted-foreground font-semibold">
                          <tr>
                            <th className="px-4 py-2.5">Room</th>
                            <th className="px-4 py-2.5">Type</th>
                            <th className="px-4 py-2.5">Floor</th>
                            <th className="px-4 py-2.5">Status</th>
                            <th className="px-4 py-2.5">Rate</th>
                            <th className="px-4 py-2.5">Capacity</th>
                            <th className="px-4 py-2.5 text-right">Action</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-border/40">
                          {floorRooms.map((room) => {
                            const sKey = String(room.status || "vacant").toLowerCase().trim();
                            const config = statusConfig[sKey] || statusConfig.vacant;
                            const TypeIcon = getTypeIcon(room.type);
                            const isOccupied = sKey === "occupied";
                            const isDirty = sKey === "dirty";
                            const isMaintenance = sKey === "maintenance" || sKey === "under_maintenance" || sKey === "out_of_service";
                            const isReadyToBook = !isOccupied && !isDirty && !isMaintenance;
                            return (
                              <tr
                                key={room.id}
                                onClick={() => onRoomClick({ room })}
                                className="hover:bg-muted/50 cursor-pointer transition-colors"
                              >
                                <td className="px-4 py-2.5 font-bold text-foreground">
                                  <div className="flex items-center gap-2">
                                    {(room.image || String(room.type).toLowerCase().includes("deluxe") || String(room.type).toLowerCase().includes("family") || String(room.type).toLowerCase().includes("premium") || String(room.type).toLowerCase().includes("standard") || String(room.type).toLowerCase().includes("suite")) ? (
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
                                        alt={String(room.type)}
                                        className="h-10 w-10 aspect-square rounded-lg object-cover border border-border/80 shrink-0 shadow-2xs"
                                      />
                                    ) : (
                                      <div
                                        className="h-2.5 w-2.5 rounded-full shrink-0"
                                        style={{ backgroundColor: config.dotColor }}
                                      />
                                    )}
                                    <span className="text-sm font-bold">{room.number}</span>
                                  </div>
                                </td>
                                <td className="px-4 py-2.5 text-muted-foreground capitalize">
                                  <div className="flex items-center gap-1.5">
                                    <TypeIcon className="h-3.5 w-3.5 text-muted-foreground/80" />
                                    <span>{room.type}</span>
                                  </div>
                                </td>
                                <td className="px-4 py-2.5 text-muted-foreground font-medium">
                                  Floor {room.floor}
                                </td>
                                <td className="px-4 py-2.5">
                                  <Badge
                                    className="text-[10px] px-2 py-0.5 font-medium border-0 capitalize"
                                    style={{
                                      backgroundColor: `${config.dotColor}18`,
                                      color: config.dotColor,
                                    }}
                                  >
                                    {sKey === "maintenance" ? "Out of Order" : t(`dashboard.${config.key}`)}
                                  </Badge>
                                </td>
                                <td className="px-4 py-2.5 font-semibold text-foreground">
                                  ₹{Number(room.rate).toLocaleString()}
                                </td>
                                <td className="px-4 py-2.5 text-muted-foreground">
                                  <div className="flex items-center gap-1">
                                    <Users className="h-3 w-3" />
                                    <span>{room.capacity}</span>
                                  </div>
                                </td>
                                <td className="px-4 py-2.5 text-right">
                                  <div className="flex items-center justify-end gap-1.5">
                                    {isReadyToBook ? (
                                      <Button
                                        size="sm"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          onRoomClick({ room: { ...room, bookImmediately: true } });
                                        }}
                                        className="h-7 px-2.5 text-xs bg-primary hover:bg-primary/90 text-primary-foreground font-bold rounded-lg shadow-2xs gap-1 cursor-pointer"
                                        title={`Book Room ${room.number} Now`}
                                      >
                                        <Calendar className="h-3 w-3" />
                                        Book
                                      </Button>
                                    ) : isOccupied ? (
                                      <Button
                                        size="sm"
                                        disabled
                                        className="h-7 px-2.5 text-xs bg-slate-100 dark:bg-slate-800/80 text-slate-400 dark:text-slate-500 font-medium rounded-lg border border-slate-200/80 dark:border-slate-700/60 opacity-60 cursor-not-allowed gap-1 select-none"
                                        title={`Room ${room.number} is currently occupied`}
                                      >
                                        <Users className="h-3 w-3 opacity-70" />
                                        Occupied
                                      </Button>
                                    ) : isDirty ? (
                                      <Button
                                        size="sm"
                                        disabled
                                        className="h-7 px-2.5 text-xs bg-amber-50 dark:bg-amber-950/20 text-amber-500/80 dark:text-amber-400/70 font-medium rounded-lg border border-amber-200/60 dark:border-amber-900/40 opacity-60 cursor-not-allowed gap-1 select-none"
                                        title={`Room ${room.number} needs cleaning`}
                                      >
                                        <Sparkles className="h-3 w-3 opacity-70" />
                                        Cleaning
                                      </Button>
                                    ) : (
                                      <Button
                                        size="sm"
                                        disabled
                                        className="h-7 px-2.5 text-xs bg-muted/60 text-muted-foreground/70 font-medium rounded-lg border border-border/50 opacity-60 cursor-not-allowed gap-1 select-none"
                                        title={`Room ${room.number} is out of service`}
                                      >
                                        <Lock className="h-3 w-3 opacity-70" />
                                        Unavailable
                                      </Button>
                                    )}
                                    <Button size="sm" variant="ghost" className="h-7 px-2 text-xs">
                                      <Eye className="h-3.5 w-3.5 mr-1" />
                                      View
                                    </Button>
                                    <Button
                                      size="sm" variant="ghost" className="h-7 w-7 p-0"
                                      onClick={(e) => { e.stopPropagation(); openEditRoom(room); }}
                                    >
                                      <Pencil className="h-3.5 w-3.5" />
                                    </Button>
                                    <Button
                                      size="sm" variant="ghost" className="h-7 w-7 p-0 text-destructive"
                                      onClick={(e) => { e.stopPropagation(); handleDeleteRoom(room); }}
                                    >
                                      <Trash2 className="h-3.5 w-3.5" />
                                    </Button>
                                  </div>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <motion.div
                      variants={container}
                      initial="hidden"
                      whileInView="show"
                      viewport={{ once: true, margin: "-30px" }}
                      className={
                        viewMode === "compact"
                          ? "grid grid-cols-2 min-[420px]:grid-cols-3 sm:grid-cols-4 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-5 min-[1800px]:grid-cols-6 gap-2 sm:gap-2.5"
                          : "grid grid-cols-1 min-[360px]:grid-cols-2 sm:grid-cols-3 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-4 2xl:grid-cols-4 min-[1750px]:grid-cols-5 min-[2100px]:grid-cols-6 gap-3 sm:gap-3.5"
                      }
                    >
                      {floorRooms.map((room) => {
                        const sKey = String(room.status || "vacant").toLowerCase().trim();
                        const config = statusConfig[sKey] || statusConfig.vacant;
                        const roomTypeKey = String(room.type || "").toLowerCase();
                        const TypeIcon = getTypeIcon(room.type);
                        const statusInfo = getStatusSubtext(room.status);
                        const StatusIcon = statusInfo.icon;
                        const isOccupied = sKey === "occupied";
                        const isDirty = sKey === "dirty";
                        const isMaintenance = sKey === "maintenance" || sKey === "under_maintenance" || sKey === "out_of_service";
                        const isReadyToBook = !isOccupied && !isDirty && !isMaintenance;

                        return (
                          <motion.div
                            key={room.id}
                            variants={item}
                            transition={{ duration: 0.2, ease: "easeOut" }}
                            whileHover={{ scale: 1.025, y: -3 }}
                            whileTap={{ scale: 0.98 }}
                            onClick={() => onRoomClick({ room })}
                            draggable
                            onDragStart={(e) => {
                              (e as any).dataTransfer?.setData("text/plain", String(room.id));
                            }}
                            className={`relative rounded-2xl border bg-card/95 dark:bg-slate-900/90 shadow-2xs hover:shadow-md transition-all hover:-translate-y-0.5 ${
                              config.border
                            } group overflow-hidden flex flex-col justify-between cursor-pointer ${
                              viewMode === "compact" ? "p-2.5 min-h-[140px]" : "p-3 sm:p-3.5 min-h-[170px]"
                            }`}
                          >
                            {/* Status dot in top right */}
                            <div
                              className="absolute top-2.5 right-2.5 h-2 w-2 rounded-full ring-2 ring-background shrink-0"
                              style={{ backgroundColor: config.dotColor }}
                            />

                            {/* Edit/Delete & Book actions, shown on hover */}
                            <div className="absolute top-1.5 left-1.5 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity z-10">
                              {isReadyToBook && (
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    onRoomClick({ room: { ...room, bookImmediately: true } });
                                  }}
                                  className="h-6 px-2 flex items-center gap-1 rounded-md bg-primary text-primary-foreground font-bold text-[10px] shadow-xs hover:bg-primary/90 transition-colors cursor-pointer"
                                  title="Book this room"
                                >
                                  <Calendar className="h-2.5 w-2.5" /> Book
                                </button>
                              )}
                              <button
                                onClick={(e) => { e.stopPropagation(); openEditRoom(room); }}
                                className="h-6 w-6 flex items-center justify-center rounded-md bg-background/90 border border-border/60 text-muted-foreground hover:text-foreground cursor-pointer"
                                title="Edit room"
                              >
                                <Pencil className="h-3 w-3" />
                              </button>
                              <button
                                onClick={(e) => { e.stopPropagation(); handleDeleteRoom(room); }}
                                className="h-6 w-6 flex items-center justify-center rounded-md bg-background/90 border border-border/60 text-destructive hover:text-destructive cursor-pointer"
                                title="Delete room"
                              >
                                <Trash2 className="h-3 w-3" />
                              </button>
                            </div>

                            {/* Room number and Type */}
                            <div>
                              <div className="mb-1 flex items-center justify-between pr-4">
                                <span className={`font-bold tracking-tight text-foreground truncate ${
                                  viewMode === "compact" ? "text-sm" : "text-base sm:text-lg"
                                }`}>
                                  {room.number}
                                </span>
                                <TypeIcon
                                  className="h-3.5 w-3.5 shrink-0"
                                  style={{ color: config.dotColor, opacity: 0.8 }}
                                />
                              </div>

                              <div
                                className="mb-2 text-xs font-medium capitalize text-muted-foreground truncate"
                                title={room.type}
                              >
                                {t(`dashboard.${roomTypeKey}`, room.type)}
                              </div>
                            </div>

                            {/* Deluxe, Family, Premium, Standard & Suite Room Square Image */}
                            {(room.image || roomTypeKey.includes("deluxe") || roomTypeKey.includes("family") || roomTypeKey.includes("premium") || roomTypeKey.includes("standard") || roomTypeKey.includes("suite")) && (
                              <div className={`relative w-full aspect-square rounded-xl overflow-hidden mb-2 border border-border/60 group-hover:border-primary/40 transition-colors shrink-0 ${
                                viewMode === "compact" ? "max-h-24 sm:max-h-28" : "max-h-44 sm:max-h-48"
                              }`}>
                                <img
                                  src={
                                    room.image ||
                                    (roomTypeKey.includes("premium")
                                      ? "/rooms/premium.png"
                                      : roomTypeKey.includes("family")
                                      ? "/rooms/family.png"
                                      : roomTypeKey.includes("standard")
                                      ? "/rooms/standard.png"
                                      : roomTypeKey.includes("suite")
                                      ? "/rooms/suite.png"
                                      : "/rooms/deluxe.png")
                                  }
                                  alt={`${roomTypeKey.includes("premium") ? "Premium" : roomTypeKey.includes("family") ? "Family" : roomTypeKey.includes("standard") ? "Standard" : roomTypeKey.includes("suite") ? "Suite" : "Deluxe"} Room`}
                                  className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                                  loading="lazy"
                                />
                                <div className="absolute inset-0 bg-gradient-to-t from-black/50 via-transparent to-transparent" />
                                <span className="absolute bottom-1 right-1.5 px-1.5 py-0.5 rounded bg-black/60 backdrop-blur-xs text-[9px] font-bold text-white uppercase tracking-wider flex items-center gap-1">
                                  <Sparkles className="h-2.5 w-2.5 text-amber-300" /> {roomTypeKey.includes("premium") ? "Premium" : roomTypeKey.includes("family") ? "Family" : roomTypeKey.includes("standard") ? "Standard" : roomTypeKey.includes("suite") ? "Suite" : "Deluxe"}
                                </span>
                              </div>
                            )}

                            {/* Bottom Details */}
                            <div className="space-y-1.5 pt-1.5 border-t border-border/50">
                              <div className="flex items-center justify-between gap-1 min-w-0">
                                <Badge
                                  className="text-[10px] sm:text-[11px] px-1.5 sm:px-2 py-0.5 font-semibold capitalize truncate max-w-[95px] sm:max-w-[110px] border-0"
                                  style={{
                                    backgroundColor: `${config.dotColor}18`,
                                    color: config.dotColor,
                                  }}
                                  title={sKey === "maintenance" ? "Out of Order" : t(`dashboard.${config.key}`)}
                                >
                                  {sKey === "maintenance" ? "Out of Order" : t(`dashboard.${config.key}`)}
                                </Badge>
                                <span className="text-xs sm:text-sm font-extrabold text-foreground shrink-0 tabular-nums whitespace-nowrap ml-auto">
                                  ₹{Number(room.rate).toLocaleString()}
                                </span>
                              </div>

                              <div className="flex items-center justify-between text-[10px] sm:text-[11px] text-muted-foreground min-w-0 pt-0.5">
                                <div className="flex items-center gap-1 shrink-0" title={`Capacity: ${room.capacity} guests`}>
                                  <Users className="h-3 w-3" />
                                  <span>{room.capacity}</span>
                                </div>
                                <div
                                  className="flex items-center gap-1 font-medium truncate min-w-0 ml-1"
                                  style={{ color: config.dotColor }}
                                  title={statusInfo.label}
                                >
                                  <StatusIcon className="h-3 w-3 shrink-0" />
                                  <span className="truncate text-[10px] sm:text-[11px]">{statusInfo.label}</span>
                                </div>
                              </div>

                              {/* Persistent Booking Action: Book Room (Active Vibrant Green) or Occupied (Lighter Muted Button) */}
                              <div className="pt-2 mt-1 border-t border-border/50">
                                {isReadyToBook ? (
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      onRoomClick({ room: { ...room, bookImmediately: true } });
                                    }}
                                    className="w-full py-1.5 px-2.5 rounded-xl bg-primary hover:bg-primary/90 active:bg-primary/95 text-primary-foreground font-bold text-xs flex items-center justify-center gap-1.5 shadow-xs hover:shadow-sm transition-all cursor-pointer group/btn"
                                    title={`Book Room ${room.number} Now`}
                                  >
                                    <Calendar className="h-3.5 w-3.5 transition-transform group-hover/btn:scale-110" />
                                    <span>Book Room</span>
                                    <ArrowRight className="h-3 w-3 ml-auto transition-transform group-hover/btn:translate-x-0.5 opacity-80" />
                                  </button>
                                ) : isOccupied ? (
                                  <button
                                    type="button"
                                    disabled
                                    className="w-full py-1.5 px-2.5 rounded-xl bg-slate-100/90 dark:bg-slate-800/60 text-slate-400 dark:text-slate-500 border border-slate-200/70 dark:border-slate-700/50 font-medium text-xs flex items-center justify-center gap-1.5 cursor-not-allowed opacity-60 select-none"
                                    title={`Room ${room.number} is currently occupied`}
                                  >
                                    <Users className="h-3.5 w-3.5 opacity-70 shrink-0" />
                                    <span>Occupied</span>
                                    <span className="ml-auto text-[10px] font-normal uppercase tracking-wider opacity-60">Unavailable</span>
                                  </button>
                                ) : isDirty ? (
                                  <button
                                    type="button"
                                    disabled
                                    className="w-full py-1.5 px-2.5 rounded-xl bg-amber-50/90 dark:bg-amber-950/20 text-amber-500/80 dark:text-amber-400/70 border border-amber-200/60 dark:border-amber-900/40 font-medium text-xs flex items-center justify-center gap-1.5 cursor-not-allowed opacity-60 select-none"
                                    title={`Room ${room.number} needs cleaning before booking`}
                                  >
                                    <Sparkles className="h-3.5 w-3.5 opacity-70 shrink-0" />
                                    <span>Needs Cleaning</span>
                                  </button>
                                ) : (
                                  <button
                                    type="button"
                                    disabled
                                    className="w-full py-1.5 px-2.5 rounded-xl bg-muted/60 text-muted-foreground/70 border border-border/50 font-medium text-xs flex items-center justify-center gap-1.5 cursor-not-allowed opacity-60 select-none"
                                    title={`Room ${room.number} is out of service`}
                                  >
                                    <Lock className="h-3.5 w-3.5 opacity-70 shrink-0" />
                                    <span>Out of Service</span>
                                  </button>
                                )}
                              </div>
                            </div>
                          </motion.div>
                        );
                      })}
                    </motion.div>
                  )}
                </div>
              );
            })}

            {/* Pagination Controls via DataTablePagination */}
            <DataTablePagination
              currentPage={page}
              totalPages={totalPages}
              totalItems={sortedRooms.length}
              pageSize={pageSize}
              onPageChange={setPage}
              onPageSizeChange={setPageSize}
              pageSizeOptions={[10, 20, 30, 50, 0]}
              itemName="rooms"
            />
          </div>
        )}
      </CardContent>
    </Card>

    <Dialog open={roomDialogOpen} onOpenChange={setRoomDialogOpen}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="text-2xl font-bold">
            {editingRoom ? `Edit Room ${editingRoom.number}` : "Add Room"}
          </DialogTitle>
        </DialogHeader>
        <Form {...roomForm}>
          <form onSubmit={roomForm.handleSubmit(handleRoomFormSubmit)} className="space-y-4 pt-2">
            {!editingRoom && (
              <div className="grid grid-cols-2 gap-4">
                <FormItem>
                  <FormLabel className="font-semibold">Room Number *</FormLabel>
                  <FormControl>
                    <Input placeholder="e.g. 103" {...roomForm.register("number")} />
                  </FormControl>
                </FormItem>
                <FormItem>
                  <FormLabel className="font-semibold">Room Type</FormLabel>
                  <FormControl>
                    <Input placeholder="e.g. Standard Queen" {...roomForm.register("type")} />
                  </FormControl>
                </FormItem>
              </div>
            )}
            <div className="grid grid-cols-2 gap-4">
              <FormItem>
                <FormLabel className="font-semibold">Floor</FormLabel>
                <FormControl>
                  <Input type="number" min={0} {...roomForm.register("floor")} />
                </FormControl>
              </FormItem>
              <FormItem>
                <FormLabel className="font-semibold">Rate (₹/night)</FormLabel>
                <FormControl>
                  <Input type="number" min={0} {...roomForm.register("rate")} />
                </FormControl>
              </FormItem>
            </div>
            {!editingRoom && (
              <FormItem>
                <FormLabel className="font-semibold">Capacity (guests)</FormLabel>
                <FormControl>
                  <Input type="number" min={1} {...roomForm.register("capacity")} />
                </FormControl>
              </FormItem>
            )}
            {editingRoom && (
              <FormItem>
                <FormLabel className="font-semibold">Status</FormLabel>
                <FormControl>
                  <Select value={roomForm.watch("status")} onValueChange={(v) => roomForm.setValue("status", v)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="vacant">Vacant</SelectItem>
                      <SelectItem value="dirty">Dirty</SelectItem>
                      <SelectItem value="maintenance">Out of Order / Maintenance</SelectItem>
                    </SelectContent>
                  </Select>
                </FormControl>
              </FormItem>
            )}
            <div className="flex gap-3 justify-end pt-4">
              <Button type="button" variant="outline" className="h-11 rounded-2xl px-6" onClick={() => setRoomDialogOpen(false)}>
                Cancel
              </Button>
              <Button
                type="submit"
                className="h-11 rounded-2xl bg-primary hover:bg-primary/90 text-primary-foreground font-semibold px-6 cursor-pointer"
                disabled={createRoomM.isPending || updateRoomM.isPending}
              >
                {createRoomM.isPending || updateRoomM.isPending ? "Saving..." : editingRoom ? "Save Changes" : "Create Room"}
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
    </>
  );
}
