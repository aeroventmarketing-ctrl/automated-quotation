/**
 * Possible duplicate material requests on an order.
 *
 * The owner: *"In Orders workflow add a notification for duplicate material
 * request. Notification will show the original MRF or Purchase Order number,
 * date and time of first request. Show this … to purchaser, payment approver and
 * admin. Once user has checked, the user has the option to press the button to
 * confirm that it is not a duplicate order."* Clarified:
 *  - a duplicate is the **same item on the same order**, requested again by any
 *    department — matched by SKU, else by name. Cancelled / rejected requests
 *    don't count;
 *  - **any quantity** — both quantities are shown;
 *  - on the order's Phase 4 card, the Purchasing workspace, My Dashboard and the
 *    alarm;
 *  - **a warning only** — nothing is blocked. "Not a duplicate" records who and
 *    when (`chainLog.not_duplicate`) and the notice goes away.
 *
 * Pure: the loader (`duplicate-requests-data.ts`) reads the order's MRFs and
 * requests and hands them here.
 */
import { itemNameCandidates, normalizeItemName } from "@/lib/item-sku";
import { parseIssuedFromStockLine, poLineFromPRItem, stripToPurchasePrefix } from "@/lib/purchase-order";

/** Where the "Not a duplicate" confirmation lives on the request's chainLog. */
export const NOT_DUPLICATE_KEY = "not_duplicate";

export interface NotDuplicateStamp {
  byName: string;
  at: string;
}

export function readNotDuplicate(chainLog: unknown): NotDuplicateStamp | null {
  if (!chainLog || typeof chainLog !== "object" || Array.isArray(chainLog)) return null;
  const v = (chainLog as Record<string, unknown>)[NOT_DUPLICATE_KEY];
  if (!v || typeof v !== "object") return null;
  const s = v as Record<string, unknown>;
  return s.at ? { byName: String(s.byName ?? ""), at: String(s.at) } : null;
}

export interface DupLine {
  description: string;
  qty: string;
  unit: string;
  sku: string | null;
}

/** An earlier request the item may have been asked for on already. */
export interface DupSource {
  /** MRF id or purchase-request id. */
  id: string;
  /** The MRF it belongs to (an MRF itself, or a request raised from one); null for a request with no MRF. */
  mrfId: string | null;
  /** "MRF #0644 · PO-AFBM…" or "PO-AFBM…" / "Requisition". */
  ref: string;
  deptLabel: string;
  /** When it was first asked for (ISO). */
  at: string;
  lines: DupLine[];
}

/** The open request being checked. */
export interface DupTarget {
  prId: string;
  mrfId: string | null;
  at: string;
  lines: DupLine[];
}

export interface DuplicateHit {
  /** The item, as this request has it. */
  item: string;
  /** "2 pc" — this request. */
  qty: string;
  /** Where it was first asked for: "MRF #0644 · PO-AFBM20260001114". */
  firstRef: string;
  firstAt: string;
  /** "1 pc" — the first request. */
  firstQty: string;
  firstDept: string;
}

const qtyLabel = (l: DupLine) => `${l.qty}${l.unit ? ` ${l.unit}` : ""}`.trim();
const nameKeys = (s: string) => new Set(itemNameCandidates(s).map(normalizeItemName).filter(Boolean));
const skuKey = (s: string | null | undefined) => String(s ?? "").trim().toUpperCase();

/** The same item: the same SKU, or (when the codes don't settle it) the same name. */
export function sameItem(a: DupLine, b: DupLine): boolean {
  const sa = skuKey(a.sku);
  const sb = skuKey(b.sku);
  if (sa && sb) return sa === sb;
  const ka = nameKeys(a.description);
  for (const k of nameKeys(b.description)) if (ka.has(k)) return true;
  return false;
}

const time = (iso: string) => {
  const t = new Date(iso).getTime();
  return Number.isFinite(t) ? t : NaN;
};

/**
 * Each line of the target that an EARLIER request on the order already asked
 * for — with the earliest such request. Requests of the same MRF (a requisition
 * split across suppliers) are one request, never duplicates of each other.
 */
export function findDuplicates(target: DupTarget, sources: readonly DupSource[]): DuplicateHit[] {
  const t = time(target.at);
  if (!Number.isFinite(t)) return [];
  const earlier = sources
    .filter((s) => s.id !== target.prId && !(target.mrfId && s.mrfId === target.mrfId))
    .filter((s) => time(s.at) < t)
    .sort((a, b) => time(a.at) - time(b.at));
  const hits: DuplicateHit[] = [];
  const seen = new Set<string>();
  for (const line of target.lines) {
    if (!line.description.trim()) continue;
    for (const s of earlier) {
      const m = s.lines.find((l) => sameItem(line, l));
      if (!m) continue;
      const key = `${normalizeItemName(line.description)}|${s.id}`;
      if (!seen.has(key)) {
        seen.add(key);
        hits.push({ item: line.description, qty: qtyLabel(line), firstRef: s.ref, firstAt: s.at, firstQty: qtyLabel(m), firstDept: s.deptLabel });
      }
      break;
    }
  }
  return hits;
}

/** A request line ("2 pc · FAN BELT A-42") as a comparable line, with its recorded SKU. */
export function dupLineFromPrItem(item: string, sku: string | null | undefined): DupLine {
  const issued = parseIssuedFromStockLine(item);
  if (issued) return { description: issued.desc, qty: issued.qty, unit: issued.unit, sku: sku?.trim() || null };
  const l = poLineFromPRItem(stripToPurchasePrefix(item));
  return { description: l.description, qty: String(l.qty ?? ""), unit: l.unit ?? "", sku: sku?.trim() || null };
}

/** Open requests are checked; finished or dropped ones are not. */
export const DUP_CLOSED_STATUSES: ReadonlySet<string> = new Set(["COMPLETED", "REJECTED", "CANCELLED"]);
/** Dropped requests are never "the first request" either. */
export const DUP_DROPPED_STATUSES: ReadonlySet<string> = new Set(["REJECTED", "CANCELLED"]);

/** One line for the notice / dashboard: "FAN BELT (2 pc) — first on MRF #0644 · Nov 3, 2026, 9:14 AM (1 pc, Fans)". */
export function duplicateSummary(h: DuplicateHit, fmt: (iso: string) => string): string {
  return `${h.item} (${h.qty}) — first requested on ${h.firstRef} · ${fmt(h.firstAt)} (${h.firstQty}, ${h.firstDept})`;
}

// --- One order: its MRFs and requests → the open requests that repeat an item ----

export interface DupMrf {
  id: string;
  formNo: string;
  dept: string;
  status: string;
  raisedAt: string;
  items: { description: string; qty: string; unit: string }[];
}

export interface DupRequest {
  id: string;
  mrfId: string | null;
  dept: string | null;
  status: string;
  createdAt: Date | string;
  items: unknown;
  itemSkus?: unknown;
  po?: unknown;
  chainLog?: unknown;
}

const iso = (d: Date | string) => (d instanceof Date ? d.toISOString() : String(d ?? ""));
const poNumberOf = (po: unknown): string => {
  if (!po || typeof po !== "object") return "";
  return String((po as { poNumber?: unknown }).poNumber ?? "").trim();
};
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.map((x) => String(x ?? "")) : []);

/**
 * Every open request on ONE order that asks again for an item an earlier request
 * on the same order already asked for, by request id. `skuOf` gives an MRF line
 * its catalogue code (MRF lines don't carry one); `deptLabel` names a department.
 */
export function duplicateFlagsForOrder(
  mrfs: readonly DupMrf[],
  prs: readonly DupRequest[],
  skuOf: (description: string) => string | null,
  deptLabel: (key: string | null) => string,
): Map<string, DuplicateHit[]> {
  const live = prs.filter((p) => !DUP_DROPPED_STATUSES.has(p.status));
  const mrfById = new Map(mrfs.map((m) => [m.id, m]));
  const posOfMrf = new Map<string, string[]>();
  for (const p of live) {
    const n = poNumberOf(p.po);
    if (p.mrfId && n) posOfMrf.set(p.mrfId, [...new Set([...(posOfMrf.get(p.mrfId) ?? []), n])]);
  }
  const sources: DupSource[] = [];
  for (const m of mrfs) {
    if (m.status === "cancelled") continue;
    const pos = posOfMrf.get(m.id) ?? [];
    sources.push({
      id: m.id,
      mrfId: m.id,
      ref: [`MRF #${m.formNo}`, ...pos].join(" · "),
      deptLabel: deptLabel(m.dept),
      at: m.raisedAt,
      lines: m.items.map((it) => ({ description: it.description, qty: it.qty, unit: it.unit, sku: skuOf(it.description) })),
    });
  }
  const linesOf = (p: DupRequest) => {
    const skus = strings(p.itemSkus);
    return strings(p.items).map((it, i) => dupLineFromPrItem(it, skus[i]));
  };
  for (const p of live) {
    // Raised from an MRF the order still has — the MRF already stands for it.
    if (p.mrfId && mrfById.has(p.mrfId)) continue;
    sources.push({ id: p.id, mrfId: p.mrfId, ref: poNumberOf(p.po) || "Requisition", deptLabel: deptLabel(p.dept), at: iso(p.createdAt), lines: linesOf(p) });
  }
  const out = new Map<string, DuplicateHit[]>();
  for (const p of live) {
    if (DUP_CLOSED_STATUSES.has(p.status) || readNotDuplicate(p.chainLog)) continue;
    const mrf = p.mrfId ? mrfById.get(p.mrfId) : undefined;
    const hits = findDuplicates({ prId: p.id, mrfId: p.mrfId, at: mrf?.raisedAt || iso(p.createdAt), lines: linesOf(p) }, sources);
    if (hits.length) out.set(p.id, hits);
  }
  return out;
}

/** Who sees the notice and may press "Not a duplicate" — besides the admin. */
export const DUPLICATE_REVIEW_ROLES = ["purchaser", "payment_approver"] as const;
