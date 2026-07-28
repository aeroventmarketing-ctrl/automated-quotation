"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";

/** Print / Save-PDF button; auto-fires the print dialog when `auto` is set. */
export function PrintButton({ auto = false }: { auto?: boolean }) {
  useEffect(() => {
    if (!auto) return;
    const t = setTimeout(() => window.print(), 400);
    return () => clearTimeout(t);
  }, [auto]);
  return (
    <Button size="sm" className="no-print" onClick={() => window.print()}>
      Print / Save PDF
    </Button>
  );
}
