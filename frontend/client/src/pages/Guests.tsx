import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@/lib/api";
import { validateGuestInput } from "@/lib/validation";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Form, FormItem, FormLabel, FormControl } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { Plus, Search, Edit, Trash2, Star } from "lucide-react";

import { useTranslation } from "react-i18next";

import { DataTablePagination } from "@/components/ui/DataTablePagination";

function normalizeList(data: any) {
  if (Array.isArray(data)) return { items: data, total: data.length };
  if (data?.items) return data;
  return { items: [], total: 0 };
}

export default function GuestsPage() {
  const { t } = useTranslation();
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<any | null>(null);
  const qc = useQueryClient();

  const guestsQ = useQuery({
    queryKey: ["guests", page, pageSize, search],
    queryFn: async () => {
      const { data } = await apiClient.guests.list({ page, limit: pageSize === 0 ? 1000 : pageSize, q: search });
      return normalizeList(data);
    },
  });

  const form = useForm({
    defaultValues: {
      firstName: "",
      lastName: "",
      email: "",
      phone: "",
      idType: "Aadhar",
      idNumber: "",
      specialRequests: "",
    },
  });

  useEffect(() => {
    if (!dialogOpen) { form.reset(); setEditing(null); }
  }, [dialogOpen]);

  const createM = useMutation({
    mutationFn: (d: any) => apiClient.guests.create(d),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["guests"] });
      qc.invalidateQueries({ queryKey: ["notifications"] });
      toast.success("Guest profile created");
      setDialogOpen(false);
    },
    onError: (e: any) => toast.error(e?.response?.data?.error || "Failed to create guest"),
  });

  const updateM = useMutation({
    mutationFn: ({ id, data }: any) => apiClient.guests.update(id, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["guests"] });
      qc.invalidateQueries({ queryKey: ["notifications"] });
      toast.success("Guest profile updated");
      setDialogOpen(false);
    },
    onError: (e: any) => toast.error(e?.response?.data?.error || "Failed to update guest"),
  });

  const deleteM = useMutation({
    mutationFn: (id: string) => apiClient.guests.remove(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["guests"] });
      qc.invalidateQueries({ queryKey: ["notifications"] });
      toast.success("Guest deleted");
    },
    onError: () => toast.error("Failed to delete guest"),
  });

  const handleSubmit = (values: any) => {
    const emailRegex = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;
    const indiaPhoneRegex = /^(?:\+91[- ]?)?[6-9][0-9]{9}$/;

    if (values.email && values.email.trim() && !emailRegex.test(values.email.trim())) {
      toast.error("Please enter a valid email address (e.g. username@domain.com).");
      return;
    }

    if (values.phone && values.phone.trim() && !indiaPhoneRegex.test(values.phone.trim())) {
      toast.error("Phone number must be a valid 10-digit Indian mobile number starting with 6, 7, 8, or 9 (e.g. 9876543210).");
      return;
    }

    if (editing) updateM.mutate({ id: editing.id, data: values });
    else createM.mutate(values);
  };

  const items = guestsQ.data?.items ?? [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">{t("guests.title")}</h1>
          <p className="text-sm text-muted-foreground">{t("guests.subtitle")}</p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input placeholder={t("guests.searchPlaceholder")} className="pl-9" value={search} onChange={e => setSearch(e.target.value)} />
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("guests.guestName")}</TableHead>
                  <TableHead>{t("common.status")}</TableHead>
                  <TableHead>{t("reservations.email")}</TableHead>
                  <TableHead>{t("reservations.phone")}</TableHead>
                  <TableHead>{t("guests.registeredDate")}</TableHead>
                  <TableHead>{t("common.actions")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {guestsQ.isLoading ? (
                  <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground">Loading...</TableCell></TableRow>
                ) : items.length === 0 ? (
                  <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground">No guests found</TableCell></TableRow>
                ) : items.map((g: any) => (
                  <TableRow key={g.id}>
                    <TableCell className="font-medium">{g.firstName} {g.lastName}</TableCell>
                    <TableCell>
                      {(() => {
                        const isCheckedIn = g.reservations?.some((r: any) => {
                          const st = (r.status || '').toLowerCase();
                          return st === 'checked_in' || st === 'checkedin';
                        });
                        const isCheckedOut = !isCheckedIn && g.reservations?.some((r: any) => {
                          const st = (r.status || '').toLowerCase();
                          return st === 'checked_out' || st === 'checkedout';
                        });

                        const label = isCheckedIn ? t("reservations.checkedIn") : isCheckedOut ? t("reservations.checkedOut") : t("common.registered", "Registered");
                        const badgeStyle = isCheckedIn
                          ? "bg-emerald-500/10 text-emerald-600 border border-emerald-500/20"
                          : isCheckedOut
                            ? "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 border border-border"
                            : "bg-[#F3EDE4] text-[#8B6748] border border-[#C4A882]";

                        return (
                          <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${badgeStyle}`}>
                            {label}
                          </span>
                        );
                      })()}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">{g.email ?? "—"}</TableCell>
                    <TableCell>{g.phone ?? "—"}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{g.createdAt ? new Date(g.createdAt).toLocaleDateString() : "—"}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        <Button size="sm" variant="ghost" className="h-7 w-7 p-0"
                          onClick={() => {
                            setEditing(g);
                            form.reset({
                              firstName: g.firstName ?? "",
                              lastName: g.lastName ?? "",
                              email: g.email ?? "",
                              phone: g.phone ?? "",
                              specialRequests: g.specialRequests ?? "",
                            });
                            setDialogOpen(true);
                          }}>
                          <Edit className="h-3.5 w-3.5" />
                        </Button>
                        <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-destructive"
                          onClick={() => { if (!window.confirm("Delete guest?")) return; deleteM.mutate(g.id); }}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          <DataTablePagination
            currentPage={page}
            totalPages={guestsQ.data?.pages || Math.ceil((guestsQ.data?.total ?? 0) / (pageSize || 20)) || 1}
            totalItems={guestsQ.data?.total ?? guestsQ.data?.items?.length ?? 0}
            pageSize={pageSize}
            onPageChange={setPage}
            onPageSizeChange={setPageSize}
            pageSizeOptions={[10, 20, 50, 0]}
            itemName="guests"
          />
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-2xl font-bold text-slate-900">{editing ? "Edit Guest Profile" : "New Guest Profile"}</DialogTitle>
          </DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(values => {
              const validationErr = validateGuestInput(values);
              if (validationErr) {
                toast.error(validationErr);
                return;
              }
              handleSubmit(values);
            })} className="space-y-4 pt-2">
              <div className="grid grid-cols-2 gap-4">
                <FormItem>
                  <FormLabel className="font-semibold text-slate-800">First Name *</FormLabel>
                  <FormControl><Input placeholder="John" required {...form.register("firstName", { required: true })} /></FormControl>
                </FormItem>
                <FormItem>
                  <FormLabel className="font-semibold text-slate-800">Last Name *</FormLabel>
                  <FormControl><Input placeholder="Doe" required {...form.register("lastName", { required: true })} /></FormControl>
                </FormItem>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <FormItem>
                  <FormLabel className="font-semibold text-slate-800">Email</FormLabel>
                  <FormControl><Input type="email" placeholder="john@example.com" {...form.register("email")} /></FormControl>
                </FormItem>
                <FormItem>
                  <FormLabel className="font-semibold text-slate-800">Phone (10 Digits)</FormLabel>
                  <FormControl>
                    <Input
                      type="tel"
                      placeholder="9876543210"
                      maxLength={10}
                      value={form.watch("phone") || ""}
                      onChange={(e) => form.setValue("phone", e.target.value.replace(/\D/g, "").slice(0, 10))}
                    />
                  </FormControl>
                </FormItem>
              </div>
              <FormItem>
                <FormLabel className="font-semibold text-slate-800">Special Requests</FormLabel>
                <FormControl><Input placeholder="e.g. High floor, non-smoking..." {...form.register("specialRequests")} /></FormControl>
              </FormItem>
              <div className="flex gap-3 justify-end pt-4">
                <Button type="button" variant="outline" className="h-11 rounded-2xl font-medium px-6 shadow-2xs" onClick={() => setDialogOpen(false)}>
                  Cancel
                </Button>
                <Button type="submit" className="h-11 rounded-2xl font-semibold px-6 shadow-md shadow-primary/20" disabled={createM.isPending || updateM.isPending}>
                  {createM.isPending || updateM.isPending ? "Saving..." : "Save Guest"}
                </Button>
              </div>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
