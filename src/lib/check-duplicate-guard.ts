/**
 * The refusal that stops a check number being recorded twice — the owner's
 * *"disallow duplicate input"*, said of two register rows sharing check no.
 * 0000486718.
 *
 * ## Why it refuses rather than warns
 *
 * A check number is pre-printed on one piece of paper and consumed once. Two
 * purchase orders carrying the same one is therefore always an error — either
 * the wrong photo went onto a PO or the reading was wrong — and the only open
 * question is which. Where one check legitimately covers several requests, this
 * system's answer is a **combined PO**: one PO number, one check, several member
 * rows, which `otherPurchaseOrdersWithCheck` already counts as a single purchase
 * order. So there is no honest case the refusal can catch by mistake.
 *
 * It had been a warning, and a warning is what produced the screen the owner was
 * looking at: the duplicate was noted on the PO recorded SECOND, stored on that
 * check for good, and the PO recorded first never learned anything had happened.
 * Two rows, one number, one flag.
 *
 * ## Why it lives here
 *
 * Both input paths ask it — a person typing a correction (`correctCheckRead`)
 * and the AI reader (`/api/ai/read-check`) — and one is a server action while
 * the other is a route handler, so neither can import from the other. A rule
 * enforced in two places is a rule enforced in one and a half.
 */
import { prisma } from "@/lib/db";
import { coercePurchaseOrder } from "@/lib/purchase-order";
import { poBatchId } from "@/lib/purchase-batch";
import { coerceCheckDocs, effectiveCheckNo, formatCheckNo, normalizeCheckNo } from "@/lib/voucher-check";
import { otherPurchaseOrdersWithCheck, duplicateCheckRefusal } from "@/lib/check-duplicates";

/**
 * Is this check number already recorded somewhere else? Returns the sentence to
 * refuse with, or null to carry on.
 *
 * Reads every purchase request, which is what the question needs — the whole
 * register — and is the same read the check reader has always done to raise its
 * warning.
 *
 * The number compared is the EFFECTIVE one (`effectiveCheckNo`): a person's
 * correction beats the reading, here as everywhere. So a number the AI misread
 * onto another PO and a person has since corrected stops standing in the way of
 * the PO it really belongs to.
 */
export async function duplicateCheckNoError(
  purchaseRequestId: string,
  checkNo: string,
  opts?: {
    /**
     * Storage paths on THIS PO whose own number should be ignored — the photo
     * being re-read, or the check whose number is being corrected. Without it a
     * check is reported as a duplicate of itself.
     */
    ignorePaths?: string[];
  },
): Promise<string | null> {
  if (!normalizeCheckNo(checkNo)) return null; // nothing to collide with

  const mine = await prisma.purchaseRequest.findUnique({
    where: { id: purchaseRequestId },
    select: { id: true, po: true, voucherCheckDocs: true },
  });
  if (!mine) return null; // the caller's own "not found" is the better error

  const all = await prisma.purchaseRequest.findMany({
    select: { id: true, po: true, status: true, voucherCheckDocs: true },
  });
  const onPos = otherPurchaseOrdersWithCheck(
    checkNo,
    { id: mine.id, poNumber: coercePurchaseOrder(mine.po)?.poNumber ?? null, batchId: poBatchId(mine.po) },
    all.map((o) => ({
      id: o.id,
      poNumber: coercePurchaseOrder(o.po)?.poNumber ?? null,
      batchId: poBatchId(o.po),
      status: o.status,
      checkNos: coerceCheckDocs(o.voucherCheckDocs).map((d) => effectiveCheckNo(d) ?? "").filter(Boolean),
    })),
  );
  const elsewhere = duplicateCheckRefusal(formatCheckNo(checkNo) ?? checkNo, onPos);
  if (elsewhere) return elsewhere;

  // …and the same number twice on THIS PO. Two photos on one PO are two checks,
  // so giving them one number is the same mistake at closer range — and
  // `otherPurchaseOrdersWithCheck` cannot see it, being asked only about OTHER
  // purchase orders.
  const ignore = new Set(opts?.ignorePaths ?? []);
  const clash = coerceCheckDocs(mine.voucherCheckDocs).some(
    (d) => !ignore.has(d.path) && normalizeCheckNo(effectiveCheckNo(d) ?? "") === normalizeCheckNo(checkNo),
  );
  return clash
    ? `Check No. ${formatCheckNo(checkNo) ?? checkNo} is already recorded on another photo attached to this same purchase order. Two photos are two checks, so they can't share a number — remove the wrong photo, or correct its number.`
    : null;
}
