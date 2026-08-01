"use client";

import { Printer, FileSpreadsheet, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";

/** Print + export controls for the sales-report view (hidden when printing). */
export function ReportPrintBar({ from, to }: { from: string; to: string }) {
  const qs = `from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;
  return (
    <div className="flex flex-wrap items-center gap-2 print:hidden">
      <Button size="sm" onClick={() => window.print()}>
        <Printer className="h-4 w-4" /> Print
      </Button>
      <Button asChild size="sm" variant="outline">
        <a href={`/inquiries/report/xlsx?${qs}`}>
          <FileSpreadsheet className="h-4 w-4" /> Excel
        </a>
      </Button>
      <Button asChild size="sm" variant="outline">
        <a href={`/inquiries/report/pdf?${qs}`}>
          <FileText className="h-4 w-4" /> PDF
        </a>
      </Button>
    </div>
  );
}
