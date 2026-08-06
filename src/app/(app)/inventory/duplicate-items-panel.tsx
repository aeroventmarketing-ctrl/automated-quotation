"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Merge, Trash2, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { mergeStockItemsInto, removeStockItem } from "./actions";

export interface DupeItem {
  id: string;
  name: string;
  sku: string | null;
  qty: number;
  unit: string;
  sellPrice: number;
  unitCost: number;
}

const peso = (n: number) => (n > 0 ? `₱${n.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "—");

/**
 * Admin tool: review stock items whose names differ only by punctuation/spacing
 * (likely duplicates), then merge them into one or remove an item.
 */
export function DuplicateItemsPanel({ groups }: { groups: DupeItem[][] }) {
  const router = useRouter();
  const [primary, setPrimary] = useState<Record<number, string>>(() => Object.fromEntries(groups.map((g, i) => [i, g[0]?.id ?? ""])));
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function run(key: string, fn: () => Promise<void>) {
    setBusy(key);
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

  if (groups.length === 0) return null;

  return (
    <div className="rounded-lg border border-amber-300 bg-amber-50/60 p-3 dark:border-amber-900 dark:bg-amber-950/20">
      {/* Pure-CSS collapse (uncontrolled checkbox + peer) — same as the item list. */}
      <input type="checkbox" id="dupe-panel-toggle" defaultChecked className="peer hidden" />
      <label htmlFor="dupe-panel-toggle" className="flex cursor-pointer select-none items-center gap-1.5 text-sm font-semibold text-amber-800 dark:text-amber-300 peer-checked:[&_svg]:rotate-90">
        <ChevronRight className="h-3.5 w-3.5 transition-transform" />
        Possible duplicate items <span className="font-normal text-muted-foreground">({groups.length} group{groups.length === 1 ? "" : "s"})</span>
      </label>
      <div className="hidden space-y-3 pt-3 peer-checked:block">
      <p className="text-xs text-muted-foreground">
        These items&rsquo; names match except for punctuation/spacing, so they may be the same product. Pick the item to keep and merge the rest into it (their on-hand and reservations move over), or remove an item. Admin only.
      </p>
      {groups.map((g, gi) => (
        <div key={gi} className="rounded-md border bg-background p-2">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] border-collapse text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-muted-foreground">
                  <th className="py-1 pr-2 font-medium">Keep</th>
                  <th className="py-1 pr-2 font-medium">Name</th>
                  <th className="py-1 pr-2 font-medium">SKU</th>
                  <th className="py-1 pr-2 text-right font-medium">On hand</th>
                  <th className="py-1 pr-2 text-right font-medium">Sell</th>
                  <th className="py-1 pr-2 text-right font-medium">Cost</th>
                  <th className="py-1 font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {g.map((it) => (
                  <tr key={it.id} className="border-b last:border-0">
                    <td className="py-1 pr-2">
                      <input type="radio" name={`primary-${gi}`} checked={primary[gi] === it.id} onChange={() => setPrimary((p) => ({ ...p, [gi]: it.id }))} className="h-4 w-4" />
                    </td>
                    <td className="py-1 pr-2 font-medium">{it.name}</td>
                    <td className="py-1 pr-2 text-muted-foreground">{it.sku ?? "—"}</td>
                    <td className="py-1 pr-2 text-right tabular-nums">{it.qty} {it.unit}</td>
                    <td className="py-1 pr-2 text-right tabular-nums">{peso(it.sellPrice)}</td>
                    <td className="py-1 pr-2 text-right tabular-nums">{peso(it.unitCost)}</td>
                    <td className="py-1 text-right">
                      <button
                        type="button"
                        disabled={busy != null}
                        title="Remove this item"
                        onClick={() => { if (window.confirm(`Remove "${it.name}"${it.sku ? ` (${it.sku})` : ""}? Its history is kept but it leaves the active list.`)) run(`rm-${it.id}`, () => removeStockItem(it.id)); }}
                        className="text-muted-foreground hover:text-destructive"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-2">
            <Button
              size="sm"
              className="h-7 text-xs"
              disabled={busy != null || !primary[gi]}
              onClick={() => {
                const keepId = primary[gi];
                const otherIds = g.filter((x) => x.id !== keepId).map((x) => x.id);
                if (otherIds.length === 0) { setErr("Only one item — nothing to merge."); return; }
                const keep = g.find((x) => x.id === keepId);
                if (!window.confirm(`Merge ${otherIds.length} item(s) into "${keep?.name}"? Their on-hand and reservations move into it and they are deactivated.`)) return;
                run(`merge-${gi}`, () => mergeStockItemsInto({ primaryId: keepId, otherIds }));
              }}
            >
              <Merge className="mr-1 h-3.5 w-3.5" /> {busy === `merge-${gi}` ? "Merging…" : "Merge others into kept item"}
            </Button>
          </div>
        </div>
      ))}
      {err && <p className="text-xs text-destructive">{err}</p>}
      </div>
    </div>
  );
}
