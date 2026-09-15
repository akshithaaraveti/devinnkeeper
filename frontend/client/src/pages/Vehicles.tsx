import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from "@/components/ui/table";
import { normalizeListResponse, exportRowsToCsv } from "@/lib/module5";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Form, FormItem, FormLabel, FormControl } from "@/components/ui/form";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { vehicleFormSchema, VehicleForm } from "@/lib/module5Schemas";
import { toast } from "sonner";
import { validateIndianLicensePlate, validateVehicleBrandModel } from "@/lib/validation";
import { DataTablePagination } from "@/components/ui/DataTablePagination";

import { useTranslation } from "react-i18next";

export default function VehiclesPage(){
  const { t } = useTranslation();
  const [search,setSearch]=useState("");
  const [page,setPage]=useState(1);
  const [pageSize, setPageSize] = useState(15);
  const qc = useQueryClient();

  const q = useQuery({
    queryKey: ["vehicles", page, pageSize, search],
    queryFn: async () => {
      const [{ data: vData }, { data: resData }] = await Promise.all([
        apiClient.vehicles.list({ page, limit: pageSize === 0 ? 1000 : pageSize, q: search }),
        apiClient.reservations.list({ limit: 100 }),
      ]);
      const vList = normalizeListResponse<any>(vData).items;
      const resList = Array.isArray(resData) ? resData : (resData?.items || []);

      const norm = (s: string) => String(s || '').replace(/\s+/g, '').toUpperCase();
      const combined: any[] = [];
      const seenPlates = new Set<string>();

      vList.forEach((v: any) => {
        if (v.licensePlate) {
          const key = norm(v.licensePlate);
          if (key && !seenPlates.has(key)) {
            seenPlates.add(key);
            combined.push(v);
          }
        }
      });

      resList.forEach((r: any) => {
        if (r.vehiclePlate) {
          const key = norm(r.vehiclePlate);
          if (key && !seenPlates.has(key)) {
            seenPlates.add(key);
            combined.push({
              id: `res-veh-${r.id}`,
              licensePlate: r.vehiclePlate,
              make: r.vehicleMake || r.vehicleInfo || "Guest Vehicle",
              model: r.vehicleModel || "",
              parkingSlot: r.parkingSlot || `Slot #${(r.id % 20) + 1}`,
              parkingStatus: "Reserved Guest",
              arrivalTime: r.checkIn || new Date().toISOString(),
            });
          }
        }
      });

      return { items: combined, total: combined.length };
    }
  });

  const create = useMutation({
    mutationFn: (payload: any) => apiClient.vehicles.create(payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["vehicles"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      qc.invalidateQueries({ queryKey: ["notifications"] });
      toast.success(t("vehicles.toastAdded"));
    },
    onError: (err: any) => {
      const msg = err?.response?.data?.error ?? err?.message ?? "Failed";
      toast.error(String(msg));
    },
  });

  const update = useMutation({
    mutationFn: ({ id, data }: any) => apiClient.vehicles.update(id, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["vehicles"] });
      qc.invalidateQueries({ queryKey: ["notifications"] });
      toast.success(t("vehicles.toastUpdated"));
    },
    onError: (err: any) => {
      const msg = err?.response?.data?.error ?? err?.message ?? "Failed";
      toast.error(String(msg));
    },
  });

  const remove = useMutation({
    mutationFn: (id: string) => apiClient.vehicles.remove(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["vehicles"] });
      qc.invalidateQueries({ queryKey: ["notifications"] });
      toast.success(t("vehicles.toastRemoved"));
    },
    onError: (err: any) => {
      const msg = err?.response?.data?.error ?? err?.message ?? "Failed";
      toast.error(String(msg));
    },
  });

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<any | null>(null);

  const form = useForm<VehicleForm>({ resolver: zodResolver(vehicleFormSchema), defaultValues: { make: "", model: "", licensePlate: "", state: "", parkingSlot: "" } });

  useEffect(()=>{
    if (!dialogOpen) { form.reset(); setEditing(null); }
  }, [dialogOpen]);

  const handleAdd = ()=>{ setEditing(null); form.reset(); setDialogOpen(true); };

  const handleExport = ()=>{
    const csv = exportRowsToCsv(q.data?.items ?? [], [
      { key: "id", label: "ID" },
      { key: "licensePlate", label: "Plate" },
      { key: "make", label: "Make" },
      { key: "parkingSlot", label: "Slot" },
    ]);
    const blob = new Blob([csv], { type: "text/csv" }); const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "vehicles.csv"; a.click();
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <CardTitle className="text-lg sm:text-xl font-bold">{t("vehicles.title")}</CardTitle>
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 w-full sm:w-auto">
            <Input placeholder={t("vehicles.searchPlaceholder")} value={search} onChange={(e:any)=>setSearch(e.target.value)} className="w-full sm:w-64" />
            <Button variant="outline" onClick={handleExport} className="cursor-pointer shrink-0">{t("vehicles.exportCsv")}</Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("vehicles.licensePlate")}</TableHead>
                  <TableHead>{t("vehicles.makeModel")}</TableHead>
                  <TableHead>{t("vehicles.parkingSlot")}</TableHead>
                  <TableHead>{t("common.status")}</TableHead>
                  <TableHead>{t("vehicles.arrival")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(q.data?.items ?? []).map((v:any)=> {
                  const rawModel = (v.model || "").replace(/^Room\s+\d+/i, "").trim();
                  const displayMakeModel = `${v.make || ''} ${rawModel}`.trim() || t("vehicles.guestVehicle");
                  return (
                    <TableRow key={v.id}>
                      <TableCell className="font-mono font-medium">{v.licensePlate}</TableCell>
                      <TableCell>{displayMakeModel}</TableCell>
                      <TableCell>{v.parkingSlot ?? "—"}</TableCell>
                      <TableCell>{v.parkingStatus || t("common.registered")}</TableCell>
                      <TableCell>{v.arrivalTime ? new Date(v.arrivalTime).toLocaleString() : "—"}</TableCell>
                      <TableCell className="flex gap-2">
                        <Button size="sm" onClick={()=>{ setEditing(v); form.reset({ make: v.make, model: rawModel, licensePlate: v.licensePlate, state: v.state, parkingSlot: v.parkingSlot ?? "" }); setDialogOpen(true); }}>{t("common.edit")}</Button>
                        <Button size="sm" variant="destructive" onClick={()=>{ if(!window.confirm(t("common.delete") + " vehicle?")) return; remove.mutate(v.id); }}>{t("common.delete")}</Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>

          <DataTablePagination
            currentPage={page}
            totalPages={Math.ceil((q.data?.total ?? 0) / (pageSize || 15)) || 1}
            totalItems={q.data?.total ?? q.data?.items?.length ?? 0}
            pageSize={pageSize}
            onPageChange={setPage}
            onPageSizeChange={setPageSize}
            pageSizeOptions={[10, 15, 25, 50, 0]}
            itemName="vehicles"
          />
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-2xl font-bold text-slate-900">{editing ? t("vehicles.editVehicle") : t("vehicles.newVehicle")}</DialogTitle>
          </DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit((values)=>{
              const norm = (s: string) => String(s || '').replace(/\s+/g, '').toUpperCase();
              const targetPlate = norm(values.licensePlate || "");
              const isDup = (q.data?.items ?? []).some((v: any) => v.id !== editing?.id && norm(v.licensePlate) === targetPlate);
              if (!editing && isDup) {
                toast.error(t("vehicles.validationDuplicate", { plate: values.licensePlate?.trim().toUpperCase() }));
                return;
              }
              if (!validateIndianLicensePlate(values.licensePlate || "")) {
                toast.error(t("vehicles.validationInvalidPlate"));
                return;
              }
              if (!validateVehicleBrandModel(values.make || "")) {
                toast.error(t("vehicles.validationInvalidBrand"));
                return;
              }
              if (editing) {
                update.mutate({ id: editing.id, data: values });
              } else {
                create.mutate(values);
              }
              setDialogOpen(false);
            })} className="space-y-4 pt-2">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
                <FormItem>
                  <FormLabel className="font-semibold text-slate-800">{t("vehicles.brandMake")}</FormLabel>
                  <FormControl>
                    <Input
                      placeholder={t("vehicles.brandMakePlaceholder")}
                      maxLength={30}
                      required
                      value={form.watch("make") || ""}
                      onChange={(e) => {
                        const formatted = e.target.value.replace(/[^A-Za-z0-9\s\-\.]/g, "").slice(0, 30);
                        form.setValue("make", formatted);
                      }}
                    />
                  </FormControl>
                </FormItem>
                <FormItem>
                  <FormLabel className="font-semibold text-slate-800">{t("vehicles.model")}</FormLabel>
                  <FormControl>
                    <Input
                      placeholder={t("vehicles.modelPlaceholder")}
                      maxLength={30}
                      value={form.watch("model") || ""}
                      onChange={(e) => {
                        const formatted = e.target.value.replace(/[^A-Za-z0-9\s\-\.]/g, "").slice(0, 30);
                        form.setValue("model", formatted);
                      }}
                    />
                  </FormControl>
                </FormItem>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
                <FormItem>
                  <FormLabel className="font-semibold text-slate-800">{t("vehicles.licensePlate")} *</FormLabel>
                  <FormControl>
                    <Input
                      placeholder={t("vehicles.licensePlatePlaceholder")}
                      maxLength={13}
                      required
                      value={form.watch("licensePlate") || ""}
                      onChange={(e) => {
                        const formatted = e.target.value.toUpperCase().replace(/[^A-Z0-9\s]/g, "").slice(0, 13);
                        form.setValue("licensePlate", formatted);
                      }}
                    />
                  </FormControl>
                </FormItem>
                <FormItem>
                  <FormLabel className="font-semibold text-slate-800">{t("vehicles.stateRegion")}</FormLabel>
                  <FormControl>
                    <Input placeholder="AP" maxLength={10} {...form.register("state")} />
                  </FormControl>
                </FormItem>
              </div>
              <FormItem>
                <FormLabel className="font-semibold text-slate-800">{t("vehicles.parkingSlotLabel")}</FormLabel>
                <FormControl>
                  <Input placeholder="Slot A-1" {...form.register("parkingSlot")} />
                </FormControl>
              </FormItem>
              <div className="flex gap-3 justify-end pt-4">
                <Button type="button" variant="outline" className="h-11 rounded-2xl font-medium px-6 shadow-2xs" onClick={()=>setDialogOpen(false)}>
                  {t("common.cancel")}
                </Button>
                <Button type="submit" className="h-11 rounded-2xl font-semibold px-6 shadow-md shadow-primary/20" disabled={create.isPending || update.isPending}>
                  {create.isPending || update.isPending ? t("vehicles.saving") : t("vehicles.saveVehicle")}
                </Button>
              </div>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
