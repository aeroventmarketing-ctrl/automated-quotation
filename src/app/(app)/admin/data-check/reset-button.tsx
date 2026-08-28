"use client";

/**
 * Two-step reset for a wholly-inherited order. The first click only reveals what
 * is about to happen; the second does it. Sending an order back to the start of
 * Phase 1 is not something to do on a stray click.
 *
 * Shown only for orders whose every recorded step was inherited — the server
 * action re-checks that independently, so this is a courtesy, not the guard.
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { resetInheritedWorkflow } from "./actions";

export function ResetInheritedButton({
  quotationId,
  quoteNumber,
  stamps,
  paths,
}: {
  quotationId: string;
  quoteNumber: string;
  stamps: number;
  paths: number;
}) {
  const router = useRouter();
  const [armed, setArmed] = useState(false);
  const [done, setDone] = useState("");
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();

  if (done) return <p className="text-sm font-medium text-emerald-600">{done}</p>;

  return (
    <div className="space-y-2 rounded-md border border-destructive/30 bg-destructive/5 p-3">
      {!armed ? (
        <Button variant="outline" size="sm" onClick={() => setArmed(true)}>
          Reset this order to the start
        </Button>
      ) : (
        <>
          <p className="text-sm">
            <b>{quoteNumber}</b> will go back to the beginning of Phase 1. This removes the{" "}
            {stamps} inherited step{stamps === 1 ? "" : "s"}
            {paths > 0 && <> and {paths} document reference{paths === 1 ? "" : "s"} belonging to the other order</>}
            . Its own payment records are not touched, and the work will have to be
            re-approved from the start.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="destructive"
              size="sm"
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  setError("");
                  try {
                    const r = await resetInheritedWorkflow(quotationId);
                    setDone(
                      `${r.quoteNumber} reset — removed ${r.removedStamps} inherited step${r.removedStamps === 1 ? "" : "s"}` +
                        (r.removedPaths ? ` and ${r.removedPaths} foreign document reference${r.removedPaths === 1 ? "" : "s"}` : "") +
                        ". It now starts at Phase 1.",
                    );
                    router.refresh();
                  } catch (e) {
                    setError(e instanceof Error ? e.message : "Reset failed.");
                  }
                })
              }
            >
              {pending ? "Resetting…" : "Yes, reset it"}
            </Button>
            <Button variant="ghost" size="sm" disabled={pending} onClick={() => setArmed(false)}>
              Cancel
            </Button>
          </div>
        </>
      )}
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}
