"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Printer, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * From/To range picker + Print for the Sales Summary view. Changing the range
 * reloads the same sheet with the new dates (payment-date basis is fixed).
 * Hidden when printing.
 */
export function SummaryControls({ from, to }: { from: string; to: string }) {
  const router = useRouter();
  const [f, setF] = useState(from);
  const [t, setT] = useState(to);

  function apply() {
    router.push(`/reports/sales-summary?from=${encodeURIComponent(f)}&to=${encodeURIComponent(t)}`);
  }

  return (
    <div className="flex flex-wrap items-end gap-2 print:hidden">
      <div className="space-y-1">
        <Label className="text-xs">From</Label>
        <Input type="date" value={f} onChange={(e) => setF(e.target.value)} className="h-9 w-[9.5rem]" />
      </div>
      <div className="space-y-1">
        <Label className="text-xs">To</Label>
        <Input type="date" value={t} onChange={(e) => setT(e.target.value)} className="h-9 w-[9.5rem]" />
      </div>
      <Button size="sm" onClick={apply}>
        <Search className="h-4 w-4" /> View
      </Button>
      <Button size="sm" variant="outline" onClick={() => window.print()}>
        <Printer className="h-4 w-4" /> Print
      </Button>
    </div>
  );
}
