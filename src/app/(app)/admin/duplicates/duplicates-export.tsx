"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";

/** One client record in a duplicate group, flattened for the report. */
export type DupExportRow = {
  group: number; // 1-based group number (records sharing the same value)
  value: string; // the shared duplicate value (e.g. the email address)
  company: string;
  contactName: string;
  email: string;
  phone: string;
  inquiries: number;
  salespeople: string;
  id: string;
};

/**
 * Download the currently-listed duplicate groups as an Excel (or CSV) report so
 * they can be reviewed BEFORE anyone deletes/merges. Purely client-side (Blob);
 * no records are changed.
 */
export function DuplicatesExport({ rows, fieldLabel, by }: { rows: DupExportRow[]; fieldLabel: string; by: string }) {
  const [err, setErr] = useState<string | null>(null);

  const HEADERS = ["Group", fieldLabel, "Company", "Contact name", "Email", "Phone", "Inquiries", "Salesperson(s)", "Client ID"];
  const cells = (r: DupExportRow): (string | number)[] => [
    r.group, r.value, r.company, r.contactName, r.email, r.phone, r.inquiries, r.salespeople, r.id,
  ];

  function downloadBlob(name: string, mime: string, data: BlobPart) {
    const url = URL.createObjectURL(new Blob([data], { type: mime }));
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function csvField(v: string | number): string {
    const s = String(v ?? "");
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }
  function downloadCsv() {
    const lines = [HEADERS, ...rows.map(cells)].map((r) => r.map(csvField).join(","));
    downloadBlob(`duplicate-${by}-report.csv`, "text/csv;charset=utf-8", "﻿" + lines.join("\n"));
  }

  async function downloadExcel() {
    setErr(null);
    try {
      const ExcelJS = (await import("exceljs")).default;
      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet("Duplicate emails");
      ws.addRow(HEADERS).font = { bold: true };
      let prev = 0;
      for (const r of rows) {
        // A thin separator between groups keeps the report easy to scan.
        if (prev && r.group !== prev) ws.addRow([]);
        ws.addRow(cells(r));
        prev = r.group;
      }
      ws.columns.forEach((col, i) => {
        const header = HEADERS[i] ?? "";
        const longest = Math.max(header.length, ...rows.map((r) => String(cells(r)[i] ?? "").length));
        col.width = Math.min(48, Math.max(10, longest + 2));
      });
      ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: HEADERS.length } };
      const buf = await wb.xlsx.writeBuffer();
      downloadBlob(
        `duplicate-${by}-report.xlsx`,
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        buf,
      );
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not build the Excel report");
    }
  }

  if (rows.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button size="sm" variant="outline" onClick={downloadExcel}>
        Download Excel report
      </Button>
      <Button size="sm" variant="outline" onClick={downloadCsv}>
        Download CSV
      </Button>
      <span className="text-xs text-muted-foreground">Review the report before deleting or merging.</span>
      {err && <span className="text-xs text-destructive">{err}</span>}
    </div>
  );
}
