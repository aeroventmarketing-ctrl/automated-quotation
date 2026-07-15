"use client";

import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SUPPLIER_COLUMNS, type Supplier, type BulkResult } from "@/lib/suppliers";

type SaveFn = (input: {
  id?: string;
  company: string;
  contactPerson: string;
  contactNumber: string;
  email: string;
  address: string;
  paymentDetails: string;
}) => Promise<Supplier[]>;
type DeleteFn = (id: string) => Promise<Supplier[]>;
type BulkFn = (input: { rows: Array<Omit<Supplier, "id">> }) => Promise<BulkResult>;

type Fields = Omit<Supplier, "id">;
const blank: Fields = { company: "", contactPerson: "", contactNumber: "", email: "", address: "", paymentDetails: "" };
const HEADERS = SUPPLIER_COLUMNS.map((c) => c.label);

const nk = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");
const ALIASES: Record<keyof Fields, string[]> = {
  company: ["company name", "company", "supplier", "supplier name"],
  contactPerson: ["contact person", "contact", "attention", "person", "contact name"],
  contactNumber: ["contact number", "contact no", "number", "phone", "mobile", "telephone", "tel"],
  email: ["email address", "email", "e-mail", "email add"],
  address: ["address", "location", "company address"],
  paymentDetails: ["bank details", "bank", "payment details", "payment", "payment terms", "terms"],
};

function csvEscape(v: string) {
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

/** Map a header row to field → column index, using aliases (exact then contains). */
function mapHeaders(headers: string[]): Partial<Record<keyof Fields, number>> {
  const H = headers.map(nk);
  const map: Partial<Record<keyof Fields, number>> = {};
  for (const field of Object.keys(ALIASES) as (keyof Fields)[]) {
    const aliases = ALIASES[field];
    let idx = H.findIndex((h) => aliases.includes(h));
    if (idx < 0) idx = H.findIndex((h) => aliases.some((a) => h.includes(a)));
    if (idx >= 0) map[field] = idx;
  }
  return map;
}

export function SuppliersManager({
  suppliers,
  onSave,
  onDelete,
  onBulkImport,
}: {
  suppliers: Supplier[];
  onSave: SaveFn;
  onDelete: DeleteFn;
  onBulkImport: BulkFn;
}) {
  const [list, setList] = useState<Supplier[]>(suppliers);
  const [add, setAdd] = useState<Fields>(blank);
  const [editId, setEditId] = useState<string | null>(null);
  const [edit, setEdit] = useState<Fields>(blank);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

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

  function downloadCsv() {
    const rows = [HEADERS, ...list.map((s) => [s.company, s.contactPerson, s.contactNumber, s.email, s.address, s.paymentDetails])];
    const csv = rows.map((r) => r.map((c) => csvEscape(c ?? "")).join(",")).join("\r\n");
    download("suppliers-template.csv", new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" }));
  }

  async function downloadXlsx() {
    setBusy(true);
    setErr(null);
    try {
      const ExcelJS = (await import("exceljs")).default;
      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet("Suppliers");
      ws.addRow(HEADERS);
      ws.getRow(1).font = { bold: true };
      list.forEach((s) => ws.addRow([s.company, s.contactPerson, s.contactNumber, s.email, s.address, s.paymentDetails]));
      ws.columns.forEach((c) => (c.width = 28));
      const buf = await wb.xlsx.writeBuffer();
      download("suppliers-template.xlsx", new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not build the Excel template");
    } finally {
      setBusy(false);
    }
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
      const get = (r: string[], f: keyof Fields) => (cols[f] !== undefined ? (r[cols[f]!] ?? "").trim() : "");
      const data = nonEmpty.slice(1).map((r) => ({
        company: get(r, "company"),
        contactPerson: get(r, "contactPerson"),
        contactNumber: get(r, "contactNumber"),
        email: get(r, "email"),
        address: get(r, "address"),
        paymentDetails: get(r, "paymentDetails"),
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

  const cell = (v: string) => (v ? v : "—");

  return (
    <div className="space-y-4">
      {/* Import / export toolbar */}
      <div className="flex flex-wrap items-center gap-2 rounded-md border p-3">
        <span className="text-sm font-medium">Bulk import</span>
        <Button size="sm" variant="outline" className="h-8" disabled={busy} onClick={downloadXlsx}>Download Excel template</Button>
        <Button size="sm" variant="outline" className="h-8" disabled={busy} onClick={downloadCsv}>Download CSV template</Button>
        <input
          ref={fileRef}
          type="file"
          accept=".csv,.xlsx,.xlsm,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) onImport(f); }}
        />
        <Button size="sm" className="h-8" disabled={busy} onClick={() => fileRef.current?.click()}>Upload file</Button>
        <span className="text-xs text-muted-foreground">Download the template, fill it in, then upload (.xlsx or .csv). Existing companies are updated; new ones are added.</span>
      </div>

      {/* Add new */}
      <div className="space-y-2 rounded-md border p-3">
        <div className="text-sm font-medium">Add a supplier</div>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
          <Input className="h-8" placeholder="Company Name" value={add.company} onChange={(e) => setAdd({ ...add, company: e.target.value })} />
          <Input className="h-8" placeholder="Contact Person" value={add.contactPerson} onChange={(e) => setAdd({ ...add, contactPerson: e.target.value })} />
          <Input className="h-8" placeholder="Contact Number" value={add.contactNumber} onChange={(e) => setAdd({ ...add, contactNumber: e.target.value })} />
          <Input className="h-8" placeholder="Email Address" value={add.email} onChange={(e) => setAdd({ ...add, email: e.target.value })} />
          <Input className="h-8 sm:col-span-2 lg:col-span-3" placeholder="Address" value={add.address} onChange={(e) => setAdd({ ...add, address: e.target.value })} />
          <Input className="h-8 sm:col-span-2 lg:col-span-3" placeholder="Bank Details" value={add.paymentDetails} onChange={(e) => setAdd({ ...add, paymentDetails: e.target.value })} />
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
          <table className="w-full min-w-[1000px] border-collapse text-sm">
            <thead>
              <tr className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
                <th className="py-2 px-3 font-medium">Company Name</th>
                <th className="py-2 px-3 font-medium">Contact Person</th>
                <th className="py-2 px-3 font-medium">Contact Number</th>
                <th className="py-2 px-3 font-medium">Email Address</th>
                <th className="py-2 px-3 font-medium">Address</th>
                <th className="py-2 px-3 font-medium">Bank Details</th>
                <th className="py-2 px-3 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {list.map((s) =>
                editId === s.id ? (
                  <tr key={s.id} className="border-b last:border-0 align-top">
                    <td className="py-1.5 px-2"><Input className="h-8" value={edit.company} onChange={(e) => setEdit({ ...edit, company: e.target.value })} /></td>
                    <td className="py-1.5 px-2"><Input className="h-8" value={edit.contactPerson} onChange={(e) => setEdit({ ...edit, contactPerson: e.target.value })} /></td>
                    <td className="py-1.5 px-2"><Input className="h-8" value={edit.contactNumber} onChange={(e) => setEdit({ ...edit, contactNumber: e.target.value })} /></td>
                    <td className="py-1.5 px-2"><Input className="h-8" value={edit.email} onChange={(e) => setEdit({ ...edit, email: e.target.value })} /></td>
                    <td className="py-1.5 px-2"><Input className="h-8" value={edit.address} onChange={(e) => setEdit({ ...edit, address: e.target.value })} /></td>
                    <td className="py-1.5 px-2"><Input className="h-8" value={edit.paymentDetails} onChange={(e) => setEdit({ ...edit, paymentDetails: e.target.value })} /></td>
                    <td className="py-1.5 px-3">
                      <div className="flex justify-end gap-1.5">
                        <Button size="sm" className="h-7 text-xs" disabled={busy || !edit.company.trim()} onClick={() => run(() => onSave({ id: s.id, ...edit }), () => setEditId(null))}>Save</Button>
                        <Button size="sm" variant="outline" className="h-7 text-xs" disabled={busy} onClick={() => setEditId(null)}>Cancel</Button>
                      </div>
                    </td>
                  </tr>
                ) : (
                  <tr key={s.id} className="border-b last:border-0">
                    <td className="py-2 px-3 font-medium">{s.company}</td>
                    <td className="py-2 px-3 text-muted-foreground">{cell(s.contactPerson)}</td>
                    <td className="py-2 px-3 text-muted-foreground">{cell(s.contactNumber)}</td>
                    <td className="py-2 px-3 text-muted-foreground">{cell(s.email)}</td>
                    <td className="py-2 px-3 text-muted-foreground">{cell(s.address)}</td>
                    <td className="py-2 px-3 text-muted-foreground">{cell(s.paymentDetails)}</td>
                    <td className="py-2 px-3">
                      <div className="flex justify-end gap-1.5">
                        <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => { setEditId(s.id); setEdit({ company: s.company, contactPerson: s.contactPerson, contactNumber: s.contactNumber, email: s.email, address: s.address, paymentDetails: s.paymentDetails }); }}>Edit</Button>
                        <Button size="sm" variant="outline" className="h-7 text-xs text-destructive hover:text-destructive" disabled={busy} onClick={() => run(() => onDelete(s.id))}>Remove</Button>
                      </div>
                    </td>
                  </tr>
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
