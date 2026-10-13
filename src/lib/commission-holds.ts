/**
 * Commission rules 7 & 8 — the two conditions the owner added on 2026-10-13:
 *
 *   7. *"Add [step 19 — Accounting files all delivery documents and presses
 *      'File Documents-Close Order'] in the criteria for release of commission"*
 *   8. *"There must be an uploaded 2303 in the client details to be able to
 *      receive commission"* — for VAT Inclusive, VAT Exclusive +12% and Zero
 *      Rated orders.
 *
 * Pure (types only), so the Commissions page and the order card can say WHY a
 * commission is held with the same words the engine used to hold it.
 */
import type { CommissionDeal } from "@/lib/sales-commission";

/**
 * The VAT presentations whose commission needs the client's 2303 on file. The
 * owner: the 2303 is required "for VAT Inclusive, VAT Exclusive +12% and Zero
 * rated transaction" — so a VAT Exclusive (÷1.12) order is the one that doesn't.
 */
const VAT_MODES_NEEDING_2303 = new Set(["INCLUSIVE", "EXCLUSIVE_PLUS", "ZERO_RATED"]);
export const orderNeeds2303 = (vatMode: string): boolean => VAT_MODES_NEEDING_2303.has(vatMode);

/** What is holding an otherwise-earned commission back, in words. Empty = nothing. */
export function commissionHolds(d: Pick<CommissionDeal, "filed" | "has2303">): string[] {
  const out: string[] = [];
  if (d.filed === false) out.push("Documents not yet filed (File Documents-Close Order)");
  if (d.has2303 === false) out.push("Client's BIR 2303 not uploaded");
  return out;
}

/**
 * The day every release condition was met — the LAST of full payment, filing
 * and the 2303 upload (each only where it applies) — or null while one is
 * missing. The release date is rule 4's next 15th/30th on or after this.
 */
export function commissionReadyYMD(d: Pick<CommissionDeal, "fullyPaidYMD" | "filed" | "filedYMD" | "has2303" | "bir2303YMD">): string | null {
  if (!d.fullyPaidYMD || commissionHolds(d).length > 0) return null;
  return [d.fullyPaidYMD, d.filed ? d.filedYMD : null, d.has2303 ? d.bir2303YMD : null]
    .filter((x): x is string => !!x)
    .sort()
    .at(-1)!;
}

