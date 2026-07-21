"use client";

import { Button } from "@/components/ui/button";

export function PrintButton() {
  return (
    <Button size="sm" className="no-print" onClick={() => window.print()}>
      Print / Save PDF
    </Button>
  );
}
