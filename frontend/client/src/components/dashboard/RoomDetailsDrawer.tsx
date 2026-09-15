import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerDescription,
  DrawerFooter,
  DrawerClose,
} from "@/components/ui/drawer";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Input } from "@/components/ui/input";
import {
  Bed,
  User,
  Calendar,
  X,
  Wifi,
  Users,
  Bath,
  Tv,
  CheckCircle2,
  Sparkles,
  Lock,
  ArrowRightLeft,
} from "lucide-react";
import { useStore } from "@/lib/store";
import { useLocation } from "wouter";
import { apiClient } from "@/lib/api";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import type { Room, Guest, Reservation } from "@/lib/store";

interface RoomDetailsDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  room: Room | null;
  guest: Guest | null;
  reservation: Reservation | null;
}

const statusColors: Record<string, string> = {
  vacant: "bg-emerald-500",
  clean: "bg-emerald-500",
  ready: "bg-emerald-500",
  available: "bg-emerald-500",
  inspected: "bg-teal-500",
  occupied: "bg-blue-500",
  dirty: "bg-amber-500",
  maintenance: "bg-red-500",
  under_maintenance: "bg-red-500",
  out_of_service: "bg-red-500",
  reserved: "bg-purple-500",
};

export default function RoomDetailsDrawer({ isOpen, onClose, room, guest, reservation }: RoomDetailsDrawerProps) {
  const { t } = useTranslation();
  const { updateRoomStatus } = useStore();
  const qc = useQueryClient();
  const [, setLocation] = useLocation();

  const [activeStep, setActiveStep] = useState<"IDLE" | "BOOKING">("IDLE");
  const [guestName, setGuestName] = useState("");
  const [guestPhone, setGuestPhone] = useState("");
  const [guestEmail, setGuestEmail] = useState("");
  const [checkInDate, setCheckInDate] = useState(new Date().toISOString().split("T")[0]);
  const [nights, setNights] = useState("1");
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (isOpen) {
      if (room?.bookImmediately) {
        setActiveStep("BOOKING");
      } else {
        setActiveStep("IDLE");
      }
    } else {
      setActiveStep("IDLE");
      setGuestName("");
      setGuestPhone("");
      setGuestEmail("");
    }
  }, [isOpen, room]);

  const handleBookRoom = async () => {
    if (!room) return;
    if (!guestName.trim()) {
      toast.error("Validation Error: Please enter guest full name");
      return;
    }
    const cleanPhone = guestPhone.replace(/\D/g, "");
    if (!cleanPhone) {
      toast.error("Validation Error: Phone number is required");
      return;
    }
    if (cleanPhone.length !== 10) {
      toast.error("Validation Error: Phone number must be exactly 10 digits");
      return;
    }

    setIsSubmitting(true);
    try {
      const [firstName, ...rest] = guestName.trim().split(" ");
      const lastName = rest.join(" ") || "Guest";

      const guestRes = await apiClient.guests.create({
        firstName,
        lastName,
        phone: guestPhone || undefined,
        email: guestEmail || undefined,
      });
      const newGuestId = guestRes.data?.id;

      const checkIn = new Date(checkInDate);
      const checkOut = new Date(checkIn);
      checkOut.setDate(checkOut.getDate() + (parseInt(nights, 10) || 1));
      const totalCharges = (room.rate || 0) * (parseInt(nights, 10) || 1);

      await apiClient.reservations.create({
        guestId: newGuestId,
        firstName,
        lastName,
        phone: guestPhone || undefined,
        email: guestEmail || undefined,
        roomId: room.id,
        checkIn: checkIn.toISOString(),
        checkOut: checkOut.toISOString(),
        status: "confirmed",
        totalCharges,
        paidAmount: 0,
        source: "Direct",
        notes: `Direct room booking from Dashboard Drawer`,
      });

      updateRoomStatus(room.id, "occupied");
      qc.invalidateQueries({ queryKey: ["rooms"] });
      qc.invalidateQueries({ queryKey: ["reservations"] });
      qc.invalidateQueries({ queryKey: ["guests"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });

      toast.success(`Room ${room.number} booked successfully!`);
      onClose();
    } catch (err: any) {
      toast.error(err?.response?.data?.error || "Failed to book room");
    } finally {
      setIsSubmitting(false);
    }
  };

  const st = String(room?.status || "vacant").toLowerCase().trim();
  const isOccupied = st === "occupied";
  const isDirty = st === "dirty";
  const isMaintenance = st === "maintenance" || st === "under_maintenance" || st === "out_of_service";
  const isReadyToBook = !isOccupied && !isDirty && !isMaintenance;

  const amenities = [
    { icon: Wifi, label: "WiFi" },
    { icon: Tv, label: "Smart TV" },
    { icon: Bath, label: "Attached Bath" },
    { icon: Users, label: t("roomDrawer.guestsCount", { count: room?.capacity || 2 }) },
  ];

  return (
    <Drawer open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DrawerContent className="max-h-[92vh] max-w-4xl mx-auto rounded-t-3xl border-x border-t border-border/80 shadow-2xl bg-card">
        <div className="max-w-4xl w-full mx-auto flex flex-col h-full overflow-hidden">
          {/* Header */}
          <DrawerHeader className="pb-3 px-4 sm:px-6">
            <div className="flex items-start sm:items-center justify-between gap-3">
              <div className="min-w-0">
                <DrawerTitle className="text-xl sm:text-2xl font-black flex items-center gap-2 text-foreground tracking-tight">
                  {t("roomDrawer.roomNumber", { number: room?.number })}
                </DrawerTitle>
                <DrawerDescription className="text-xs sm:text-sm text-muted-foreground font-medium mt-0.5">
                  {room?.type ? room.type.charAt(0).toUpperCase() + room.type.slice(1) : "Standard"} · {t("dashboard.floor", { floor: room?.floor })}
                </DrawerDescription>
              </div>
              <DrawerClose asChild>
                <Button variant="ghost" size="icon" className="h-8 w-8 rounded-full shrink-0">
                  <X className="h-4 w-4" />
                </Button>
              </DrawerClose>
            </div>

            {room && (
              <div className="flex flex-wrap items-center gap-2.5 sm:gap-3 mt-2.5">
                <div className="flex items-center gap-1.5 bg-accent/70 px-2.5 py-1 rounded-full border border-border/70 shadow-2xs">
                  <div className={`h-2.5 w-2.5 rounded-full shrink-0 ${statusColors[st] || "bg-emerald-500"}`} />
                  <span className="text-xs font-bold capitalize text-foreground">
                    {t(`dashboard.${st}`, room.status)}
                  </span>
                </div>
                <span className="text-sm font-extrabold text-foreground tabular-nums">
                  ₹{Number(room.rate).toLocaleString()}<span className="text-xs font-normal text-muted-foreground">{t("roomDrawer.perNight")}</span>
                </span>
                {isReadyToBook && (
                  <Badge variant="outline" className="bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/30 text-[10px] font-bold uppercase tracking-wider flex items-center gap-1">
                    <Sparkles className="h-3 w-3 text-emerald-500" /> Ready to Book
                  </Badge>
                )}
              </div>
            )}
          </DrawerHeader>

          <Separator />

          {/* Scrollable Body: Responsive 2-column grid */}
          <ScrollArea className="flex-1 px-4 sm:px-6 py-4">
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 sm:gap-6 items-start">
              {/* Left Column (5 cols): Photo & Status Notice */}
              <div className="lg:col-span-5 space-y-4">
                {(room?.image || (room?.type && (
                  String(room.type).toLowerCase().includes("deluxe") ||
                  String(room.type).toLowerCase().includes("family") ||
                  String(room.type).toLowerCase().includes("premium") ||
                  String(room.type).toLowerCase().includes("standard") ||
                  String(room.type).toLowerCase().includes("suite")
                ))) && (
                  <div className="relative aspect-square w-full rounded-2xl overflow-hidden border border-border/80 shadow-md group">
                    <img
                      src={
                        room?.image ||
                        (String(room?.type).toLowerCase().includes("premium")
                          ? "/rooms/premium.png"
                          : String(room?.type).toLowerCase().includes("family")
                          ? "/rooms/family.png"
                          : String(room?.type).toLowerCase().includes("standard")
                          ? "/rooms/standard.png"
                          : String(room?.type).toLowerCase().includes("suite")
                          ? "/rooms/suite.png"
                          : "/rooms/deluxe.png")
                      }
                      alt={`${room?.type || "Room"} Photo`}
                      className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/20 to-transparent" />
                    <div className="absolute bottom-3 left-3 right-3 flex items-center justify-between text-white">
                      <div className="flex items-center gap-1.5 bg-black/50 backdrop-blur-md px-3 py-1 rounded-full text-xs font-bold border border-white/20 shadow-xs">
                        <Sparkles className="h-3.5 w-3.5 text-amber-400" />
                        <span className="capitalize">{room?.type || "Room"} Photo</span>
                      </div>
                      <span className="text-xs font-bold bg-primary text-primary-foreground px-3 py-1 rounded-full shadow-xs">
                        ₹{room?.rate}{t("roomDrawer.perNight")}
                      </span>
                    </div>
                  </div>
                )}

                {/* Status Notices */}
                {isOccupied && (
                  <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50/90 dark:bg-slate-900/50 p-4 text-slate-700 dark:text-slate-300 shadow-xs space-y-1.5">
                    <div className="flex items-center gap-2 font-bold text-sm text-slate-800 dark:text-slate-200">
                      <Users className="h-4 w-4 text-slate-500 shrink-0" />
                      Room is Currently Occupied
                    </div>
                    <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
                      An active reservation is registered for this room. Room cannot be booked until checkout and cleaning are completed.
                    </p>
                  </div>
                )}

                {isDirty && (
                  <div className="rounded-2xl border border-amber-300 bg-amber-50 dark:bg-amber-950/40 p-4 text-amber-900 dark:text-amber-200 shadow-xs space-y-2">
                    <div className="flex items-start gap-3">
                      <img
                        src="/housekeeping_square.png"
                        alt="Housekeeping Staff"
                        className="h-12 w-12 aspect-square rounded-xl object-cover border border-amber-300/80 shadow-2xs shrink-0"
                      />
                      <div className="space-y-0.5 min-w-0 flex-1">
                        <div className="flex items-center gap-2 font-bold text-sm text-amber-800 dark:text-amber-300">
                          <Sparkles className="h-4 w-4 text-amber-600 shrink-0" />
                          {t("roomDrawer.dirtyNoticeTitle")}
                        </div>
                        <p className="text-xs font-medium text-amber-700 dark:text-amber-400">
                          {t("roomDrawer.dirtyNoticeBody")}
                        </p>
                      </div>
                    </div>
                  </div>
                )}

                {isMaintenance && (
                  <div className="rounded-2xl border border-red-300 bg-red-50 dark:bg-red-950/40 p-4 text-red-900 dark:text-red-200 shadow-xs space-y-1.5">
                    <div className="flex items-center gap-2 font-bold text-sm text-red-800 dark:text-red-300">
                      <Lock className="h-4 w-4 text-red-600 shrink-0" />
                      {t("roomDrawer.maintenanceNoticeTitle")}
                    </div>
                    <p className="text-xs font-medium text-red-700 dark:text-red-400">
                      {t("roomDrawer.maintenanceNoticeBody")}
                    </p>
                  </div>
                )}

                {isReadyToBook && (
                  <div className="rounded-2xl border border-emerald-500/30 bg-emerald-50/70 dark:bg-emerald-950/30 p-4 text-emerald-900 dark:text-emerald-200 shadow-xs space-y-1.5">
                    <div className="flex items-center gap-2 font-bold text-sm text-emerald-800 dark:text-emerald-300">
                      <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
                      Clean & Prepared
                    </div>
                    <p className="text-xs font-medium text-emerald-700 dark:text-emerald-400">
                      Housekeeping has marked this room as clean and ready for immediate guest arrival.
                    </p>
                  </div>
                )}
              </div>

              {/* Right Column (7 cols): Specs & Booking form */}
              <div className="lg:col-span-7 space-y-4">
                {/* Ready to Book Banner in Right Column */}
                {isReadyToBook && activeStep === "IDLE" && (
                  <div className="p-4 rounded-2xl border border-emerald-500/30 bg-gradient-to-r from-emerald-500/15 via-teal-500/10 to-transparent flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 shadow-xs">
                    <div>
                      <h4 className="text-sm font-bold text-emerald-900 dark:text-emerald-200 flex items-center gap-1.5">
                        <Sparkles className="h-4 w-4 text-emerald-600" />
                        Ready for Guest Booking
                      </h4>
                      <p className="text-xs text-emerald-700 dark:text-emerald-400 mt-0.5">
                        Clean and vacant. Click to book this room directly.
                      </p>
                    </div>
                    <Button
                      onClick={() => setActiveStep("BOOKING")}
                      className="rounded-xl font-bold text-xs bg-primary hover:bg-primary/90 text-primary-foreground gap-1.5 shadow-sm shadow-primary/20 cursor-pointer shrink-0 w-full sm:w-auto"
                    >
                      <Calendar className="h-3.5 w-3.5" />
                      {t("roomDrawer.bookThisRoom", "Book This Room")}
                    </Button>
                  </div>
                )}

                {/* Occupied Notice in Right Column */}
                {isOccupied && activeStep === "IDLE" && (
                  <div className="p-4 rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-100/70 dark:bg-slate-900/50 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 shadow-xs">
                    <div>
                      <h4 className="text-sm font-bold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                        <Users className="h-4 w-4 text-slate-500" />
                        Room is Occupied
                      </h4>
                      <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                        Currently checked in with active guest reservation. Direct booking locked.
                      </p>
                    </div>
                    <Button
                      disabled
                      className="rounded-xl font-medium text-xs bg-slate-200/80 dark:bg-slate-800 text-slate-500 dark:text-slate-400 border border-slate-300/60 dark:border-slate-700 gap-1.5 opacity-70 cursor-not-allowed shrink-0 w-full sm:w-auto"
                    >
                      <Users className="h-3.5 w-3.5" />
                      Occupied
                    </Button>
                  </div>
                )}

                {/* BOOKING FORM VIEW */}
                {activeStep === "BOOKING" && isReadyToBook ? (
                  <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
                    <div className="flex items-center justify-between rounded-xl bg-sky-50 dark:bg-sky-950/40 border border-sky-200 dark:border-sky-800 p-3.5">
                      <div className="flex items-center gap-2 text-sky-800 dark:text-sky-300 text-sm font-bold">
                        <Calendar className="h-5 w-5 text-sky-600 dark:text-sky-400" /> {t("roomDrawer.bookRoomTitle", { number: room?.number })}
                      </div>
                      <Badge variant="outline" className="bg-white dark:bg-slate-900 text-sky-700 dark:text-sky-300 font-semibold text-xs">{t("roomDrawer.directReservation")}</Badge>
                    </div>

                    <div className="space-y-3.5">
                      <div>
                        <label className="text-xs font-semibold text-foreground mb-1 block">{t("roomDrawer.guestFullName")} *</label>
                        <Input
                          placeholder="e.g. John Doe"
                          value={guestName}
                          onChange={(e) => setGuestName(e.target.value)}
                          className="rounded-xl"
                        />
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div>
                          <label className="text-xs font-semibold text-foreground mb-1 block">{t("roomDrawer.phone10Digits")} *</label>
                          <Input
                            placeholder="e.g. 9876543210"
                            maxLength={10}
                            value={guestPhone}
                            onChange={(e) => setGuestPhone(e.target.value.replace(/\D/g, "").slice(0, 10))}
                            className="rounded-xl"
                          />
                        </div>
                        <div>
                          <label className="text-xs font-semibold text-foreground mb-1 block">{t("roomDrawer.emailAddress")}</label>
                          <Input
                            placeholder="john@example.com"
                            value={guestEmail}
                            onChange={(e) => setGuestEmail(e.target.value)}
                            className="rounded-xl"
                          />
                        </div>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div>
                          <label className="text-xs font-semibold text-foreground mb-1 block">{t("roomDrawer.checkInDate")}</label>
                          <Input
                            type="date"
                            value={checkInDate}
                            onChange={(e) => setCheckInDate(e.target.value)}
                            className="rounded-xl"
                          />
                        </div>
                        <div>
                          <label className="text-xs font-semibold text-foreground mb-1 block">{t("roomDrawer.numberOfNights")}</label>
                          <Input
                            type="number"
                            min="1"
                            value={nights}
                            onChange={(e) => setNights(e.target.value)}
                            className="rounded-xl"
                          />
                        </div>
                      </div>

                      <div className="p-3.5 rounded-xl bg-accent/60 border border-border/80 text-xs space-y-1.5">
                        <div className="flex justify-between text-muted-foreground">
                          <span>{t("roomDrawer.ratePerNight")}</span>
                          <span className="font-semibold text-foreground">₹{room?.rate}</span>
                        </div>
                        <div className="flex justify-between text-foreground font-bold border-t border-border pt-1.5 mt-1">
                          <span>{t("roomDrawer.totalCharges")}</span>
                          <span className="text-base font-extrabold text-primary">₹{(room?.rate || 0) * (parseInt(nights, 10) || 1)}</span>
                        </div>
                      </div>

                      <div className="flex gap-2.5 pt-1">
                        <Button
                          variant="outline"
                          onClick={() => setActiveStep("IDLE")}
                          className="rounded-xl px-4 text-xs font-bold cursor-pointer"
                        >
                          Cancel
                        </Button>
                        <Button
                          onClick={handleBookRoom}
                          disabled={isSubmitting}
                          className="flex-1 rounded-xl bg-primary hover:bg-primary/90 text-primary-foreground font-bold gap-2 shadow-sm shadow-primary/25 cursor-pointer"
                        >
                          <CheckCircle2 className="h-4 w-4" /> {isSubmitting ? "Booking..." : t("roomDrawer.confirmAndBook")}
                        </Button>
                      </div>
                    </div>
                  </motion.div>
                ) : (
                  /* DEFAULT ROOM OVERVIEW VIEW */
                  <div className="space-y-4">
                    <div>
                      <h3 className="text-sm font-bold mb-3 flex items-center gap-2 text-foreground">
                        <Bed className="h-4 w-4 text-primary" />
                        {t("roomDrawer.roomOverview")}
                      </h3>
                      <div className="grid grid-cols-2 gap-3">
                        <div className="p-3.5 rounded-xl bg-card border border-border/70 shadow-2xs">
                          <p className="text-[11px] font-semibold text-muted-foreground">{t("roomDrawer.type")}</p>
                          <p className="text-sm font-bold capitalize text-foreground mt-0.5">{room?.type}</p>
                        </div>
                        <div className="p-3.5 rounded-xl bg-card border border-border/70 shadow-2xs">
                          <p className="text-[11px] font-semibold text-muted-foreground">{t("roomDrawer.floor")}</p>
                          <p className="text-sm font-bold text-foreground mt-0.5">{t("dashboard.floor", { floor: room?.floor })}</p>
                        </div>
                        <div className="p-3.5 rounded-xl bg-card border border-border/70 shadow-2xs">
                          <p className="text-[11px] font-semibold text-muted-foreground">{t("roomDrawer.capacity")}</p>
                          <p className="text-sm font-bold text-foreground mt-0.5">{t("roomDrawer.guestsCount", { count: room?.capacity || 2 })}</p>
                        </div>
                        <div className="p-3.5 rounded-xl bg-card border border-border/70 shadow-2xs">
                          <p className="text-[11px] font-semibold text-muted-foreground">{t("roomDrawer.rate")}</p>
                          <p className="text-sm font-extrabold text-foreground mt-0.5">₹{room?.rate}<span className="text-xs font-normal text-muted-foreground">{t("roomDrawer.perNight")}</span></p>
                        </div>
                      </div>

                      <div className="flex flex-wrap gap-2 mt-3.5 pt-3 border-t border-border/50">
                        {amenities.map((a, i) => (
                          <div key={i} className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground bg-accent/50 px-2.5 py-1 rounded-lg border border-border/50">
                            <a.icon className="h-3.5 w-3.5 text-foreground/70" />
                            <span>{a.label}</span>
                          </div>
                        ))}
                      </div>
                    </div>

                    {guest && (
                      <div className="pt-3 border-t border-border/60">
                        <h3 className="text-sm font-bold mb-3 flex items-center gap-2 text-foreground">
                          <User className="h-4 w-4 text-emerald-600" />
                          {t("roomDrawer.guestProfile")}
                        </h3>
                        <div className="flex items-center gap-3 p-3.5 rounded-xl bg-card border border-border/70 shadow-2xs">
                          <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                            <User className="h-5 w-5 text-primary" />
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-bold text-foreground truncate">{guest.firstName} {guest.lastName}</p>
                            <p className="text-xs text-muted-foreground truncate mt-0.5">{guest.email || "No email"} · {guest.phone || "No phone"}</p>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </ScrollArea>

          <Separator />

          {/* Footer */}
          <DrawerFooter className="pt-3 pb-4 px-4 sm:px-6">
            {activeStep === "IDLE" ? (
              <div className="flex flex-col-reverse sm:flex-row items-stretch sm:items-center justify-between gap-2.5 sm:gap-3 w-full">
                <Button variant="outline" onClick={onClose} className="w-full sm:w-auto px-5 rounded-xl font-semibold cursor-pointer">
                  {t("common.close")}
                </Button>

                <div className="flex items-center gap-2.5 w-full sm:w-auto">
                  {isReadyToBook && (
                    <Button
                      onClick={() => setActiveStep("BOOKING")}
                      className="flex-1 sm:flex-none px-6 flex items-center justify-center gap-2 bg-primary hover:bg-primary/90 text-primary-foreground py-2.5 font-bold text-sm rounded-xl shadow-md shadow-primary/20 cursor-pointer"
                    >
                      <Calendar className="h-4 w-4" /> {t("roomDrawer.bookThisRoom", "Book This Room")}
                    </Button>
                  )}

                  {isOccupied && (
                    <div className="flex items-center gap-2 w-full sm:w-auto">
                      <Button
                        disabled
                        className="flex-1 sm:flex-none px-4 flex items-center justify-center gap-1.5 bg-slate-100 dark:bg-slate-800 text-slate-400 dark:text-slate-500 border border-slate-200/80 dark:border-slate-700/60 py-2.5 font-medium text-sm rounded-xl opacity-60 cursor-not-allowed select-none"
                        title="Room is currently occupied and cannot be booked"
                      >
                        <Users className="h-4 w-4 opacity-70" /> Occupied
                      </Button>
                      <Button
                        onClick={async () => {
                          if (!room) return;
                          setIsSubmitting(true);
                          try {
                            if (reservation) {
                              await apiClient.reservations.update(String(reservation.id), { status: "checked_out" });
                            }
                            await apiClient.rooms.update(String(room.id), { status: "dirty", isAvailable: true });
                            
                            // Auto-create housekeeping task
                            await apiClient.housekeeping.create({
                              roomId: room.id,
                              status: "pending",
                              assignedTo: "Maria Rodriguez",
                              notes: "Guest Checked Out - Express Checkout",
                            }).catch(() => {});

                            // Emit live notification
                            await apiClient.notifications.create({
                              type: "housekeeping",
                              title: "Guest Checked Out",
                              message: `Room #${room.number} checked out. Room added to Housekeeping list for turnaround cleaning.`,
                            }).catch(() => {});

                            updateRoomStatus(room.id, "dirty");
                            qc.invalidateQueries({ queryKey: ["rooms"] });
                            qc.invalidateQueries({ queryKey: ["reservations"] });
                            qc.invalidateQueries({ queryKey: ["housekeeping"] });
                            qc.invalidateQueries({ queryKey: ["notifications"] });
                            qc.invalidateQueries({ queryKey: ["dashboard"] });
                            toast.success(`Check-out complete! Room ${room.number} is now marked as Dirty and sent to Housekeeping.`);
                            onClose();
                          } catch (err: any) {
                            toast.error("Failed to check out");
                          } finally {
                            setIsSubmitting(false);
                          }
                        }}
                        className="flex-1 sm:flex-none px-5 bg-amber-600 hover:bg-amber-700 text-white font-bold rounded-xl shadow-md py-2.5 cursor-pointer"
                      >
                        <ArrowRightLeft className="h-4 w-4" /> {t("roomDrawer.checkOutGuest")}
                      </Button>
                    </div>
                  )}

                  {isDirty && (
                    <Button
                      disabled
                      className="flex-1 sm:flex-none px-5 flex items-center justify-center gap-1.5 bg-amber-50 dark:bg-amber-950/20 text-amber-500/80 dark:text-amber-400/70 border border-amber-200/60 dark:border-amber-900/40 py-2.5 font-medium text-sm rounded-xl opacity-60 cursor-not-allowed select-none"
                    >
                      <Sparkles className="h-4 w-4 opacity-70" /> Needs Cleaning
                    </Button>
                  )}

                  {isMaintenance && (
                    <Button
                      disabled
                      className="flex-1 sm:flex-none px-5 flex items-center justify-center gap-1.5 bg-muted/60 text-muted-foreground/70 border border-border/50 py-2.5 font-medium text-sm rounded-xl opacity-60 cursor-not-allowed select-none"
                    >
                      <Lock className="h-4 w-4 opacity-70" /> Maintenance
                    </Button>
                  )}
                </div>
              </div>
            ) : (
              <Button variant="ghost" onClick={() => setActiveStep("IDLE")} className="w-full text-slate-500 font-semibold cursor-pointer">
                {t("roomDrawer.cancelReturn", "Back to Room Details")}
              </Button>
            )}
          </DrawerFooter>
        </div>
      </DrawerContent>
    </Drawer>
  );
}
