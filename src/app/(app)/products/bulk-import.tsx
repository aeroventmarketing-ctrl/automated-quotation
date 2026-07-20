"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { importProducts } from "./actions";

const TEMPLATE =
  "name,unit,category,note,supplier,code,price\n" +
  "GI Sheet 24ga,sheet,Raw material,,ALLOY MASTER INDUSTRIAL SUPPLY,GI24,850\n" +
  "GI Sheet 24ga,sheet,Raw material,,METRO STEEL SUPPLY,MS-24,865\n" +
  "Bolt M8 x 25,pcs,Fasteners,,FASTENER HOUSE,,2.5\n" +
  "Motor 5HP TECO,unit,Motors,,POWER MOTOR TRADING,TECO-5,18500\n";

export function BulkImport() {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [errs, setErrs] = useState<string[]>([]);
  const [fileName, setFileName] = useState("");

  function downloadTemplate() {
    const blob = new Blob([TEMPLATE], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "product-import-template.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  async function doImport() {
    const file = fileRef.current?.files?.[0];
    if (!file) { setMsg("Choose a file first."); return; }
    const fd = new FormData();
    fd.append("file", file);
    setBusy(true); setMsg(null); setErrs([]);
    try {
      const r = await importProducts(fd);
      const nothingImported = r.created === 0 && r.updated === 0 && r.skipped === 0;
      if (nothingImported && r.errors.length > 0) {
        // Pure validation failure (bad columns, unreadable file, …) — show it plainly.
        setMsg(null);
        setErrs(r.errors);
        return;
      }
      const parts = [
        `${r.created} added`,
        r.updated ? `${r.updated} updated` : "",
        r.skipped ? `${r.skipped} blank row${r.skipped === 1 ? "" : "s"} skipped` : "",
      ].filter(Boolean);
      setMsg(`Imported: ${parts.join(", ")}.`);
      setErrs(r.errors);
      if (fileRef.current) fileRef.current.value = "";
      setFileName("");
      router.refresh();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Import failed.");
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return <Button size="sm" variant="outline" onClick={() => setOpen(true)}>Import from file</Button>;
  }

  return (
    <div className="w-full space-y-2 rounded-md border p-3">
      <div className="flex items-center justify-between">
        <div className="text-sm font-medium">Bulk import products</div>
        <button type="button" className="text-xs text-muted-foreground hover:text-foreground" onClick={() => setOpen(false)}>Close</button>
      </div>
      <p className="text-xs text-muted-foreground">
        Upload a CSV or Excel (.xlsx) file. Columns: <span className="font-mono">name, unit, category, note, supplier, code, price</span> —
        only <b>name</b> is required. To give a product several suppliers, repeat the product on multiple rows with a different supplier each.
        SKUs are generated automatically.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={downloadTemplate} className="text-xs font-medium text-primary hover:underline">Download template (CSV)</button>
        <span className="text-muted-foreground">·</span>
        <input
          ref={fileRef}
          type="file"
          accept=".csv,.xlsx,text/csv"
          onChange={(e) => setFileName(e.target.files?.[0]?.name ?? "")}
          className="text-xs file:mr-2 file:rounded-md file:border file:bg-background file:px-2 file:py-1 file:text-xs"
        />
        <Button size="sm" className="h-8" disabled={busy || !fileName} onClick={doImport}>{busy ? "Importing…" : "Import"}</Button>
      </div>
      {msg && <p className="text-xs">{msg}</p>}
      {errs.length > 0 && (
        <ul className="space-y-0.5 text-xs text-destructive">
          {errs.map((e, i) => <li key={i}>{e}</li>)}
        </ul>
      )}
    </div>
  );
}
