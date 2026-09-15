import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from "@/components/ui/table";
import { normalizeListResponse, exportRowsToCsv } from "@/lib/module5";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Form, FormItem, FormLabel, FormControl } from "@/components/ui/form";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { shiftAuditFormSchema, ShiftAuditForm } from "@/lib/module5Schemas";
import { useTranslation } from "react-i18next";
import { DataTablePagination } from "@/components/ui/DataTablePagination";

export default function ShiftAuditsPage() {
  const { t } = useTranslation();
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(10);
  const qc = useQueryClient();
  const q = useQuery({ queryKey:["shift-audits",search, page], queryFn: async ()=>{ const { data } = await apiClient.shiftAudits.list({ limit: 50, q: search }); return normalizeListResponse<any>(data); } });
  const items = q.data?.items ?? [];
  const totalPages = Math.ceil(items.length / itemsPerPage) || 1;

  const create = useMutation({
    mutationFn: (payload: any) => apiClient.shiftAudits.create(payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["shift-audits"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      qc.invalidateQueries({ queryKey: ["notifications"] });
      toast.success("Audit created");
    },
    onError: (err: any) => {
      const msg = err?.response?.data?.error ?? err?.message ?? "Failed";
      toast.error(String(msg));
    },
  });

  const update = useMutation({
    mutationFn: ({ id, data }: any) => apiClient.shiftAudits.update(id, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["shift-audits"] });
      qc.invalidateQueries({ queryKey: ["notifications"] });
      toast.success("Audit updated");
    },
    onError: (err: any) => {
      const msg = err?.response?.data?.error ?? err?.message ?? "Failed";
      toast.error(String(msg));
    },
  });

  const remove = useMutation({
    mutationFn: (id: string) => apiClient.shiftAudits.remove(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["shift-audits"] });
      qc.invalidateQueries({ queryKey: ["notifications"] });
      toast.success("Audit removed");
    },
    onError: (err: any) => {
      const msg = err?.response?.data?.error ?? err?.message ?? "Failed";
      toast.error(String(msg));
    },
  });

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<any | null>(null);
  const form = useForm<ShiftAuditForm>({ resolver: zodResolver(shiftAuditFormSchema) as any, defaultValues: { employeeName: "", openingCash: 0, closingCash: 0, status: "open", notes: "" } });
  useEffect(()=>{ if(!dialogOpen){ form.reset(); setEditing(null); } }, [dialogOpen]);
  const handleCreate = ()=>{ setEditing(null); form.reset(); setDialogOpen(true); };

  const handleExport = ()=>{
    const csv = exportRowsToCsv(q.data?.items ?? [], [ { key: "id", label: "ID" }, { key: "employeeName", label: "Employee" }, { key: "openingCash", label: "Opening" }, { key: "closingCash", label: "Closing" } ]);
    const blob = new Blob([csv], { type: "text/csv" }); const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "shift-audits.csv"; a.click();
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <CardTitle className="text-lg sm:text-xl font-bold">{t("shiftAudits.title")}</CardTitle>
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 w-full sm:w-auto">
            <Input placeholder={t("shiftAudits.searchPlaceholder")} value={search} onChange={(e:any)=>setSearch(e.target.value)} className="w-full sm:w-64" />
            <div className="flex items-center gap-2">
              <Button onClick={handleCreate} className="cursor-pointer flex-1 sm:flex-none">{t("common.create")}</Button>
              <Button variant="outline" onClick={handleExport} className="cursor-pointer flex-1 sm:flex-none">Export CSV</Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("shiftAudits.employee")}</TableHead>
                  <TableHead>{t("shiftAudits.opening")}</TableHead>
                  <TableHead>{t("shiftAudits.closing")}</TableHead>
                  <TableHead>{t("shiftAudits.difference")}</TableHead>
                  <TableHead>{t("common.status")}</TableHead>
                  <TableHead>{t("common.actions")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(itemsPerPage === 0 ? items : items.slice((page - 1) * itemsPerPage, page * itemsPerPage)).map((r:any)=> (
                  <TableRow key={r.id}>
                    <TableCell className="font-semibold">{r.employeeName}</TableCell>
                    <TableCell>₹{r.openingCash}</TableCell>
                    <TableCell>₹{r.closingCash}</TableCell>
                    <TableCell>₹{r.difference}</TableCell>
                    <TableCell>
                      <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium border ${
                        (r.status || '').toLowerCase() === 'open' 
                          ? 'bg-[#F3EDE4] text-[#8B6748] border-[#C4A882]' 
                          : 'bg-slate-500/10 text-slate-600 border-slate-500/20'
                      }`}>
                        {(r.status || '').toLowerCase() === 'open' ? t("common.open", "Open") : t("common.closed", "Closed")}
                      </span>
                    </TableCell>
                    <TableCell className="flex gap-2">
                      <Button size="sm" className="cursor-pointer min-w-[65px]" onClick={()=>{ setEditing(r); form.reset({ employeeName: r.employeeName, openingCash: r.openingCash ?? 0, closingCash: r.closingCash ?? 0, status: r.status ?? "open", notes: r.notes ?? "" }); setDialogOpen(true); }}>{t("common.edit")}</Button>
                      <Button size="sm" variant="destructive" className="cursor-pointer min-w-[65px]" onClick={()=>{ if(!window.confirm("Delete audit?")) return; remove.mutate(r.id); }}>{t("common.delete")}</Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {/* Pagination Controls */}
          <DataTablePagination
            currentPage={page}
            totalPages={itemsPerPage === 0 ? 1 : Math.ceil(items.length / itemsPerPage) || 1}
            totalItems={items.length}
            pageSize={itemsPerPage}
            onPageChange={setPage}
            onPageSizeChange={setItemsPerPage}
            pageSizeOptions={[10, 20, 50, 0]}
            itemName="shift audits"
          />
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-2xl font-bold text-slate-900">{editing ? t("shiftAudits.editAudit") : t("shiftAudits.newAudit")}</DialogTitle>
          </DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit((values)=>{
              if (!values.employeeName || !values.employeeName.trim()) {
                toast.error("Employee Name is required");
                return;
              }
              if (editing) update.mutate({ id: editing.id, data: values }); else create.mutate(values);
              setDialogOpen(false);
            })} className="space-y-4 pt-2">
              <FormItem>
                <FormLabel className="font-semibold text-slate-800">{t("shiftAudits.employeeName")}</FormLabel>
                <FormControl>
                  <Input placeholder="e.g. John Doe" required {...form.register("employeeName", { required: true })} />
                </FormControl>
              </FormItem>
              <FormItem>
                <FormLabel className="font-semibold text-slate-800">{t("shiftAudits.openingCash")}</FormLabel>
                <FormControl>
                  <Input type="number" placeholder="0.00" required {...form.register("openingCash", { valueAsNumber: true })} />
                </FormControl>
              </FormItem>
              <div className="flex gap-3 justify-end pt-4">
                <Button type="button" variant="outline" className="h-11 rounded-2xl font-medium px-6 shadow-2xs cursor-pointer" onClick={()=>setDialogOpen(false)}>
                  {t("common.cancel")}
                </Button>
                <Button type="submit" className="h-11 rounded-2xl font-semibold px-6 shadow-md shadow-primary/20" disabled={create.isPending || update.isPending}>
                  {create.isPending || update.isPending ? t("common.saving") : t("shiftAudits.saveAudit")}
                </Button>
              </div>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
