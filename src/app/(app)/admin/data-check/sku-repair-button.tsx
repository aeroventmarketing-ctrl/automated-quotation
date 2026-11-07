"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { repairSkuDrift } from "./actions";

/**
 * Correct the codes the SKU-drift check found — one request, or all of them.
 * The server recomputes what to change; this only says which requests.
 */
export function SkuRepairButton({ prIds, label }: { prIds: string[]; label: string }) {
  const router = useRouter();
  const [done, setDone] = useState("");
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  if (done) return <span className="text-xs font-medium text-emerald-600">{done}</span>;
  return (
    <span className="inline-flex items-center gap-2">
      <Button
        size="sm"
        variant="outline"
        className="h-7 text-xs"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            setError("");
            try {
              const r = await repairSkuDrift(prIds);
              setDone(`Corrected ${r.lines} line${r.lines === 1 ? "" : "s"} on ${r.requests} request${r.requests === 1 ? "" : "s"}`);
              router.refresh();
            } catch (e) {
              setError(e instanceof Error ? e.message : "Couldn't correct them.");
            }
          })
        }
      >
        {pending ? "Correcting…" : label}
      </Button>
      {error && <span className="text-xs text-destructive">{error}</span>}
    </span>
  );
}
