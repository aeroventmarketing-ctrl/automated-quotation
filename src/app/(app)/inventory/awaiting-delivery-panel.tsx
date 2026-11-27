"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { PackageCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { confirmAwaitingDelivery, confirmAwaitingDeliveries, removeUndeliveredStock, removeUndeliveredStocks } from "./actions";

export interface AwaitingHoldView {
  id: string;
  itemId: string;
  itemName: string;
  sku: string | null;
  unit: string;
  qty: number;
  poRef: string;
  since: string;
  /** A short delivery left this behind — the PO itself is already received. */
  leftover: boolean;
  /**
   * This viewer may press Delivered on it — every line for the Warehouseman /
   * admin, the Motor Controller head's own department's lines (lib/catalogue-access).
   */
  canConfirm: boolean;
}

const fmt = (n: number) => new Intl.NumberFormat("en-US", { maximumFractionDigits: 3 }).format(n);
const when = (iso: string) =>
  new Date(iso).toLocaleString("en-PH", { timeZone: "Asia/Manila", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

/**
 * Bought stock that is in the inventory but not usable yet (lib/awaiting-delivery)
 * — shown to everyone on the Inventory tab, so anyone can remind the Warehouseman.
 */
export function AwaitingDeliveryPanel({ holds, canRemove }: { holds: AwaitingHoldView[]; canRemove: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  // Several lines at once — the owner: "add an option to press multiple
  // delivered button and not delivered button".
  const [sel, setSel] = useState<Set<string>>(new Set());
  if (holds.length === 0) return null;
  // What this viewer may tick: every line when they may remove stock (admin),
  // otherwise the lines they may confirm.
  const actionable = holds.filter((h) => canRemove || h.canConfirm);
  const canAct = actionable.length > 0;
  const canConfirm = holds.some((h) => h.canConfirm);
  const chosen = actionable.filter((h) => sel.has(h.id));
  const chosenConfirmable = chosen.filter((h) => h.canConfirm);
  const allOn = chosen.length === actionable.length;
  const toggle = (id: string) => setSel((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  /** Tick every line of one PO (or untick them if all are ticked). */
  const togglePo = (po: string) =>
    setSel((s) => {
      const ids = actionable.filter((h) => h.poRef === po).map((h) => h.id);
      const n = new Set(s);
      const on = ids.every((id) => n.has(id));
      for (const id of ids) if (on) n.delete(id); else n.add(id);
      return n;
    });

  async function bulk(kind: "delivered" | "removed") {
    const lines = kind === "delivered" ? chosenConfirmable : chosen;
    if (lines.length === 0) return;
    const pos = [...new Set(lines.map((h) => h.poRef))];
    const text =
      kind === "delivered"
        ? `Mark ${lines.length} line${lines.length === 1 ? "" : "s"} delivered (${pos.join(", ")})? They become usable now.`
        : `Not delivered: take ${lines.length} line${lines.length === 1 ? "" : "s"} back out of stock (${pos.join(", ")})?`;
    if (!window.confirm(text)) return;
    setBusy("bulk");
    setErr(null);
    setMsg(null);
    try {
      const ids = lines.map((h) => h.id);
      const r = kind === "delivered" ? await confirmAwaitingDeliveries(ids) : await removeUndeliveredStocks(ids);
      setMsg(
        `${r.done} line${r.done === 1 ? "" : "s"} ${kind === "delivered" ? "marked delivered" : "taken back out of stock"}` +
          (r.skipped ? ` · ${r.skipped} skipped (already handled)` : "") + ".",
      );
      setSel(new Set());
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(null);
    }
  }

  async function run(id: string, fn: () => Promise<void>, confirmText: string) {
    if (!window.confirm(confirmText)) return;
    setBusy(id);
    setErr(null);
    try {
      await fn();
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="rounded-lg border border-amber-400 bg-amber-50 p-3 text-sm dark:bg-amber-950/30">
      <div className="flex items-center gap-2 font-semibold text-amber-900 dark:text-amber-200">
        <PackageCheck className="h-4 w-4" />
        Bought — in stock but not usable yet ({holds.length})
      </div>
      <p className="mt-1 text-xs text-amber-900/80 dark:text-amber-200/80">
        Added when the cash &amp; check were released. They can&apos;t be issued, released to an MRF, sold or requested until the
        Warehouseman confirms the delivery — <b>Delivered</b> here, or <b>Goods arrived — Receive now</b> on the PO. Remind the Warehouseman if the goods are already here.
      </p>
      {canAct && (
        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
          <span className="text-amber-900/80 dark:text-amber-200/80">
            {chosen.length > 0 ? `${chosen.length} selected` : "Tick lines (or a PO number) to act on several at once."}
          </span>
          {chosenConfirmable.length > 0 && canConfirm && (
            <Button size="sm" className="h-7 px-2 text-xs" disabled={busy === "bulk"} onClick={() => bulk("delivered")}>
              {busy === "bulk" ? "…" : `Delivered (${chosenConfirmable.length})`}
            </Button>
          )}
          {chosen.length > 0 && canRemove && (
            <Button size="sm" variant="outline" className="h-7 px-2 text-xs text-destructive" disabled={busy === "bulk"} onClick={() => bulk("removed")}>
              {busy === "bulk" ? "…" : `Not delivered (${chosen.length})`}
            </Button>
          )}
          {chosen.length > 0 && (
            <button type="button" className="text-muted-foreground underline" onClick={() => setSel(new Set())}>Clear</button>
          )}
          {msg && <span className="text-emerald-700">{msg}</span>}
        </div>
      )}
      <div className="mt-2 overflow-x-auto">
        <table className="w-full min-w-[520px] text-xs">
          <thead>
            <tr className="border-b border-amber-300 text-left text-amber-900/70 dark:text-amber-200/70">
              {canAct && (
                <th className="w-6 py-1 pr-1">
                  <input
                    type="checkbox"
                    className="accent-amber-600"
                    checked={allOn}
                    onChange={() => setSel(allOn ? new Set() : new Set(actionable.map((h) => h.id)))}
                    aria-label="Select all"
                    title="Select all"
                  />
                </th>
              )}
              <th className="py-1 pr-2 font-medium">Item</th>
              <th className="py-1 pr-2 text-right font-medium">Not usable</th>
              <th className="py-1 pr-2 font-medium">PO</th>
              <th className="py-1 pr-2 font-medium">Since</th>
              <th className="py-1" />
            </tr>
          </thead>
          <tbody>
            {holds.map((h) => (
              <tr key={h.id} className={`border-b border-amber-200 last:border-0 ${sel.has(h.id) ? "bg-amber-100/70 dark:bg-amber-900/30" : ""}`}>
                {canAct && (
                  <td className="py-1 pr-1">
                    {(canRemove || h.canConfirm) && (
                      <input type="checkbox" className="accent-amber-600" checked={sel.has(h.id)} onChange={() => toggle(h.id)} aria-label={`Select ${h.itemName}`} />
                    )}
                  </td>
                )}
                <td className="py-1 pr-2">
                  <Link href={`/inventory/history?item=${h.itemId}`} className="font-medium hover:underline">{h.itemName}</Link>
                  {h.sku && <span className="ml-1 text-muted-foreground">SKU {h.sku}</span>}
                </td>
                <td className="whitespace-nowrap py-1 pr-2 text-right font-semibold tabular-nums">{fmt(h.qty)} {h.unit}</td>
                <td className="whitespace-nowrap py-1 pr-2">
                  {canAct ? (
                    <button type="button" className="hover:underline" title={`Select every line of ${h.poRef}`} onClick={() => togglePo(h.poRef)}>
                      {h.poRef}
                    </button>
                  ) : (
                    h.poRef
                  )}
                  <span className="ml-1 text-muted-foreground">
                    {h.leftover ? "· short delivery — the rest still to arrive" : "· awaiting Receive & Add Stock"}
                  </span>
                </td>
                <td className="whitespace-nowrap py-1 pr-2 text-muted-foreground">{when(h.since)}</td>
                <td className="whitespace-nowrap py-1 text-right">
                  {/* The shortcut for the Warehouseman: the goods are here, make
                      them usable. The PO's own Receive later counts them as in
                      stock already — nothing is added twice. */}
                  {h.canConfirm && (
                    <Button size="sm" variant="outline" className="h-6 px-2 text-[11px]" disabled={busy === h.id}
                      onClick={() => run(h.id, () => confirmAwaitingDelivery(h.id), `Confirm ${h.leftover ? "the rest of " : ""}${h.itemName} arrived? ${fmt(h.qty)} ${h.unit} become usable.`)}>
                      Delivered
                    </Button>
                  )}
                  {canRemove && (
                    <Button size="sm" variant="outline" className="ml-1 h-6 px-2 text-[11px] text-destructive" disabled={busy === h.id}
                      onClick={() => run(h.id, () => removeUndeliveredStock(h.id), `Not delivered: take ${fmt(h.qty)} ${h.unit} of ${h.itemName} back out of stock?`)}>
                      Not delivered
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {err && <p className="mt-1 text-xs text-destructive">{err}</p>}
    </div>
  );
}
