/**
 * Which purchase request an MRF's badge follows.
 *
 * The owner, on MRF #0624: *"MRF is cancelled but PO is completed. Please
 * check"* — the MRF was split across suppliers into three requests; two were
 * Completed, and the newest was Cancelled. The order page and My Dashboard took
 * the LAST request raised for the MRF, so the card read "Cancelled" while its
 * goods had been bought and received (and the MRF itself was still open — its
 * Release To Requestor button was showing).
 *
 * A dropped request (cancelled / rejected) is not where the MRF stands while a
 * sibling is still live: follow the newest live one, and only when every request
 * is dropped follow the newest of those. Pure.
 */
const DROPPED = new Set(["CANCELLED", "REJECTED"]);

export function linkedPrByMrf<T extends { mrfId: string | null; status: string; createdAt: Date | string }>(prs: readonly T[]): Map<string, T> {
  const at = (p: T) => new Date(p.createdAt).getTime();
  const out = new Map<string, T>();
  for (const p of [...prs].sort((a, b) => at(a) - at(b))) {
    if (!p.mrfId) continue;
    const cur = out.get(p.mrfId);
    // A later request replaces the current one unless it is dropped and the current one is live.
    if (!cur || !DROPPED.has(p.status) || DROPPED.has(cur.status)) out.set(p.mrfId, p);
  }
  return out;
}
