"use client";

import { Button } from "@/components/ui/button";

export function PrintButton() {
  return <Button size="sm" className="h-9" onClick={() => window.print()}>Print labels</Button>;
}
