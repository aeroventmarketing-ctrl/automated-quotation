/**
 * Deposit-slip / proof-of-payment validation stamps.
 *
 * When the AI "Read slip" runs (see `src/app/api/ai/read-deposit-slip`), it
 * records — per uploaded proof file (by storage path) — whether that proof is a
 * machine-validated bank slip or a computer-generated transfer proof, and the
 * date + amount it read from that machine/computer text. Handwritten-only proofs
 * are stamped `validated: false`.
 *
 * The stamp lives on the quotation `classification` under `slipValidations`, so
 * the save actions (recordSale, recordOrderPayment) can enforce the rule the
 * owner set: a payment backed by a non-validated slip may only be recorded by an
 * admin (override), and a validated slip's date + amount are authoritative — the
 * recorded payment always follows the machine/computer figures.
 */
import type { SalePayment } from "@/lib/sale";

export interface SlipValidation {
  path: string; // storage path of the proof this stamp is for
  validated: boolean; // machine-validated or computer-generated (not handwritten-only)
  date: string | null; // date read from the machine/computer text (YYYY-MM-DD)
  amount: number | null; // amount read from the machine/computer text
  reference?: string | null;
  bank?: string | null;
  readByName: string;
  readAt: string; // ISO
}

type Cls = Record<string, unknown>;

/** All slip-validation stamps on a classification, keyed by proof path. */
export function readSlipValidations(cls: Cls | null | undefined): Record<string, SlipValidation> {
  const raw = (cls as Cls | null)?.slipValidations;
  if (!raw || typeof raw !== "object") return {};
  const out: Record<string, SlipValidation> = {};
  for (const [path, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!v || typeof v !== "object") continue;
    const o = v as Record<string, unknown>;
    out[path] = {
      path,
      validated: o.validated === true,
      date: typeof o.date === "string" ? o.date : null,
      amount: typeof o.amount === "number" ? o.amount : null,
      reference: typeof o.reference === "string" ? o.reference : null,
      bank: typeof o.bank === "string" ? o.bank : null,
      readByName: String(o.readByName ?? ""),
      readAt: String(o.readAt ?? ""),
    };
  }
  return out;
}

/** The validation stamp for a given proof path, or null. */
export function slipValidationFor(cls: Cls | null | undefined, path: string | null | undefined): SlipValidation | null {
  if (!path) return null;
  return readSlipValidations(cls)[path] ?? null;
}

/**
 * Enforce the deposit-slip rule and normalise payment figures before a sale /
 * payment is saved.
 *
 * For every cash payment (a down / full / progress collection with an amount):
 *  - it MUST carry a machine-validated / computer-generated proof; a payment with
 *    no proof, or a non-validated proof, is **blocked** unless the user can
 *    validate (`canOverride` = admin / accounting);
 *  - a **validated** proof is authoritative for ordinary users: the payment's
 *    date + amount are overwritten with the machine/computer figures. But a
 *    validator (admin / accounting) keeps their own entered figures — so they can
 *    CORRECT a mis-read slip (e.g. a blurry photo the AI read wrong).
 *
 * Exemptions (never blocked, never altered):
 *  - **EWT withheld (BIR 2307)** — a tax withholding verified from the 2307 by
 *    the approver, not a cash collection, so manual entry is allowed;
 *  - **zero-amount** rows (nothing collected yet);
 *  - payments **already saved** before this feature (`grandfatheredIds`), so
 *    editing a legacy sale isn't blocked.
 *
 * Returns the (possibly adjusted) payments. Throws for a blocked ordinary user.
 */
export function applyPaymentSlipRules(
  cls: Cls | null | undefined,
  payments: SalePayment[],
  opts: { canOverride: boolean; grandfatheredIds?: Set<string> },
): SalePayment[] {
  const validations = readSlipValidations(cls);
  return payments.map((p) => {
    // EWT (BIR 2307) is a withholding verified from the 2307 by the approver —
    // not a cash collection. Allow manual entry, no proof / AI validation.
    if (p.kind === "ewt") return p;
    // Legacy payments saved before this feature are grandfathered.
    if (opts.grandfatheredIds?.has(p.id)) return p;
    const amount = Number(p.amount) || 0;
    if (amount <= 0) return p; // nothing collected yet
    // A validator (admin / accounting) always keeps their own figures — so they
    // can correct a mis-read slip, and aren't blocked by a missing/invalid one.
    if (opts.canOverride) return p;
    const v = p.proof?.path ? validations[p.proof.path] : undefined;
    if (v?.validated) {
      // For an ordinary user a validated slip is authoritative: follow it.
      return {
        ...p,
        amount: typeof v.amount === "number" ? v.amount : p.amount,
        date: v.date || p.date,
      };
    }
    // No proof, or a non-validated proof → blocked for an ordinary user.
    throw new Error(
      p.proof?.path
        ? `The proof "${p.proof.name}" couldn't be accepted as a machine-validated or computer-generated slip. Upload a valid proof — or ask an admin / accounting to record it.`
        : `This payment needs a machine-validated deposit slip or a computer-generated transfer proof attached before it can be recorded — or ask an admin / accounting to record it.`,
    );
  });
}
