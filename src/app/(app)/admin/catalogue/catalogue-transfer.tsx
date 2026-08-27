"use client";

/**
 * Backup / restore for the catalogue: download the whole thing as Excel or CSV,
 * edit it in a spreadsheet, upload it back.
 *
 * Upload reuses the existing catalogue importer (/api/admin/import, type
 * "catalogue") rather than growing a second one — it already validates every
 * row in memory before touching the database, reports errors per row, and
 * matches on `modelCode`, which is what makes a re-upload an update rather than
 * a pile of duplicates.
 */

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface ImportResult {
  inserted: number;
  updated: number;
  errors: { row: number; message: string }[];
}

/** Excel's own MIME types, plus the extensions, since browsers disagree. */
const ACCEPT =
  ".csv,text/csv,.xlsx,.xlsm,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/** One CSV row from an array of cells. */
function toCsvRow(cells: string[]): string {
  return cells.map((c) => (/[",\r\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(",");
}

/**
 * Turn the chosen file into CSV text for the importer.
 *
 * A workbook is converted here in the browser rather than server-side so the
 * upload stays a small JSON body, and `cell.text` is used throughout — the
 * rendered string — so a model code Excel decided to store as a number still
 * arrives as the code the catalogue knows.
 */
async function fileToCsv(file: File): Promise<string> {
  if (!/\.(xlsx|xlsm)$/i.test(file.name)) return file.text();

  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await file.arrayBuffer());
  const ws = wb.worksheets[0];
  if (!ws) throw new Error("That workbook has no sheets.");

  const rows: string[] = [];
  ws.eachRow((row) => {
    const cells: string[] = [];
    for (let c = 1; c <= ws.columnCount; c++) cells.push(row.getCell(c).text.trim());
    // Excel hands back trailing empties for the full used range; a row that is
    // entirely blank is padding, not a record.
    if (cells.some((v) => v !== "")) rows.push(toCsvRow(cells));
  });
  return rows.join("\r\n");
}

export function CatalogueTransfer({ count }: { count: number }) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<ImportResult | null>(null);

  async function onFile(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    setError("");
    setResult(null);
    try {
      const csv = await fileToCsv(file);
      if (!csv.trim()) throw new Error("That file is empty.");

      const res = await fetch("/api/admin/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "catalogue", csv }),
      });
      // Read as text first: a 500 arrives as an HTML error page, and calling
      // res.json() on it throws something unreadable instead of the real cause.
      const raw = await res.text();
      let body: unknown;
      try {
        body = JSON.parse(raw);
      } catch {
        throw new Error(`Upload failed (${res.status}). ${raw.slice(0, 140)}`);
      }
      if (!res.ok) throw new Error((body as { error?: string }).error || `Upload failed (${res.status}).`);
      setResult(body as ImportResult);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed.");
    } finally {
      setBusy(false);
      // Let the same file be picked again after a fix — without this, choosing
      // it a second time fires no change event.
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Backup &amp; bulk edit</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <Button asChild variant="outline" size="sm">
            <a href="/api/admin/catalogue/backup?format=xlsx">Download Excel</a>
          </Button>
          <Button asChild variant="outline" size="sm">
            <a href="/api/admin/catalogue/backup?format=csv">Download CSV</a>
          </Button>
          <span className="mx-1 hidden h-5 w-px bg-border sm:block" />
          <input
            ref={fileRef}
            type="file"
            accept={ACCEPT}
            className="hidden"
            onChange={(e) => onFile(e.target.files?.[0])}
          />
          <Button size="sm" disabled={busy} onClick={() => fileRef.current?.click()}>
            {busy ? "Uploading…" : "Upload Excel / CSV"}
          </Button>
          <span className="text-xs text-muted-foreground">
            {count} item{count === 1 ? "" : "s"}
          </span>
        </div>

        <p className="text-xs text-muted-foreground">
          The download is the upload format — edit it and send it back. Rows are matched on{" "}
          <b>modelCode</b>: a code that already exists is updated, a new one is added, and nothing is
          ever deleted by uploading. You can send a narrower sheet too — a column you leave out is
          left as it is, and only a column you include but leave blank is cleared.{" "}
          <b>modelCode</b>, <b>family</b> and <b>name</b> are always required.
        </p>

        {error && <p className="text-sm text-destructive">{error}</p>}

        {result && (
          <div className="rounded-md border bg-muted/40 p-3 text-sm">
            <p>
              Added <b>{result.inserted}</b> · Updated <b>{result.updated}</b>
              {result.errors.length > 0 && (
                <>
                  {" "}
                  · Skipped <b>{result.errors.length}</b>
                </>
              )}
            </p>
            {result.errors.length > 0 && (
              <ul className="mt-2 list-disc space-y-0.5 pl-5 text-xs text-destructive">
                {result.errors.slice(0, 20).map((e, i) => (
                  <li key={i}>
                    Row {e.row}: {e.message}
                  </li>
                ))}
                {result.errors.length > 20 && (
                  <li className="text-muted-foreground">…and {result.errors.length - 20} more</li>
                )}
              </ul>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
