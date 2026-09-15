/**
 * Proof of payment for a commission payout — the deposit slip or transfer
 * screenshot — and who may attach it, who may open it.
 *
 * The owner: *"add an option to attach proof of payment to sales personnel for
 * accounting, payment approver and admin. Proof of payment must be viewable by
 * sales account holder."*
 *
 * ## The three pairs of hands on one row
 *
 * A commission row now records three separate statements, each written by a
 * different person, which is what makes the set of them worth anything:
 *
 *   `paid` / `paidByName`     Accounting: we released it
 *   `paymentProof`            Accounting / Approver / admin: here is the slip
 *   `receivedAt` / …          the salesperson: it reached me
 *
 * The middle one closes the gap between the other two. Before it, a payee who had
 * not been paid could only say so; now they can see what was sent, and the
 * argument is about a document rather than a memory.
 *
 * ## Viewing is not a role
 *
 * Attaching is a job — three seats hold it. Opening is a relationship: the
 * salesperson sees the proof of their OWN payment, because the whole point is
 * that the person owed the money can check it. They see nobody else's.
 */

export interface CommissionProofDoc {
  /** Supabase Storage path — always `commissions/<salespersonId>/…`. */
  path: string;
  /** The file's original name, for the link text and the download. */
  name: string;
  uploadedAt: string;
  uploadedById: string;
  uploadedByName: string;
}

/** How many files one payout may carry. A slip and a screenshot, not an album. */
export const MAX_PROOF_DOCS = 5;

/** Read the stored JSON into documents, dropping anything malformed. */
export function coerceProofDocs(v: unknown): CommissionProofDoc[] {
  if (!Array.isArray(v)) return [];
  return v.flatMap((raw) => {
    if (!raw || typeof raw !== "object") return [];
    const d = raw as Record<string, unknown>;
    if (typeof d.path !== "string" || !d.path) return [];
    return [{
      path: d.path,
      name: typeof d.name === "string" && d.name ? d.name : "proof",
      uploadedAt: typeof d.uploadedAt === "string" ? d.uploadedAt : "",
      uploadedById: typeof d.uploadedById === "string" ? d.uploadedById : "",
      uploadedByName: typeof d.uploadedByName === "string" ? d.uploadedByName : "",
    }];
  });
}

/**
 * The storage path a payout's proof lives under. The salesperson's id is IN the
 * path on purpose: the route that serves the file can then answer "is this the
 * payee?" from the path alone, without trusting anything the caller sent.
 */
export function proofPathPrefix(salespersonId: string): string {
  return `commissions/${salespersonId}/`;
}

/** Whose payout a stored proof belongs to, or null if the path isn't one. */
export function salespersonIdFromProofPath(path: string): string | null {
  const m = /^commissions\/([^/]+)\//.exec(path);
  return m ? m[1] : null;
}

/** Attaching and removing: the three seats the owner named. */
export function canAttachCommissionProof(opts: { admin: boolean; workflowRoles: readonly string[] }): boolean {
  return opts.admin || opts.workflowRoles.includes("accounting") || opts.workflowRoles.includes("payment_approver");
}

/**
 * Opening a stored proof: the three seats above, **or the person it pays**.
 *
 * Takes the path rather than a salesperson id so the caller cannot get the
 * comparison wrong — the answer is derived from where the file actually lives.
 */
export function canViewCommissionProof(
  viewer: { id: string; admin: boolean; workflowRoles: readonly string[] },
  path: string,
): boolean {
  if (canAttachCommissionProof(viewer)) return true;
  const payee = salespersonIdFromProofPath(path);
  return payee != null && payee === viewer.id;
}

/** The parts of a commission the attach rule reads. */
export interface ProofTarget {
  salespersonId: string;
  paid: boolean;
  receivedAt?: string | null;
  /** The payout is released or about to be — `canMarkPaid` at the call site. */
  payableNow: boolean;
}

/**
 * Which of a salesperson's commissions a proof attaches to: **the payout they
 * are in the middle of**.
 *
 * That is everything of theirs that is released, or about to be, and that they
 * have not yet signed for. Accounting attaches the slip either side of pressing
 * "Mark voucher paid" — before it while the voucher is being prepared, after it
 * while the payee is being chased — and both land on the same set.
 *
 * A row the payee has already confirmed is finished, and is left alone: the proof
 * of a payout that is already acknowledged would be evidence for an argument
 * nobody is having, and attaching to it would let a later payment's slip land on
 * an earlier payment's row.
 */
export function proofTargets<T extends ProofTarget>(salespersonId: string, deals: readonly T[]): T[] {
  return deals.filter((d) => d.salespersonId === salespersonId && !d.receivedAt && (d.paid || d.payableNow));
}
