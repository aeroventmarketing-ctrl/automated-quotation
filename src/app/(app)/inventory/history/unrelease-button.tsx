"use client";

/**
 * Admin: un-release an item issued / released on an MRF (lib/mrf-unrelease) —
 * on its Inventory history row. The admin chooses how many; it comes back to
 * stock and the MRF line goes back to waiting.
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Undo2 } from "lucide-react";
import { adminUnreleaseMrfMovement } from "../../orders/actions";

const fmt = (n: number) => String(Math.round(n * 1000) / 1000);

export function UnreleaseButton({ movementId, left, unit, mrfLabel }: { movementId: string; left: number; unit: string; mrfLabel: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [qty, setQty] = useState(fmt(left));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  if (left <= 0) return <div className="mt-1 text-[11px] text-muted-foreground">Returned to stock</div>;

  async function run() {
    const n = Number(qty);
    if (!Number.isFinite(n) || n <= 0 || n > left) {
      setErr(`Enter 1 to ${fmt(left)}.`);
      return;
    }
    if (!window.confirm(`Unrelease ${fmt(n)} ${unit} from ${mrfLabel}? It goes back into stock and the MRF line goes back to waiting.`)) return;
    setBusy(true);
    setErr(null);
    try {
      await adminUnreleaseMrfMovement(movementId, n);
      setOpen(false);
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not unrelease");
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => { setOpen(true); setQty(fmt(left)); setErr(null); }}
        className="mt-1 inline-flex items-center gap-1 rounded border border-amber-500/50 px-1.5 py-0.5 text-[11px] font-medium text-amber-700 hover:bg-amber-500/10"
        title="Admin: return this item to stock and put the MRF line back to waiting"
      >
        <Undo2 className="h-3 w-3" /> Unrelease
      </button>
    );
  }
  return (
    <div className="mt-1 flex flex-wrap items-center gap-1 text-[11px]">
      <input
        type="number"
        min={0}
        max={left}
        step="any"
        value={qty}
        onChange={(e) => setQty(e.target.value)}
        className="h-6 w-16 rounded border bg-background px-1 text-right tabular-nums"
        aria-label="Quantity to unrelease"
      />
      <span className="text-muted-foreground">of {fmt(left)} {unit}</span>
      <button type="button" disabled={busy} onClick={run} className="rounded bg-amber-600 px-1.5 py-0.5 font-medium text-white hover:bg-amber-700 disabled:opacity-50">
        {busy ? "…" : "Return to stock"}
      </button>
      <button type="button" disabled={busy} onClick={() => setOpen(false)} className="rounded border px-1.5 py-0.5 hover:bg-accent">Cancel</button>
      {err && <span className="w-full text-destructive">{err}</span>}
    </div>
  );
}
