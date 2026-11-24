/**
 * Admin: un-release an item that went out on an MRF — it comes back to stock and
 * the MRF forgets it was handed over.
 *
 * The owner, on Inventory · History: *"For admin only, add an option to unrelease
 * the released item. Once unreleased button is pressed, item count will be
 * updated and returned to inventory count. MRF, order number and workflow will
 * also be updated."* Clarified:
 *  - the button sits on the **Inventory history row** ("Issued on MRF" /
 *    "Released on MRF");
 *  - the admin chooses **how many** (default: what is left of that movement);
 *  - the MRF line goes **back to waiting** — an item issued from stock returns to
 *    "waiting for the warehouse" (to be issued again or sent to purchasing), a
 *    bought item to "awaiting release"; the MRF status follows (e.g. Issued →
 *    Partial);
 *  - a department's **receipt confirmation is cleared** — they confirm again.
 *
 * The returning movement carries `[undo:<movement id>]`, so the history can tell
 * how much of each movement is already back and never return more than went out.
 */
import type { MRFItem, MaterialRequestStatus } from "@/lib/order-workflow";

const MOVEMENT_REF_RE = /\[undo:([A-Za-z0-9_-]+)\]/;

/** "[undo:ckxyz]" — appended to the returning movement's reason. */
export const undoToken = (movementId: string) => `[undo:${movementId}]`;

/** The movement a return undoes, or null. */
export function undoneMovementId(reason: string | null | undefined): string | null {
  const m = String(reason ?? "").match(MOVEMENT_REF_RE);
  return m ? m[1] : null;
}

/** "MRF #0644 unreleased from Motor Controller — returned to stock [undo:…]". */
export function unreleaseReason(formNo: string, releasedTo: string | null, movementId: string): string {
  return `MRF #${formNo} unreleased${releasedTo ? ` from ${releasedTo}` : ""} — returned to stock ${undoToken(movementId)}`;
}

/** An MRF movement's reason: "MRF #0644" (issued) / "MRF #0644 released to Duct" (released). */
export function readMrfMovement(reason: string | null | undefined): { formNo: string; releasedTo: string | null } | null {
  const m = String(reason ?? "").trim().match(/^MRF #(\S+)(?: released to (.+))?$/i);
  return m ? { formNo: m[1], releasedTo: m[2] ?? null } : null;
}

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");
const num = (s: string | undefined) => Number(s ?? 0) || 0;

export interface UnreleasePlan {
  items: MRFItem[];
  /** The MRF line it came off (index in the ORIGINAL items). */
  lineIndex: number;
}

/**
 * Take `qty` back off the MRF line it went out on.
 *
 * Which line: lines of the right kind (issued from stock, or a bought line that
 * was released) that still have something out, then — when there is more than
 * one — the one whose description is the stock item's name, or whose SKU is its
 * SKU. A guess would move the wrong line, so an ambiguous case is refused.
 *
 *  - Issued from stock: the line's issued quantity drops; what comes back is a
 *    line **waiting for the warehouse** (no disposition). All of it back → the
 *    line itself becomes waiting.
 *  - Released (bought): the released quantity drops — the line is awaiting
 *    release again.
 */
export function planMrfUnrelease(
  items: readonly MRFItem[],
  o: { released: boolean; qty: number; stockName: string; stockSku: string | null; skuOf?: (description: string) => string | null },
): UnreleasePlan | { error: string } {
  if (!(o.qty > 0)) return { error: "Enter how many to return." };
  const kind = o.released ? "purchase" : "issue";
  const candidates = items
    .map((it, i) => ({ it, i }))
    .filter(({ it }) => it.disposition === kind && num(it.issuedQty) > 0);
  if (candidates.length === 0) return { error: `Nothing on this MRF is ${o.released ? "released" : "issued"} any more.` };
  let pick = candidates;
  if (pick.length > 1) {
    const byName = pick.filter(({ it }) => norm(it.description) === norm(o.stockName));
    if (byName.length >= 1) pick = byName;
    else if (o.stockSku && o.skuOf) {
      const code = o.stockSku.trim().toUpperCase();
      const bySku = pick.filter(({ it }) => (o.skuOf!(it.description) ?? "").trim().toUpperCase() === code);
      if (bySku.length >= 1) pick = bySku;
    }
  }
  // Several lines left only if they are the same article (an issue split in
  // two) — then the first that still has enough out. Different articles: refuse.
  if (pick.length > 1 && !pick.every(({ it }) => norm(it.description) === norm(pick[0].it.description))) {
    return { error: "Couldn't tell which MRF line this item went out on — correct the MRF on the order instead." };
  }
  const { it, i } = pick.find(({ it }) => num(it.issuedQty) >= o.qty) ?? pick[0];
  const out = num(it.issuedQty);
  if (o.qty > out) return { error: `Only ${out} went out on that MRF line.` };
  const left = Math.round((out - o.qty) * 1000) / 1000;
  const r = (n: number) => String(Math.round(n * 1000) / 1000);

  let replacement: MRFItem[];
  if (o.released) {
    replacement = [{ ...it, issuedQty: left > 0 ? r(left) : undefined }];
  } else if (left > 0) {
    // Part of an issued line comes back: the rest stays issued; the returned part waits.
    replacement = [
      { ...it, qty: r(left), issuedQty: r(left) },
      { ...it, qty: r(o.qty), disposition: undefined, issuedQty: undefined },
    ];
  } else {
    replacement = [{ ...it, disposition: undefined, issuedQty: undefined }];
  }
  return { items: mergeWaiting([...items.slice(0, i), ...replacement, ...items.slice(i + 1)]), lineIndex: i };
}

/**
 * Lines waiting for the warehouse that are the same article (description, unit,
 * remark) become one — so returning 1 and then 1 more reads "2 pc", not two
 * lines of 1. Handled lines are never merged.
 */
function mergeWaiting(items: MRFItem[]): MRFItem[] {
  const out: MRFItem[] = [];
  const key = (it: MRFItem) => `${norm(it.description)}|${norm(it.unit ?? "")}|${norm(it.remark ?? "")}`;
  for (const it of items) {
    if (!it.disposition) {
      const j = out.findIndex((o) => !o.disposition && key(o) === key(it));
      if (j >= 0) {
        out[j] = { ...out[j], qty: String(Math.round((num(out[j].qty) + num(it.qty)) * 1000) / 1000) };
        continue;
      }
    }
    out.push(it);
  }
  return out;
}

/**
 * The MRF's status once something came back: a line waiting for the warehouse,
 * or a bought line not fully released, means it is **Partial** again; otherwise
 * it stays as it was (minus "completed" — the receipt confirmation is cleared).
 */
export function statusAfterUnrelease(items: readonly MRFItem[], current: MaterialRequestStatus): MaterialRequestStatus {
  if (current === "cancelled") return current;
  if (items.some((it) => !it.disposition)) return "partial";
  const purchase = items.filter((it) => it.disposition === "purchase");
  if (purchase.some((it) => num(it.issuedQty) < num(it.qty))) return "partial";
  return current === "completed" ? "issued" : current;
}
