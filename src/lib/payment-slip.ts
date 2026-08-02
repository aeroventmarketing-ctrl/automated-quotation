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
 * For every payment that carries a proof file:
 *  - if the proof has a **validated** stamp, the payment's date + amount are
 *    overwritten with the machine/computer figures (the recorded payment always
 *    follows the slip);
 *  - otherwise (the proof is handwritten / not machine-validated / could not be
 *    read), a non-admin is **blocked** with a clear error, unless the proof was
 *    already saved before (grandfathered) — an admin may always proceed (manual
 *    override).
 *
 * `grandfatheredPaths` are proof paths already persisted on the sale, so editing
 * a legacy sale (saved before this feature) isn't blocked; only newly uploaded
 * proofs must be validated.
 *
 * Returns the (possibly adjusted) payments. Throws for a blocked non-admin.
 */
export function applyPaymentSlipRules(
  cls: Cls | null | undefined,
  payments: SalePayment[],
  opts: { isAdmin: boolean; grandfatheredPaths?: Set<string> },
): SalePayment[] {
  const validations = readSlipValidations(cls);
  return payments.map((p) => {
    if (!p.proof?.path) return p;
    const v = validations[p.proof.path];
    if (v?.validated) {
      // A validated slip is authoritative: follow its date + amount.
      return {
        ...p,
        amount: typeof v.amount === "number" ? v.amount : p.amount,
        date: v.date || p.date,
      };
    }
    // Not validated (handwritten / unreadable / never read). Grandfather proofs
    // already saved before this feature so legacy edits aren't blocked.
    if (opts.grandfatheredPaths?.has(p.proof.path)) return p;
    if (!opts.isAdmin) {
      throw new Error(
        `The proof "${p.proof.name}" couldn't be accepted as a machine-validated or computer-generated slip. Upload a machine-validated deposit slip or a computer-generated transfer proof — or ask an admin to record it manually.`,
      );
    }
    return p; // admin override — keep the manually-entered figures
  });
}
