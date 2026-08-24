"use client";

import { useRef, useState, Fragment } from "react";
import { ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SUPPLIER_COLUMNS, parseEwt, type Supplier, type BulkResult } from "@/lib/suppliers";

type SaveFn = (input: {
  id?: string;
  company: string;
  contactPerson: string;
  contactNumber: string;
  email: string;
  address: string;
  tin: string;
  zip: string;
  bankName: string;
  accountNumber: string;
  ewt: boolean;
  remarks: string;
}) => Promise<Supplier[]>;
type DeleteFn = (id: string) => Promise<Supplier[]>;
type DeleteManyFn = (ids: string[]) => Promise<Supplier[]>;
type ClearAllFn = () => Promise<Supplier[]>;
type BulkFn = (input: { rows: Array<Omit<Supplier, "id" | "ewt"> & { ewt?: boolean }> }) => Promise<BulkResult>;
type LoadMasterFn = () => Promise<BulkResult>;

type Fields = Omit<Supplier, "id">;
type StrField = Exclude<keyof Fields, "ewt">;
const blank: Fields = { company: "", contactPerson: "", contactNumber: "", email: "", address: "", tin: "", zip: "", bankName: "", accountNumber: "", ewt: false, remarks: "" };
const HEADERS = SUPPLIER_COLUMNS.map((c) => c.label);

const nk = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");
const ALIASES: Record<StrField, string[]> = {
  company: ["company name", "company", "supplier", "supplier name"],
  contactPerson: ["contact person", "contact", "attention", "person", "contact name"],
  contactNumber: ["contact number", "contact no", "number", "phone", "mobile", "telephone", "tel"],
  email: ["email address", "email", "e-mail", "email add"],
  address: ["address", "location", "company address"],
  tin: ["tin", "taxpayer identification number", "taxpayer id", "tax id"],
  zip: ["zip code", "zip", "postal code", "postal"],
  bankName: ["bank name", "bank", "bank details", "bank name and account number", "payment details"],
  accountNumber: ["account number", "account no", "account #", "acct number", "acct no", "account"],
  remarks: ["remarks", "remark", "po remarks", "terms", "payment terms", "notes"],
};
const EWT_ALIASES = ["ewt capable (yes/no)", "ewt capable", "ewt", "ewt capable?", "with ewt", "ewt?"];

function csvEscape(v: string) {
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

/** Map a header row to field → column index, using aliases (exact then contains). */
function mapHeaders(headers: string[]): Partial<Record<StrField, number>> & { ewt?: number } {
  const H = headers.map(nk);
  const map: Partial<Record<StrField, number>> & { ewt?: number } = {};
  for (const field of Object.keys(ALIASES) as StrField[]) {
    const aliases = ALIASES[field];
    let idx = H.findIndex((h) => aliases.includes(h));
    if (idx < 0) idx = H.findIndex((h) => aliases.some((a) => h.includes(a)));
    if (idx >= 0) map[field] = idx;
  }
  // EWT column (exact match first, then contains "ewt").
  let ei = H.findIndex((h) => EWT_ALIASES.includes(h));
  if (ei < 0) ei = H.findIndex((h) => h.includes("ewt"));
  if (ei >= 0) map.ewt = ei;
  return map;
}

export function SuppliersManager({
  suppliers,
  onSave,
  onDelete,
  onDeleteMany,
  onClearAll,
  onBulkImport,
  onLoadMaster,
  onRemoveInvalid,
}: {
  suppliers: Supplier[];
  onSave: SaveFn;
  onDelete: DeleteFn;
  onDeleteMany?: DeleteManyFn;
  onClearAll?: ClearAllFn;
  onBulkImport: BulkFn;
  onLoadMaster?: LoadMasterFn;
  /** Purge junk "priced" suppliers (from a product export import). */
  onRemoveInvalid?: () => Promise<{ removedSuppliers: number; cleanedProducts: number; list: Supplier[] }>;
}) {
  const [list, setList] = useState<Supplier[]>(suppliers);
  const [add, setAdd] = useState<Fields>(blank);
  const [editId, setEditId] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [edit, setEdit] = useState<Fields>(blank);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const fileRef = useRef<HTMLInputElement>(null);
  const selectable = !!onDeleteMany;
  const toggleOne = (id: string) => setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const allSelected = list.length > 0 && selected.size === list.length;
  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(list.map((s) => s.id)));

  async function run(fn: () => Promise<Supplier[]>, after?: () => void) {
    setBusy(true);
    setErr(null);
    setMsg(null);
    try {
      setList(await fn());
      after?.();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  // --- Template download (current data + headers; blank = just headers) -------
  function download(name: string, blob: Blob) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
    URL.revokeObjectURL(url);
  }

  const ewtText = (b: boolean) => (b ? "yes" : "no");

  function downloadCsv(base = "suppliers-template") {
    const rows = [HEADERS, ...list.map((s) => [s.company, s.contactPerson, s.contactNumber, s.email, s.address, s.tin, s.zip, s.bankName, s.accountNumber, ewtText(s.ewt), s.remarks])];
    const csv = rows.map((r) => r.map((c) => csvEscape(c ?? "")).join(",")).join("\r\n");
    download(`${base}.csv`, new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" }));
  }

  async function downloadXlsx(base = "suppliers-template") {
    setBusy(true);
    setErr(null);
    try {
      const ExcelJS = (await import("exceljs")).default;
      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet("Suppliers");
      ws.addRow(HEADERS);
      ws.getRow(1).font = { bold: true };
      list.forEach((s) => ws.addRow([s.company, s.contactPerson, s.contactNumber, s.email, s.address, s.tin, s.zip, s.bankName, s.accountNumber, ewtText(s.ewt), s.remarks]));
      ws.columns.forEach((c) => (c.width = 28));
      const buf = await wb.xlsx.writeBuffer();
      download(`${base}.xlsx`, new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not build the Excel file");
    } finally {
      setBusy(false);
    }
  }

  async function deleteSelected() {
    if (!onDeleteMany) return;
    const ids = [...selected];
    if (ids.length === 0) return;
    if (!window.confirm(`Delete ${ids.length} selected supplier${ids.length === 1 ? "" : "s"}?`)) return;
    setBusy(true); setErr(null); setMsg(null);
    try { setList(await onDeleteMany(ids)); setSelected(new Set()); }
    catch (e) { setErr(e instanceof Error ? e.message : "Failed"); }
    finally { setBusy(false); }
  }

  async function clearAll() {
    if (!onClearAll) return;
    if (!window.confirm(`Clear ALL ${list.length} suppliers so you can import a fresh file?`)) return;
    if (!window.confirm("This removes every supplier on the list. Continue?")) return;
    setBusy(true); setErr(null); setMsg(null);
    try { setList(await onClearAll()); setSelected(new Set()); setMsg("Supplier list cleared. You can now import a fresh file."); }
    catch (e) { setErr(e instanceof Error ? e.message : "Failed"); }
    finally { setBusy(false); }
  }

  // --- Import (CSV / XLSX) ----------------------------------------------------
  async function fileToRows(file: File): Promise<string[][]> {
    const lower = file.name.toLowerCase();
    if (lower.endsWith(".xlsx") || lower.endsWith(".xlsm")) {
      const ExcelJS = (await import("exceljs")).default;
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(await file.arrayBuffer());
      const ws = wb.worksheets[0];
      if (!ws) throw new Error("No sheet found in the Excel file.");
      const rows: string[][] = [];
      ws.eachRow((row) => {
        const cells: string[] = [];
        for (let c = 1; c <= ws.columnCount; c++) cells.push(row.getCell(c).text ?? "");
        rows.push(cells);
      });
      return rows;
    }
    const Papa = (await import("papaparse")).default;
    const text = await file.text();
    const parsed = Papa.parse<string[]>(text, { skipEmptyLines: true });
    return (parsed.data as string[][]) ?? [];
  }

  async function onImport(file: File) {
    setBusy(true);
    setErr(null);
    setMsg(null);
    try {
      const rows = await fileToRows(file);
      const nonEmpty = rows.filter((r) => r.some((c) => (c ?? "").trim() !== ""));
      if (nonEmpty.length < 2) throw new Error("The file has no data rows.");
      const cols = mapHeaders(nonEmpty[0]);
      if (cols.company === undefined) throw new Error("Couldn't find a 'Company Name' column. Use the downloaded template.");
      const get = (r: string[], f: StrField) => (cols[f] !== undefined ? (r[cols[f]!] ?? "").trim() : "");
      const data = nonEmpty.slice(1).map((r) => ({
        company: get(r, "company"),
        contactPerson: get(r, "contactPerson"),
        contactNumber: get(r, "contactNumber"),
        email: get(r, "email"),
        address: get(r, "address"),
        tin: get(r, "tin"),
        zip: get(r, "zip"),
        bankName: get(r, "bankName"),
        accountNumber: get(r, "accountNumber"),
        ewt: cols.ewt !== undefined ? parseEwt(r[cols.ewt]) : undefined,
        remarks: get(r, "remarks"),
      }));
      const result = await onBulkImport({ rows: data });
      setList(result.list);
      setMsg(`Imported: ${result.added} added, ${result.updated} updated${result.skipped ? `, ${result.skipped} skipped` : ""}.`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Import failed");
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function onLoadMasterClick() {
    if (!onLoadMaster) return;
    if (!window.confirm("Load the AEROVENT master supplier list? Existing suppliers are matched by company name and updated with the master details and remarks; new ones are added.")) return;
    setBusy(true);
    setErr(null);
    setMsg(null);
    try {
      const result = await onLoadMaster();
      setList(result.list);
      setMsg(`AEROVENT list loaded: ${result.added} added, ${result.updated} updated${result.skipped ? `, ${result.skipped} skipped` : ""}.`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not load the AEROVENT supplier list");
    } finally {
      setBusy(false);
    }
  }

  async function removeInvalidClick() {
    if (!onRemoveInvalid) return;
    if (!window.confirm("Remove invalid suppliers whose name contains a price or semicolon (created by importing a product export file)? This also strips those junk links from products.")) return;
    setBusy(true);
    setErr(null);
    setMsg(null);
    try {
      const result = await onRemoveInvalid();
      setList(result.list);
      setMsg(`Removed ${result.removedSuppliers} invalid supplier${result.removedSuppliers === 1 ? "" : "s"}${result.cleanedProducts ? `, cleaned ${result.cleanedProducts} product${result.cleanedProducts === 1 ? "" : "s"}` : ""}.`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not remove invalid suppliers");
    } finally {
      setBusy(false);
    }
  }

  const cell = (v: string) => (v ? v : "—");
  const invalidCount = list.filter((s) => /[₱;]/.test(s.company)).length;

  return (
    <div className="space-y-4">
      {/* Import / export toolbar */}
      <div className="flex flex-wrap items-center gap-2 rounded-md border p-3">
        <span className="text-sm font-medium">Bulk import / export</span>
        <Button size="sm" variant="outline" className="h-8" disabled={busy} onClick={() => downloadXlsx("suppliers")}>Download Excel</Button>
        <Button size="sm" variant="outline" className="h-8" disabled={busy} onClick={() => downloadCsv("suppliers")}>Download CSV</Button>
        <input
          ref={fileRef}
          type="file"
          accept=".csv,.xlsx,.xlsm,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) onImport(f); }}
        />
        <Button size="sm" className="h-8" disabled={busy} onClick={() => fileRef.current?.click()}>Upload file</Button>
        {onLoadMaster && (
          <Button size="sm" variant="secondary" className="h-8" disabled={busy} onClick={onLoadMasterClick} title="Load the built-in AEROVENT supplier list (with complete remarks)">
            Load AEROVENT supplier list
          </Button>
        )}
        {onRemoveInvalid && invalidCount > 0 && (
          <Button size="sm" variant="outline" className="h-8 text-amber-700 hover:text-amber-700" disabled={busy} onClick={removeInvalidClick} title="Remove suppliers whose name contains a price/semicolon (import junk) and strip them from products">
            Remove invalid ({invalidCount})
          </Button>
        )}
        {onClearAll && list.length > 0 && (
          <Button size="sm" variant="outline" className="h-8 text-destructive hover:text-destructive" disabled={busy} onClick={clearAll}>Clear all ({list.length})</Button>
        )}
        <span className="text-xs text-muted-foreground">Download the list (or a blank template), fill it in, then upload (.xlsx or .csv). Existing companies are updated; new ones are added.</span>
      </div>

      {/* Bulk selection bar — appears once one or more suppliers are ticked. */}
      {selectable && selected.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm">
          <span className="font-medium">{selected.size} selected</span>
          <Button size="sm" variant="outline" className="h-7 text-xs text-destructive hover:text-destructive" disabled={busy} onClick={deleteSelected}>{busy ? "…" : "Delete selected"}</Button>
          <button type="button" className="text-xs text-muted-foreground hover:text-foreground" onClick={() => setSelected(new Set())}>Clear selection</button>
        </div>
      )}

      {/* Add new */}
      <div className="space-y-2 rounded-md border p-3">
        <div className="text-sm font-medium">Add a supplier</div>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
          <Input className="h-8" placeholder="Company Name" value={add.company} onChange={(e) => setAdd({ ...add, company: e.target.value })} />
          <Input className="h-8" placeholder="Contact Person" value={add.contactPerson} onChange={(e) => setAdd({ ...add, contactPerson: e.target.value })} />
          <Input className="h-8" placeholder="Contact Number" value={add.contactNumber} onChange={(e) => setAdd({ ...add, contactNumber: e.target.value })} />
          <Input className="h-8" placeholder="Email Address" value={add.email} onChange={(e) => setAdd({ ...add, email: e.target.value })} />
          <Input className="h-8 sm:col-span-2 lg:col-span-3" placeholder="Address" value={add.address} onChange={(e) => setAdd({ ...add, address: e.target.value })} />
          <Input className="h-8" placeholder="TIN" value={add.tin} onChange={(e) => setAdd({ ...add, tin: e.target.value })} />
          <Input className="h-8" placeholder="ZIP Code" value={add.zip} onChange={(e) => setAdd({ ...add, zip: e.target.value })} />
          <Input className="h-8" placeholder="Bank Name" value={add.bankName} onChange={(e) => setAdd({ ...add, bankName: e.target.value })} />
          <Input className="h-8" placeholder="Account Number" value={add.accountNumber} onChange={(e) => setAdd({ ...add, accountNumber: e.target.value })} />
          <label className="flex h-8 items-center gap-2 text-sm">
            <input type="checkbox" className="h-4 w-4" checked={add.ewt} onChange={(e) => setAdd({ ...add, ewt: e.target.checked })} />
            EWT capable
          </label>
          <Input className="h-8 sm:col-span-2 lg:col-span-3" placeholder="Remarks (auto-filled on the PO, e.g. 15 days / 30 DAYS PDC)" value={add.remarks} onChange={(e) => setAdd({ ...add, remarks: e.target.value })} />
        </div>
        <Button size="sm" className="h-8" disabled={busy || !add.company.trim()} onClick={() => run(() => onSave(add), () => setAdd(blank))}>
          {busy ? "Saving…" : "Add supplier"}
        </Button>
      </div>

      {/* List */}
      {list.length === 0 ? (
        <p className="text-sm text-muted-foreground">No suppliers yet. Add one above, import in bulk, or issue a Purchase Order to save one automatically.</p>
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full min-w-[1520px] border-collapse text-sm">
            <thead>
              <tr className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
                {selectable && (
                  <th className="py-2 px-3 w-8">
                    <input type="checkbox" className="h-4 w-4 cursor-pointer" checked={allSelected} onChange={toggleAll} aria-label="Select all" title="Select all" />
                  </th>
                )}
                <th className="py-2 px-3 font-medium">Company Name</th>
                <th className="py-2 px-3 font-medium">Contact Person</th>
                <th className="py-2 px-3 font-medium">Contact Number</th>
                <th className="py-2 px-3 font-medium">Email Address</th>
                <th className="py-2 px-3 font-medium">Address</th>
                <th className="py-2 px-3 font-medium">TIN</th>
                <th className="py-2 px-3 font-medium">ZIP</th>
                <th className="py-2 px-3 font-medium">Bank Name</th>
                <th className="py-2 px-3 font-medium">Account Number</th>
                <th className="py-2 px-3 font-medium">EWT</th>
                <th className="py-2 px-3 font-medium">Remarks</th>
                <th className="py-2 px-3 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {list.map((s) =>
                editId === s.id ? (
                  <tr key={s.id} className="border-b last:border-0 align-top">
                    {selectable && <td className="py-1.5 px-3" />}
                    <td className="py-1.5 px-2"><Input className="h-8" value={edit.company} onChange={(e) => setEdit({ ...edit, company: e.target.value })} /></td>
                    <td className="py-1.5 px-2"><Input className="h-8" value={edit.contactPerson} onChange={(e) => setEdit({ ...edit, contactPerson: e.target.value })} /></td>
                    <td className="py-1.5 px-2"><Input className="h-8" value={edit.contactNumber} onChange={(e) => setEdit({ ...edit, contactNumber: e.target.value })} /></td>
                    <td className="py-1.5 px-2"><Input className="h-8" value={edit.email} onChange={(e) => setEdit({ ...edit, email: e.target.value })} /></td>
                    <td className="py-1.5 px-2"><Input className="h-8" value={edit.address} onChange={(e) => setEdit({ ...edit, address: e.target.value })} /></td>
                    <td className="py-1.5 px-2"><Input className="h-8" value={edit.tin} onChange={(e) => setEdit({ ...edit, tin: e.target.value })} /></td>
                    <td className="py-1.5 px-2"><Input className="h-8" value={edit.zip} onChange={(e) => setEdit({ ...edit, zip: e.target.value })} /></td>
                    <td className="py-1.5 px-2"><Input className="h-8" value={edit.bankName} onChange={(e) => setEdit({ ...edit, bankName: e.target.value })} /></td>
                    <td className="py-1.5 px-2"><Input className="h-8" value={edit.accountNumber} onChange={(e) => setEdit({ ...edit, accountNumber: e.target.value })} /></td>
                    <td className="py-1.5 px-2 text-center"><input type="checkbox" className="h-4 w-4" checked={edit.ewt} onChange={(e) => setEdit({ ...edit, ewt: e.target.checked })} /></td>
                    <td className="py-1.5 px-2"><Input className="h-8" value={edit.remarks} onChange={(e) => setEdit({ ...edit, remarks: e.target.value })} /></td>
                    <td className="py-1.5 px-3">
                      <div className="flex justify-end gap-1.5">
                        <Button size="sm" className="h-7 text-xs" disabled={busy || !edit.company.trim()} onClick={() => run(() => onSave({ id: s.id, ...edit }), () => setEditId(null))}>Save</Button>
                        <Button size="sm" variant="outline" className="h-7 text-xs" disabled={busy} onClick={() => setEditId(null)}>Cancel</Button>
                      </div>
                    </td>
                  </tr>
                ) : (
                  <Fragment key={s.id}>
                  <tr className={`border-b last:border-0 ${selected.has(s.id) ? "bg-primary/5" : ""}`}>
                    {selectable && (
                      <td className="py-2 px-3">
                        <input type="checkbox" className="h-4 w-4 cursor-pointer" checked={selected.has(s.id)} onChange={() => toggleOne(s.id)} aria-label={`Select ${s.company}`} />
                      </td>
                    )}
                    <td className="py-2 px-3 font-medium">
                      <button
                        type="button"
                        className="flex items-center gap-1 text-left hover:text-primary hover:underline"
                        onClick={() => setOpenId(openId === s.id ? null : s.id)}
                        title="Show details"
                      >
                        <ChevronRight className={`h-3.5 w-3.5 shrink-0 transition-transform ${openId === s.id ? "rotate-90" : ""}`} />
                        {s.company}
                      </button>
                    </td>
                    <td className="py-2 px-3 text-muted-foreground">{cell(s.contactPerson)}</td>
                    <td className="py-2 px-3 text-muted-foreground">{cell(s.contactNumber)}</td>
                    <td className="py-2 px-3 text-muted-foreground">{cell(s.email)}</td>
                    <td className="py-2 px-3 text-muted-foreground">{cell(s.address)}</td>
                    <td className="py-2 px-3 text-muted-foreground">{cell(s.tin)}</td>
                    <td className="py-2 px-3 text-muted-foreground">{cell(s.zip)}</td>
                    <td className="py-2 px-3 text-muted-foreground">{cell(s.bankName)}</td>
                    <td className="py-2 px-3 text-muted-foreground">{cell(s.accountNumber)}</td>
                    <td className="py-2 px-3">
                      {s.ewt
                        ? <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-xs font-medium text-emerald-700">EWT</span>
                        : <span className="text-xs text-muted-foreground">No</span>}
                    </td>
                    <td className="py-2 px-3 text-muted-foreground">{cell(s.remarks)}</td>
                    <td className="py-2 px-3">
                      <div className="flex justify-end gap-1.5">
                        <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => { setEditId(s.id); setEdit({ company: s.company, contactPerson: s.contactPerson, contactNumber: s.contactNumber, email: s.email, address: s.address, tin: s.tin, zip: s.zip, bankName: s.bankName, accountNumber: s.accountNumber, ewt: s.ewt, remarks: s.remarks }); }}>Edit</Button>
                        <Button size="sm" variant="outline" className="h-7 text-xs text-destructive hover:text-destructive" disabled={busy} onClick={() => run(() => onDelete(s.id))}>Remove</Button>
                      </div>
                    </td>
                  </tr>
                  {openId === s.id && (
                    <tr className="border-b last:border-0 bg-muted/20">
                      <td colSpan={selectable ? 13 : 12} className="p-0">
                        {/* Pinned to the left of the scroll area and width-capped so
                            every field stays visible without scrolling the wide table. */}
                        <div className="sticky left-0 max-w-3xl px-4 py-3">
                        <div className="grid grid-cols-1 gap-x-8 gap-y-2 sm:grid-cols-2">
                          {([
                            ["Company Name", s.company],
                            ["Contact Person", s.contactPerson],
                            ["Contact Number", s.contactNumber],
                            ["Email Address", s.email],
                            ["Address", s.address],
                            ["TIN", s.tin],
                            ["ZIP Code", s.zip],
                            ["Bank Name", s.bankName],
                            ["Account Number", s.accountNumber],
                            ["EWT capable", s.ewt ? "Yes" : "No"],
                            ["Remarks", s.remarks],
                          ] as [string, string][]).map(([label, value]) => (
                            <div key={label} className="flex flex-col">
                              <span className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</span>
                              <span className="text-sm">{value || "—"}</span>
                            </div>
                          ))}
                        </div>
                        </div>
                      </td>
                    </tr>
                  )}
                  </Fragment>
                ),
              )}
            </tbody>
          </table>
        </div>
      )}
      {msg && <p className="text-xs text-emerald-700">{msg}</p>}
      {err && <p className="text-xs text-destructive">{err}</p>}
    </div>
  );
}
