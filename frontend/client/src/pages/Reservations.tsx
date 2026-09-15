import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@/lib/api";
import { validateGuestInput } from "@/lib/validation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Form, FormItem, FormLabel, FormControl } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { CalendarDays, Plus, Search, LogIn, LogOut, Trash2, Edit, Ban, CheckCircle2, XCircle, AlertCircle } from "lucide-react";
import { useAuthContext } from "@/contexts/AuthContext";

import { useTranslation } from "react-i18next";

function normalizeList(data: any) {
  if (Array.isArray(data)) return { items: data, total: data.length };
  if (data?.items) return data;
  return { items: [], total: 0 };
}
const COUNTRY_CODES = [
  { code: "IN", name: "India", flag: "🇮🇳", dialCode: "+91", digitsLength: 10, placeholder: "9876543210" },
  { code: "US", name: "United States", flag: "🇺🇸", dialCode: "+1", digitsLength: 10, placeholder: "2025550143" },
  { code: "GB", name: "United Kingdom", flag: "🇬🇧", dialCode: "+44", digitsLength: 10, placeholder: "7911123456" },
  { code: "CA", name: "Canada", flag: "🇨🇦", dialCode: "+1", digitsLength: 10, placeholder: "4165550123" },
  { code: "AU", name: "Australia", flag: "🇦🇺", dialCode: "+61", digitsLength: 9, placeholder: "412345678" },
  { code: "AE", name: "UAE", flag: "🇦🇪", dialCode: "+971", digitsLength: 9, placeholder: "501234567" },
  { code: "SG", name: "Singapore", flag: "🇸🇬", dialCode: "+65", digitsLength: 8, placeholder: "81234567" },
  { code: "DE", name: "Germany", flag: "🇩🇪", dialCode: "+49", digitsLength: 11, placeholder: "15123456789" },
];
const STATUS_COLORS: Record<string, string> = {
  confirmed: "bg-[#F3EDE4] text-[#8B6748]",
  checked_in: "bg-green-100 text-green-700",
  checked_out: "bg-slate-100 text-slate-600",
  cancelled: "bg-red-100 text-red-600",
  no_show: "bg-amber-100 text-amber-700",
};

const getRoomUnavailabilityReason = (room: any): string | null => {
  if (!room) return null;
  const status = String(room.status || "").toLowerCase();
  if (status === "reserved") return "already reserved";
  if (status === "dirty") return "dirty";
  if (status === "maintenance" || status === "under_maintenance" || status === "out_of_service") return "under maintenance";
  if (status === "occupied") return "occupied";
  if (room.isAvailable === false || room.availability === false) return "unavailable";
  return null;
};


import { DataTablePagination } from "@/components/ui/DataTablePagination";

export default function ReservationsPage() {
  const { t } = useTranslation();
  const { hasPermission, currentRole } = useAuthContext();
  const [cancelingReservation, setCancelingReservation] = useState<any | null>(null);
  const [cancelReason, setCancelReason] = useState("");
  const [cancelSubmitting, setCancelSubmitting] = useState(false);

  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [selectedCountry, setSelectedCountry] = useState(COUNTRY_CODES[0]);
  const qc = useQueryClient();
  const [editing, setEditing] = useState<any | null>(null);

  const reservationsQ = useQuery({
    queryKey: ["reservations", page, pageSize, search],
    queryFn: async () => {
      const { data } = await apiClient.reservations.list({ page, limit: pageSize === 0 ? 1000 : pageSize, q: search });
      return normalizeList(data);
    },
  });

  const roomsQ = useQuery({
    queryKey: ["rooms-list"],
    queryFn: async () => {
      const { data } = await apiClient.rooms.list({ limit: 250 });
      const items = normalizeList(data).items;
      return items.sort((a: any, b: any) => (parseInt(a.number || a.room_number, 10) || 0) - (parseInt(b.number || b.room_number, 10) || 0));
    },
  });

  const form = useForm({
    defaultValues: {
      guestId: "",
      firstName: "",
      lastName: "",
      email: "",
      phone: "",
      roomId: "",
      checkIn: "",
      checkOut: "",
      status: "confirmed",
      totalCharges: 0,
      paidAmount: 0,
      source: "Direct",
      notes: "",
    },
  });

  const watchCheckIn = form.watch("checkIn");
  const watchCheckOut = form.watch("checkOut");
  const watchRoomId = form.watch("roomId");

  useEffect(() => {
    if (watchCheckIn && watchCheckOut && watchRoomId) {
      const ci = new Date(watchCheckIn);
      const co = new Date(watchCheckOut);
      if (!isNaN(ci.getTime()) && !isNaN(co.getTime()) && co > ci) {
        const diffDays = Math.ceil((co.getTime() - ci.getTime()) / (1000 * 3600 * 24));
        const selectedRoom = (roomsQ.data ?? []).find((r: any) => String(r.id) === String(watchRoomId));
        if (selectedRoom && selectedRoom.rate) {
          const calculated = diffDays * Number(selectedRoom.rate);
          form.setValue("totalCharges", calculated);
        }
      }
    }
  }, [watchCheckIn, watchCheckOut, watchRoomId, roomsQ.data]);

  useEffect(() => {
    if (!dialogOpen) {
      form.reset();
      setEditing(null);
    }
  }, [dialogOpen]);

  const createM = useMutation({
    mutationFn: (d: any) => apiClient.reservations.create(d),
    onSuccess: (response: any) => {
      qc.invalidateQueries({ queryKey: ["reservations"] });
      qc.invalidateQueries({ queryKey: ["vehicles"] });
      const emailDelivery = response?.data?.emailDelivery;
      if (emailDelivery?.emailSent) {
        toast.success("Reservation created and check-in email sent");
      } else if (emailDelivery) {
        toast.warning(`Reservation created, but check-in email was not sent: ${emailDelivery.error || "SMTP delivery failed."}`);
      } else {
        toast.success("Reservation created successfully");
      }
      setDialogOpen(false);
    },
    onError: (e: any) => toast.error(e?.response?.data?.error || "Failed to create reservation"),
  });

  const updateM = useMutation({
    mutationFn: ({ id, data }: any) => apiClient.reservations.update(id, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["reservations"] });
      qc.invalidateQueries({ queryKey: ["vehicles"] });
      toast.success("Reservation updated successfully");
      setDialogOpen(false);
    },
    onError: (e: any) => toast.error(e?.response?.data?.error || "Failed to update reservation"),
  });

  const deleteM = useMutation({
    mutationFn: (id: string) => apiClient.reservations.remove(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["reservations"] });
      qc.invalidateQueries({ queryKey: ["notifications"] });
      toast.success("Reservation deleted");
    },
    onError: () => toast.error("Failed to delete reservation"),
  });

  const quickStatusM = useMutation({
    mutationFn: ({ id, status }: any) => apiClient.reservations.update(id, { status }),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ["reservations"] });
      qc.invalidateQueries({ queryKey: ["guests"] });
      qc.invalidateQueries({ queryKey: ["payments"] });
      qc.invalidateQueries({ queryKey: ["rooms"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      toast.success(vars.status === "checked_in" ? "Guest checked in!" : "Guest checked out!");
    },
  });

  const handleCancelSubmit = async () => {
    if (!cancelingReservation) return;
    setCancelSubmitting(true);
    try {
      const res = await apiClient.reservations.cancel(cancelingReservation.id, { reason: cancelReason });
      if (res.data?.requiresApproval) {
        toast.info(res.data.message || "Cancellation request submitted to Admin for approval.");
      } else {
        toast.success("Reservation cancelled successfully");
      }
      setCancelingReservation(null);
      setCancelReason("");
      qc.invalidateQueries({ queryKey: ["reservations"] });
      qc.invalidateQueries({ queryKey: ["rooms"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
    } catch (err: any) {
      toast.error(err?.response?.data?.message || err?.response?.data?.error || "Failed to cancel reservation");
    } finally {
      setCancelSubmitting(false);
    }
  };

  const handleReviewCancellation = async (reservationId: number, status: 'approved' | 'rejected') => {
    try {
      const approvalsRes = await apiClient.approvals.list({ status: 'pending', type: 'cancellation' });
      const req = (approvalsRes.data?.data || []).find((a: any) => a.referenceId === String(reservationId));
      if (req) {
        await apiClient.approvals.review(req.id, { status });
      } else {
        await apiClient.reservations.update(String(reservationId), { status: status === 'approved' ? 'cancelled' : 'confirmed' });
      }
      toast.success(`Cancellation request ${status}`);
      qc.invalidateQueries({ queryKey: ["reservations"] });
      qc.invalidateQueries({ queryKey: ["rooms"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
    } catch (err: any) {
      toast.error(err?.response?.data?.message || `Failed to ${status} cancellation`);
    }
  };

  const handleSubmit = (values: any) => {
    const fn = values.firstName || form.getValues("firstName");
    const ln = values.lastName || form.getValues("lastName");
    const ci = values.checkIn || form.getValues("checkIn");
    const co = values.checkOut || form.getValues("checkOut");
    const vPlate = values.vehiclePlate || (form.watch() as any).vehiclePlate || "";
    const vMake = values.vehicleMake || (form.watch() as any).vehicleMake || "";

    if (!fn || !ln) {
      toast.error("First Name and Last Name are required");
      return;
    }

    if (!ci || !co) {
      toast.error("Please select both Check-In and Check-Out dates");
      return;
    }

    const emailVal = values.email || form.getValues("email") || "";
    const phoneVal = values.phone || form.getValues("phone") || "";

    const emailRegex = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;

if (emailVal.trim() && !emailRegex.test(emailVal.trim())) {
  toast.error("Please enter a valid email address (e.g. username@domain.com).");
  return;
}

    const payload: any = {
      firstName: fn,
      lastName: ln,
      email: emailVal,
      phone: phoneVal
  ? `${selectedCountry.dialCode}${phoneVal.trim()}`
  : "",
      roomId: values.roomId || form.getValues("roomId") ? Number(values.roomId || form.getValues("roomId")) : null,
      checkIn: ci,
      checkOut: co,
      status: values.status || form.getValues("status") || "confirmed",
      totalCharges: Number(values.totalCharges || form.getValues("totalCharges")) || 0,
      paidAmount: Number(values.paidAmount || form.getValues("paidAmount")) || 0,
      source: values.source || form.getValues("source") || "Direct",
      notes: values.notes || form.getValues("notes") || "",
      vehiclePlate: vPlate,
      vehicleMake: vMake,
    };

    if (vPlate.trim()) {
      const normPlate = vPlate.trim().replace(/\s+/g, "").toUpperCase();
      const existingRes = (reservationsQ.data?.items ?? []);
      const isDupRes = existingRes.some((r: any) =>
        r.id !== editing?.id &&
        r.vehiclePlate &&
        String(r.vehiclePlate).replace(/\s+/g, "").toUpperCase() === normPlate
      );
      if (!editing && isDupRes) {
        toast.error(`Validation Error: Vehicle with license plate ${vPlate.trim().toUpperCase()} is already registered for an existing reservation.`);
        return;
      }
    }

    if (editing) {
      if (editing.guestId) payload.guestId = Number(editing.guestId);
      updateM.mutate({ id: editing.id, data: payload });
    } else {
      createM.mutate(payload);
    }
  };

  // Sort items descending by ID so newly reserved candidates are ON TOP
  const items = (reservationsQ.data?.items ?? []).slice().sort((a: any, b: any) => Number(b.id) - Number(a.id));

  let nightsCount = 0;
  if (watchCheckIn && watchCheckOut) {
    const ci = new Date(watchCheckIn);
    const co = new Date(watchCheckOut);
    if (!isNaN(ci.getTime()) && !isNaN(co.getTime()) && co > ci) {
      nightsCount = Math.ceil((co.getTime() - ci.getTime()) / (1000 * 3600 * 24));
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-foreground">{t("reservations.title")}</h1>
          <p className="text-xs sm:text-sm text-muted-foreground">{t("reservations.subtitle")}</p>
        </div>
        <Button onClick={() => { setEditing(null); form.reset(); setDialogOpen(true); }} className="gap-2 cursor-pointer w-full sm:w-auto">
          <Plus className="h-4 w-4" /> {t("reservations.newReservation")}
        </Button>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="relative w-full sm:max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input placeholder={t("reservations.searchPlaceholder")} className="pl-9 w-full" value={search} onChange={e => setSearch(e.target.value)} />
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Reservation ID</TableHead>
                  <TableHead>{t("reservations.guestName")}</TableHead>
                  <TableHead>{t("reservations.roomNumber")}</TableHead>
                  <TableHead>{t("reservations.dates")}</TableHead>
                  <TableHead>{t("reservations.dates")}</TableHead>
                  <TableHead>{t("reservations.status")}</TableHead>
                  <TableHead>{t("reservations.totalAmount")}</TableHead>
                  <TableHead>{t("reservations.source")}</TableHead>
                  <TableHead>{t("common.actions")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {reservationsQ.isLoading ? (
                  <TableRow><TableCell colSpan={9} className="text-center py-8 text-muted-foreground">Loading...</TableCell></TableRow>
                ) : items.length === 0 ? (
                  <TableRow><TableCell colSpan={9} className="text-center py-8 text-muted-foreground">No reservations found</TableCell></TableRow>
                ) : items.map((r: any) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-mono text-xs font-bold text-foreground">RES-{String(r.id).padStart(4, '0')}</TableCell>
                    <TableCell className="font-medium">
                      {r.guest ? `${r.guest.firstName} ${r.guest.lastName}` : "—"}
                    </TableCell>
                    <TableCell className="font-semibold text-foreground">
                      {(() => {
                        const matchedRoom = (roomsQ.data ?? []).find(
                          (rm: any) => String(rm.id) === String(r.roomId) || String(rm.number) === String(r.roomId) || String(rm.room_number) === String(r.roomId)
                        );
                        if (r.room?.room_number) return r.room.room_number;
                        if (r.room?.number) return r.room.number;
                        if (matchedRoom?.number) return matchedRoom.number;
                        if (matchedRoom?.room_number) return matchedRoom.room_number;
                        return r.roomId ? `${r.roomId}` : "—";
                      })()}
                    </TableCell>
                    <TableCell>{r.checkIn ? new Date(r.checkIn).toLocaleDateString() : "—"}</TableCell>
                    <TableCell>{r.checkOut ? new Date(r.checkOut).toLocaleDateString() : "—"}</TableCell>
                    <TableCell>
                      <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
                        (r.status || '').toLowerCase() === 'cancellation_requested'
                          ? 'bg-amber-100 text-amber-800 border border-amber-300'
                          : STATUS_COLORS[(r.status || '').toLowerCase()] ?? "bg-slate-100 text-slate-600"
                      }`}>
                        {(() => {
                          const st = (r.status || '').toLowerCase();
                          if (st === 'cancellation_requested') return 'Cancellation Requested';
                          if (st === 'checked_in' || st === 'checkedin') return t("reservations.checkedIn");
                          if (st === 'checked_out' || st === 'checkedout') return t("reservations.checkedOut");
                          if (st === 'confirmed') return t("reservations.confirmed");
                          if (st === 'cancelled') return t("reservations.cancelled");
                          return st.replace('_', ' ');
                        })()}
                      </span>
                    </TableCell>
                    <TableCell>₹{(r.totalCharges ?? 0).toLocaleString()}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {r.source === "Direct" ? t("reservations.sourceDirect") : (r.source ?? "—")}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        {/* Edit Button */}
                        {hasPermission('reservations.edit') && (
                          <Button size="sm" variant="ghost" className="h-7 w-7 p-0" title="Edit Reservation"
                            onClick={() => {
                              setEditing(r);
                              const matchedRoom = (roomsQ.data ?? []).find(
                                (rm: any) => String(rm.id) === String(r.roomId) || String(rm.number) === String(r.roomId) || String(rm.room_number) === String(r.roomId)
                              );
                              const effectiveRoomId = matchedRoom ? String(matchedRoom.id) : (r.roomId ? String(r.roomId) : "");

                              form.reset({
                                guestId: r.guestId ? String(r.guestId) : "",
                                firstName: r.guest?.firstName || "",
                                lastName: r.guest?.lastName || "",
                                email: r.guest?.email || "",
                                phone: r.guest?.phone || "",
                                roomId: effectiveRoomId,
                                checkIn: r.checkIn ? new Date(r.checkIn).toISOString().split("T")[0] : "",
                                checkOut: r.checkOut ? new Date(r.checkOut).toISOString().split("T")[0] : "",
                                status: r.status ?? "confirmed",
                                totalCharges: r.totalCharges ?? 0,
                                paidAmount: r.paidAmount ?? 0,
                                source: r.source ?? "Direct",
                                notes: r.notes ?? "",
                              });
                              setDialogOpen(true);
                            }}>
                            <Edit className="h-3.5 w-3.5" />
                          </Button>
                        )}

                        {/* Pending Cancellation Quick Approval for Manager/Admin */}
                        {(r.status || '').toLowerCase() === 'cancellation_requested' && hasPermission('reservations.approve') && (
                          <>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 w-7 p-0 text-emerald-600 hover:bg-emerald-500/10"
                              title="Approve Cancellation"
                              onClick={() => handleReviewCancellation(r.id, 'approved')}
                            >
                              <CheckCircle2 className="h-4 w-4" />
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 w-7 p-0 text-rose-600 hover:bg-rose-500/10"
                              title="Reject Cancellation"
                              onClick={() => handleReviewCancellation(r.id, 'rejected')}
                            >
                              <XCircle className="h-4 w-4" />
                            </Button>
                          </>
                        )}

                        {/* Cancel / Request Cancellation Button */}
                        {(r.status || '').toLowerCase() !== 'cancelled' &&
                         (r.status || '').toLowerCase() !== 'checked_out' &&
                         (r.status || '').toLowerCase() !== 'cancellation_requested' &&
                         (hasPermission('reservations.cancel') || hasPermission('reservations.cancel_request')) && (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 w-7 p-0 text-amber-600 hover:bg-amber-500/10"
                            title={hasPermission('reservations.cancel') ? "Cancel Reservation (Direct)" : "Request Cancellation (Requires Admin Approval)"}
                            onClick={() => {
                              setCancelingReservation(r);
                              setCancelReason("");
                            }}
                          >
                            <Ban className="h-3.5 w-3.5" />
                          </Button>
                        )}

                        {/* Delete Button (ADMIN ONLY) */}
                        {hasPermission('reservations.delete') && (
                          <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-destructive hover:bg-destructive/10"
                            title="Delete Historical Reservation (Admin only)"
                            onClick={() => { if (!window.confirm("Permanently delete this reservation record?")) return; deleteM.mutate(r.id); }}>
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          <DataTablePagination
            currentPage={page}
            totalPages={reservationsQ.data?.pages || Math.ceil((reservationsQ.data?.total ?? 0) / (pageSize || 20)) || 1}
            totalItems={reservationsQ.data?.total ?? reservationsQ.data?.items?.length ?? 0}
            pageSize={pageSize}
            onPageChange={setPage}
            onPageSizeChange={setPageSize}
            pageSizeOptions={[10, 20, 50, 0]}
            itemName="reservations"
          />
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-2xl font-bold text-slate-900">{editing ? t("reservations.editReservationTitle") : t("reservations.newReservation")}</DialogTitle>
          </DialogHeader>
          <Form {...form}>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const values = form.getValues();
                const validationErr = validateGuestInput(values);
                if (validationErr) {
                  toast.error(validationErr);
                  return;
                }
                if (!values.roomId) {
                  toast.error("Validation Error: Please select a room for the reservation");
                  return;
                }
                const selectedRoom = (roomsQ.data ?? []).find((r: any) => String(r.id) === String(values.roomId));
                const reason = getRoomUnavailabilityReason(selectedRoom);
                if (reason) {
                  const roomNum = selectedRoom?.number || selectedRoom?.room_number || values.roomId;
                  toast.error(`Validation Error: Room ${roomNum} is ${reason} and cannot be reserved for a new booking.`);
                  return;
                }
                handleSubmit(values);
              }}
              className="space-y-4 pt-2"
            >

              {/* Guest Information Inputs */}
              <div className="space-y-2">
                <FormLabel className="font-semibold text-slate-800">{t("reservations.guestInformation")}</FormLabel>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <FormItem>
                    <FormLabel className="text-xs font-medium text-slate-700">{t("reservations.firstNameRequired")}</FormLabel>
                    <FormControl>
                      <Input
                        placeholder="John"
                        value={form.watch("firstName") || ""}
                        onChange={(e) => form.setValue("firstName", e.target.value)}
                      />
                    </FormControl>
                  </FormItem>
                  <FormItem>
                    <FormLabel className="text-xs font-medium text-slate-700">{t("reservations.lastNameRequired")}</FormLabel>
                    <FormControl>
                      <Input
                        placeholder="Doe"
                        value={form.watch("lastName") || ""}
                        onChange={(e) => form.setValue("lastName", e.target.value)}
                      />
                    </FormControl>
                  </FormItem>
                  <FormItem>
                    <FormLabel className="text-xs font-medium text-slate-700">{t("reservations.email")}</FormLabel>
                    <FormControl>
                      <Input
                        type="email"
                        placeholder="john@example.com"
                        value={form.watch("email") || ""}
                        onChange={(e) => form.setValue("email", e.target.value)}
                      />
                    </FormControl>
                  </FormItem>
                  <FormItem>
  <FormLabel className="text-xs font-medium text-slate-700">
    Phone Number *
  </FormLabel>

  <FormControl>
    <div className="flex rounded-md border border-input shadow-sm focus-within:ring-1 focus-within:ring-ring">
      
      <select
        value={selectedCountry.code}
        onChange={(e) => {
          const country =
            COUNTRY_CODES.find((c) => c.code === e.target.value) ||
            COUNTRY_CODES[0];

          setSelectedCountry(country);
        }}
className="h-10 w-[105px] shrink-0 rounded-l-md border-r bg-muted/60 px-2 py-2 text-xs font-semibold outline-none hover:bg-muted cursor-pointer"      >
        {COUNTRY_CODES.map((country) => (
          <option key={country.code} value={country.code}>
            {country.flag} {country.dialCode} ({country.name})
          </option>
        ))}
      </select>

      <Input
        id="phone"
        type="tel"
        maxLength={selectedCountry.digitsLength}
        value={form.watch("phone") || ""}
        onChange={(e) => {
          const raw = e.target.value
            .replace(/\D/g, "")
            .slice(0, selectedCountry.digitsLength);

          form.setValue("phone", raw);
        }}
        placeholder={selectedCountry.placeholder}
className="h-10 min-w-0 flex-1 border-0 rounded-l-none pl-3 shadow-none focus-visible:ring-0"      />

    </div>
  </FormControl>
</FormItem>
                </div>
              </div>

              {/* Guest Vehicle Information */}
              <div className="space-y-2 pt-1 border-t">
                <FormLabel className="font-semibold text-slate-800">{t("reservations.vehicleDetailsOptional")}</FormLabel>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <FormItem>
                    <FormLabel className="text-xs font-medium text-slate-700">{t("vehicles.licensePlate")}</FormLabel>
                    <FormControl>
                      <Input
                        placeholder="e.g. AP 39 AB 1234"
                        maxLength={13}
                        value={(form.watch() as any).vehiclePlate || ""}
                        onChange={(e) => {
                          const formatted = e.target.value.toUpperCase().replace(/[^A-Z0-9\s]/g, "").slice(0, 13);
                          form.setValue("vehiclePlate" as any, formatted);
                        }}
                      />
                    </FormControl>
                  </FormItem>
                  <FormItem>
                    <FormLabel className="text-xs font-medium text-slate-700">{t("reservations.vehicleBrandModel")}</FormLabel>
                    <FormControl>
                      <Input
                        placeholder="e.g. Toyota Innova"
                        maxLength={30}
                        value={(form.watch() as any).vehicleMake || ""}
                        onChange={(e) => {
                          const formatted = e.target.value.replace(/[^A-Za-z0-9\s\-\.]/g, "").slice(0, 30);
                          form.setValue("vehicleMake" as any, formatted);
                        }}
                      />
                    </FormControl>
                  </FormItem>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
                <FormItem>
                  <FormLabel className="font-semibold text-slate-800">{t("roomDrawer.type", "Room")}</FormLabel>
                  <FormControl>
                    <Select value={form.watch("roomId") ? String(form.watch("roomId")) : ""} onValueChange={v => form.setValue("roomId", v)}>
                      <SelectTrigger><SelectValue placeholder={t("reservations.selectRoom")} /></SelectTrigger>
                      <SelectContent>
                        {(roomsQ.data ?? []).map((r: any) => {
                          const reason = getRoomUnavailabilityReason(r);
                          const isUnavailable = Boolean(reason);
                          const roomTypeKey = String(r.type || "standard").toLowerCase();
                          const translatedType = t(`dashboard.${roomTypeKey}`, r.type || "Standard") as string;
                          const reasonKeyMap: Record<string, string> = {
                            "already reserved": "reserved",
                            "dirty": "dirty",
                            "occupied": "occupied",
                            "under maintenance": "maintenance",
                            "unavailable": "maintenance",
                          };
                          const translatedReason = reason
                            ? `[${(t(`dashboard.${reasonKeyMap[reason] ?? reason}`, reason) as string).toUpperCase()}]`
                            : "";
                          return (
                            <SelectItem key={r.id} value={String(r.id)} disabled={isUnavailable}>
                              {(t("roomDrawer.roomNumber", { number: r.number || r.room_number }) as string)} ({translatedType}){isUnavailable ? ` - ${translatedReason}` : ""}
                            </SelectItem>
                          );
                        })}
                      </SelectContent>
                    </Select>
                  </FormControl>
                </FormItem>
                <FormItem>
                  <FormLabel className="font-semibold text-slate-800">{t("reservations.bookingSource")}</FormLabel>
                  <FormControl>
                    <Select value={form.watch("source") || "Direct"} onValueChange={v => form.setValue("source", v)}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {["Direct", "Booking.com", "Expedia", "Airbnb", "MakeMyTrip"].map(s => (
                          <SelectItem key={s} value={s}>
                            {s === "Direct" ? t("reservations.sourceDirect") : s}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </FormControl>
                </FormItem>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
                <FormItem>
                  <FormLabel className="font-semibold text-slate-800">{t("reservations.checkInLabel")}</FormLabel>
                  <FormControl>
                    <Input
                      type="date"
                      value={form.watch("checkIn") || ""}
                      onChange={(e) => form.setValue("checkIn", e.target.value)}
                    />
                  </FormControl>
                </FormItem>
                <FormItem>
                  <FormLabel className="font-semibold text-slate-800">{t("reservations.checkOutLabel")}</FormLabel>
                  <FormControl>
                    <Input
                      type="date"
                      value={form.watch("checkOut") || ""}
                      onChange={(e) => form.setValue("checkOut", e.target.value)}
                    />
                  </FormControl>
                </FormItem>
              </div>

              <div className="flex flex-col-reverse sm:flex-row gap-2.5 sm:gap-3 justify-end pt-4">
                <Button type="button" variant="outline" className="h-11 rounded-2xl font-medium px-6 shadow-2xs w-full sm:w-auto cursor-pointer" onClick={() => setDialogOpen(false)}>
                  {t("common.cancel")}
                </Button>
                <Button type="submit" className="h-11 rounded-2xl font-semibold px-6 shadow-md shadow-primary/20 w-full sm:w-auto cursor-pointer" disabled={createM.isPending || updateM.isPending}>
                  {createM.isPending || updateM.isPending ? t("common.saving") : t("reservations.saveReservationButton")}
                </Button>
              </div>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      {/* Cancellation / Approval Request Modal */}
      {cancelingReservation && (
        <Dialog open={Boolean(cancelingReservation)} onOpenChange={() => setCancelingReservation(null)}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle className="text-lg font-bold flex items-center gap-2">
                <Ban className="h-5 w-5 text-rose-600" />
                {hasPermission('reservations.cancel')
                  ? 'Confirm Direct Cancellation'
                  : 'Request Cancellation (Admin Approval Required)'}
              </DialogTitle>
            </DialogHeader>

            <div className="space-y-4 pt-2 text-sm">
              {!hasPermission('reservations.cancel') && (
                <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-amber-800 dark:text-amber-300 text-xs flex items-start gap-2">
                  <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                  <div>
                    <p className="font-bold">Cancellation requires Admin approval.</p>
                    <p className="mt-0.5">Managers and Receptionists cannot cancel rooms directly. This action will submit a cancellation request to the Administrator for approval.</p>
                  </div>
                </div>
              )}

              <p className="text-muted-foreground text-xs">
                Reservation #{cancelingReservation.id} for guest{" "}
                <strong className="text-foreground">
                  {cancelingReservation.guest ? `${cancelingReservation.guest.firstName} ${cancelingReservation.guest.lastName}` : "Guest"}
                </strong>
                {cancelingReservation.room?.room_number && ` in Room ${cancelingReservation.room.room_number}`}.
              </p>

              <div>
                <label className="text-xs font-semibold text-muted-foreground">Reason for Cancellation *</label>
                <Input
                  required
                  placeholder="e.g. Guest family emergency / flight cancellation"
                  value={cancelReason}
                  onChange={(e) => setCancelReason(e.target.value)}
                  className="mt-1"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <Button variant="outline" size="sm" onClick={() => setCancelingReservation(null)}>
                  Keep Reservation
                </Button>
                <Button
                  size="sm"
                  variant="destructive"
                  disabled={cancelSubmitting || !cancelReason.trim()}
                  onClick={handleCancelSubmit}
                >
                  {cancelSubmitting
                    ? 'Submitting...'
                    : hasPermission('reservations.cancel')
                    ? 'Confirm Cancellation'
                    : 'Submit for Admin Approval'}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}


