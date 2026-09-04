/**
 * The photo of the CHECK issued for a PO's voucher.
 *
 * Owner's rules, in their words:
 *
 * > *"I would like accounting role to attach or upload picture of check in this
 * > location (right side of Print PO & 2307 button) for future reference."*
 *
 * > *"Should attaching a check be required before 'Voucher & Check Signed'? — It
 * > is required, but not a gate. Admin should be notified if not attached. Check
 * > is required for suppliers that give terms to us."*
 *
 * > *"Who can upload? — Accounting, Payment Approver and Admin."*
 *
 * So: **required, never blocking.** Nothing here refuses a step; the only
 * consequence of a missing check is that the PO is flagged and the people who can
 * fix it are told. A gate here would stop a supplier being paid because a photo
 * hadn't been taken yet, which is worse than the thing it prevents.
 *
 * Rides in `PurchaseRequest.voucherCheckDocs` (a JSON array). For a combined PO it
 * attaches to the anchor request — one check is written per PO, not per member
 * request.
 */
import type { PRStatus } from "@/lib/purchasing";
import { prMainIndex, statusBucket } from "@/lib/purchasing";

/**
 * What the AI reads off the face of the check. The owner's field map, in their
 * words, from the practice check:
 *
 * > *a. Account No. is 003718007033 · b. Account name is Aerovent Fans and
 * > Blowers Manufacturing · c. Check No. is 0000486722 · d. Pay to the order of
 * > is the supplier's name · e. Date 10-17-2026 is the date of check clearing ·
 * > f. Pesos sign is the amount in number · g. Pesos line is the amount in
 * > words.*
 *
 * Every field is nullable: a photo with glare over the date is still worth
 * keeping for the check number, and a half-read check must never be dressed up
 * as a whole one.
 */
export interface CheckRead {
  accountNo: string | null; // (a) OUR account the check is drawn on
  accountName: string | null; // (b) our company name printed on the check
  checkNo: string | null; // (c) the pre-printed check number
  payee: string | null; // (d) "Pay to the order of" — the supplier
  clearingYMD: string | null; // (e) the DATE box — when the check clears, not when it was written
  /**
   * The eight digits sitting in the DATE boxes, left to right, exactly as read —
   * "10042026". The date above is derived from these IN CODE, not by the model.
   *
   * Null on an older read (the field did not exist) or when the date is not in
   * eight boxes.
   */
  dateBoxes?: string | null;
  amount: number | null; // (f) the figure in the peso box
  amountWords: string | null; // (g) the amount spelled out on the PESOS line
  bank: string | null;
  confidence: number | null; // 0..1 — how sure of the exact digits
  warnings: string[];
  /**
   * What disagreed with the PO when the check was read (see `checkIssues`).
   * Stored rather than recomputed on every render: the duplicate-check-number
   * test needs every other PO's numbers, and the moment that matters is the
   * moment of reading — a check that duplicates one recorded LATER is not the
   * one at fault.
   */
  issues: CheckIssue[];
  readByName: string;
  readAt: string; // ISO
}

/**
 * The check's clearing date was moved — the owner's rule: *"If in case the check
 * cannot be cleared because of lack of funds, admin has the option to move the
 * check date to other date."*
 *
 * Kept as a LIST, not a single overwritten date. A check moved three times is a
 * supplier being put off three times, and that is exactly the thing worth being
 * able to see later. The original date read off the check is never touched — it
 * is what the check itself says.
 */
export interface CheckReschedule {
  from: string; // the clearing date it was moved off (YMD)
  to: string; // the new clearing date (YMD)
  reason: string;
  byName: string;
  at: string; // ISO
}

/** The bank cleared it. Recorded by a person, because only the bank knows. */
export interface CheckCleared {
  on: string; // YMD it actually cleared
  byName: string;
  at: string; // ISO
  note?: string;
}

/** One uploaded check photo. The file, who attached it, and what the AI read. */
export interface CheckDoc {
  path: string; // storage path under `purchases/<prId>/…`
  name: string; // original file name
  uploadedAt: string; // ISO
  uploadedByName: string;
  /** Absent until the AI has read it (or if the read failed). */
  read?: CheckRead;
  /** Every time the clearing date was moved, oldest first. */
  reschedules?: CheckReschedule[];
  /** Set once the bank has cleared it — moves the check to the Cleared tab. */
  cleared?: CheckCleared;
}

/**
 * The date this check is expected to clear: the latest rescheduled date if it has
 * been moved, otherwise the date printed on the check itself.
 *
 * Null when the check was never read, or the read couldn't make out the date —
 * an undated check can't be monitored, and saying so is better than assuming a
 * date nobody wrote down.
 */
/**
 * The clearing date, read off the eight DATE boxes as **MM DD YYYY**.
 *
 * The owner: *"date error in check reading. When reading check date, 10-04-2026
 * means October 4, 2026."* The check itself settles it — the guide letters
 * `M M  D D  Y Y Y Y` are printed under the boxes — but a model asked for "the
 * date" will happily read `10 04 2026` as the 10th of April, and did.
 *
 * So the model is no longer asked to work out the date at all: it transcribes
 * the eight digits, and the order is applied here, where it is a rule rather
 * than a judgement. `1 0 0 4 2 0 2 6` → `2026-10-04`, every time.
 *
 * Null if the digits aren't eight, or don't spell a real day (month 13, or the
 * 31st of February) — a date nobody can defend is worse than no date.
 */
export function clearingFromDateBoxes(digits: string | null | undefined): string | null {
  if (!digits) return null;
  const d = digits.replace(/\D/g, "");
  if (d.length !== 8) return null;
  const [mm, dd, yyyy] = [d.slice(0, 2), d.slice(2, 4), d.slice(4)];
  const [m, day, y] = [Number(mm), Number(dd), Number(yyyy)];
  if (m < 1 || m > 12 || day < 1 || day > 31) return null;
  if (y < 2000 || y > 2100) return null; // a company check, not an heirloom
  // Rejects 02-31 and friends: round-tripping through a real date catches them.
  const dt = new Date(Date.UTC(y, m - 1, day));
  if (dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== day) return null;
  return `${yyyy}-${mm}-${dd}`;
}

export function effectiveClearingYMD(doc: CheckDoc): string | null {
  const moved = doc.reschedules?.length ? doc.reschedules[doc.reschedules.length - 1].to : null;
  return moved ?? doc.read?.clearingYMD ?? null;
}

function coerceRead(v: unknown): CheckRead | undefined {
  if (!v || typeof v !== "object") return undefined;
  const o = v as Record<string, unknown>;
  const str = (k: string) => (typeof o[k] === "string" && o[k] ? (o[k] as string) : null);
  return {
    accountNo: str("accountNo"),
    accountName: str("accountName"),
    checkNo: str("checkNo"),
    payee: str("payee"),
    clearingYMD: str("clearingYMD"),
    dateBoxes: str("dateBoxes"),
    amount: typeof o.amount === "number" && Number.isFinite(o.amount) ? o.amount : null,
    amountWords: str("amountWords"),
    bank: str("bank"),
    confidence: typeof o.confidence === "number" ? o.confidence : null,
    warnings: Array.isArray(o.warnings) ? o.warnings.filter((w): w is string => typeof w === "string") : [],
    issues: Array.isArray(o.issues)
      ? (o.issues as unknown[]).flatMap((i) => {
          if (!i || typeof i !== "object") return [];
          const io = i as Record<string, unknown>;
          return typeof io.message === "string" ? [{ key: (io.key as CheckIssue["key"]) ?? "unread", message: io.message }] : [];
        })
      : [],
    readByName: typeof o.readByName === "string" ? o.readByName : "",
    readAt: typeof o.readAt === "string" ? o.readAt : "",
  };
}

function coerceReschedules(v: unknown): CheckReschedule[] {
  if (!Array.isArray(v)) return [];
  return v.flatMap((x) => {
    if (!x || typeof x !== "object") return [];
    const o = x as Record<string, unknown>;
    const str = (k: string) => (typeof o[k] === "string" ? (o[k] as string) : "");
    if (!str("to")) return []; // a reschedule with no new date says nothing
    return [{ from: str("from"), to: str("to"), reason: str("reason"), byName: str("byName"), at: str("at") }];
  });
}

function coerceCleared(v: unknown): CheckCleared | undefined {
  if (!v || typeof v !== "object") return undefined;
  const o = v as Record<string, unknown>;
  const str = (k: string) => (typeof o[k] === "string" ? (o[k] as string) : "");
  if (!str("on")) return undefined;
  return { on: str("on"), byName: str("byName"), at: str("at"), ...(str("note") ? { note: str("note") } : {}) };
}

export function coerceCheckDoc(v: unknown): CheckDoc | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  if (typeof o.path !== "string" || !o.path) return null;
  const read = coerceRead(o.read);
  const reschedules = coerceReschedules(o.reschedules);
  const cleared = coerceCleared(o.cleared);
  return {
    path: o.path,
    name: typeof o.name === "string" && o.name ? o.name : "check",
    uploadedAt: typeof o.uploadedAt === "string" ? o.uploadedAt : "",
    uploadedByName: typeof o.uploadedByName === "string" ? o.uploadedByName : "",
    ...(read ? { read } : {}),
    ...(reschedules.length ? { reschedules } : {}),
    ...(cleared ? { cleared } : {}),
  };
}

/**
 * Every check number read off this PO's photos, in upload order — each in BOTH
 * the form it was read and the canonical 10-digit form.
 *
 * Both, because this feeds the Purchasing search box: someone reading the
 * printed check types `0000486625`, someone reading the register types `486625`,
 * and each has to find the same PO.
 */
export function checkNumbers(docs: CheckDoc[]): string[] {
  const out: string[] = [];
  for (const d of docs) {
    const raw = d.read?.checkNo;
    if (!raw) continue;
    out.push(raw);
    const canonical = formatCheckNo(raw);
    if (canonical && canonical !== raw) out.push(canonical);
  }
  return out;
}

/**
 * How many digits a check number carries on our bank's checks, leading zeros
 * included — the owner's rule: *"In the file I sent you is 6 digit check number
 * with 0000 before the first number. We will be using the 10 digit check number
 * from now on."*
 *
 * Their hand-kept register abbreviates to the six significant digits (486625);
 * the check itself reads 0000486625. Ten is the canonical form.
 */
export const CHECK_NO_DIGITS = 10;

/**
 * A check number as it should be SHOWN: the canonical 10-digit form.
 *
 * Padding is applied only to a plain run of digits shorter than ten — the case
 * where the printed zeros were dropped, by the reader or by a person typing the
 * short form. Anything longer, or carrying non-digits, is left exactly as it
 * came: a number that doesn't fit the pattern is more likely a misread than
 * something to pad into looking correct.
 */
export function formatCheckNo(no: string | null | undefined): string | null {
  if (!no) return null;
  const trimmed = no.trim();
  if (!/^\d+$/.test(trimmed)) return trimmed;
  return trimmed.length >= CHECK_NO_DIGITS ? trimmed : trimmed.padStart(CHECK_NO_DIGITS, "0");
}

/**
 * A check number reduced to what actually identifies it: digits only, leading
 * zeros dropped.
 *
 * The zeros are padding in a fixed-width printed field, not part of the number —
 * "0000486722" and "486722" are the same check, and for a duplicate WARNING it
 * is far better to ask about two that turn out to be different than to miss two
 * that are the same. The number is still displayed and searched exactly as
 * printed; only the comparison is loosened.
 */
export const normalizeCheckNo = (no: string): string => no.replace(/\D/g, "").replace(/^0+(?=\d)/, "");

export function coerceCheckDocs(v: unknown): CheckDoc[] {
  if (!Array.isArray(v)) return [];
  return v.map(coerceCheckDoc).filter((d): d is CheckDoc => d !== null);
}

/**
 * Who may attach or remove a check photo: **Accounting, the Payment Approver, and
 * an admin** — the owner's answer, exactly. The Purchaser is not on the list: they
 * carry the cash, they do not write the check.
 */
export function canAttachCheck(opts: { admin: boolean; workflowRoles: string[] }): boolean {
  return opts.admin || opts.workflowRoles.includes("accounting") || opts.workflowRoles.includes("payment_approver");
}

/**
 * The status from which a check is expected to exist. The check is written as
 * part of *Voucher & Check Prepared* and signed at *Voucher & Check Signed*, so a
 * PO that has reached VOUCHER_SIGNED should have its photo.
 *
 * Before that there is nothing to photograph, and flagging it would train everyone
 * to ignore the flag.
 */
export const CHECK_EXPECTED_FROM: PRStatus = "VOUCHER_SIGNED";

/**
 * Is a check photo expected on this PO at all?
 *
 * Two conditions, both the owner's: the supplier **gives us terms** (we pay later,
 * by check — a cash purchase has no check to photograph), and the PO has reached
 * the point where the check exists. A cancelled or rejected PO is never chased.
 */
export function checkExpected(opts: { supplierGivesTerms: boolean; status: PRStatus }): boolean {
  if (!opts.supplierGivesTerms) return false;
  if (opts.status === "CANCELLED" || opts.status === "REJECTED") return false;
  return prMainIndex(opts.status) >= prMainIndex(CHECK_EXPECTED_FROM);
}

/**
 * May a check be attached, replaced, removed or re-read on this PO *right now*?
 *
 * The owner's rule: *"attaching check must be active only on purchasing budgeted
 * tab. Hide or disable check uploading in pending, approved, cancelled and
 * rejected. Checks can always be viewed in completed department PO but uploading
 * is disabled."*
 *
 * Expressed here as a window on the PO's own STATUS rather than on which tab it
 * is being rendered in, for two reasons. The **All** tab shows every status at
 * once and a tab-based rule has no answer there; and the Completed department
 * section is not a tab at all, so a tab-based rule could not cover it either. The
 * tabs are a filter over statuses, so a status rule reproduces the owner's list
 * exactly and stays right everywhere a PO appears.
 *
 * The window is the *Budgeted* bucket **minus COMPLETED**:
 *
 * | | |
 * | --- | --- |
 * | Pending, Approved (before the check is signed) | ✗ — there is no check yet |
 * | Rejected, Cancelled | ✗ — no money moved |
 * | **VOUCHER_SIGNED → PLANT_APPROVED** (Budgeted) | **✓** |
 * | COMPLETED | ✗ — view only, wherever it shows: the Budgeted tab, All, or the Completed department section |
 *
 * COMPLETED sits in the Budgeted bucket, so "only on the budgeted tab" and
 * "completed is view-only" would contradict each other unless COMPLETED is
 * excluded — which is what the owner asked for, and the PO they were looking at
 * when they asked was a completed one.
 */
export function checkAttachableAt(status: PRStatus, ctx?: { isDept?: boolean; poApproved?: boolean }): boolean {
  if (status === "COMPLETED") return false;
  if (statusBucket(status, ctx) !== "approved") return false;
  return prMainIndex(status) >= prMainIndex(CHECK_EXPECTED_FROM);
}

/** Expected, and not there — the condition the amber badge and the notification key on. */
export function checkMissing(opts: { supplierGivesTerms: boolean; status: PRStatus; docs: CheckDoc[] }): boolean {
  return checkExpected(opts) && opts.docs.length === 0;
}

// --- Checking the read against what we already know --------------------------
//
// The AI is a reader, not an authority. Everything it returns is cross-examined
// against something the system already holds — our own account name, the PO's
// supplier, the PO's net amount, the amount spelled out on the check itself, and
// every check number already recorded. A mismatch is REPORTED, never enforced:
// the owner's rule is that the check is required but is not a gate, and a
// misread photo must not be able to stop a payment.

/**
 * Loose company-name match: case, punctuation, spacing and the legal-form suffix
 * ignored.
 *
 * `&` becomes `AND` BEFORE punctuation is stripped — our own name is
 * *"AEROVENT FANS & BLOWERS MANUFACTURING"* and the bank prints
 * *"AEROVENT FANS AND BLOWERS MANUFACTURING"*, so without this every one of our
 * own checks would be reported as drawn on someone else's account.
 *
 * Only the legal form is dropped (INC / CORP / CO / LTD and their long forms) —
 * NOT words like "TRADING" or "ENTERPRISES", which are part of what tells two
 * suppliers apart. Containment counts as a match only for names long enough for
 * it to mean something.
 */
export function sameCompany(a: string | null | undefined, b: string | null | undefined): boolean {
  const norm = (s: string) =>
    s
      .toUpperCase()
      .replace(/&/g, " AND ")
      .replace(/\b(INCORPORATED|CORPORATION|COMPANY|INC|CORP|CO|LTD)\b/g, " ")
      .replace(/[^A-Z0-9]/g, "");
  if (!a || !b) return false;
  const [x, y] = [norm(a), norm(b)];
  if (!x || !y) return false;
  if (x === y) return true;
  const [short, long] = x.length <= y.length ? [x, y] : [y, x];
  return short.length >= 6 && long.includes(short);
}

/**
 * Words as written on a check, reduced to what they actually say: case, hyphens
 * and spacing ignored, along with "PESOS" / "ONLY" and a ZERO-centavo tail.
 *
 * That last one matters. Our speller writes a whole amount as
 * "TWO THOUSAND ONE HUNDRED EIGHTY" with no tail, but a check ALWAYS closes the
 * line, because a blank there is where a fraud gets written in. The owner's
 * house style is the word **ONLY** — *"per 00/100 we use the words 'only' in
 * check"* — while other banks and check printers write "AND 00/100" or "AND
 * NO/100". All of them mean zero centavos, so all of them are dropped, or every
 * check for a round peso amount would be reported as disagreeing with its own
 * figure.
 *
 * A NON-zero tail is kept: "AND 54/100" is part of the amount, and a check whose
 * words say "…SIXTY PESOS ONLY" for ₱2,160.54 is genuinely wrong.
 */
const normWords = (s: string) =>
  s
    .toUpperCase()
    .replace(/\bAND\s*(?:NO|0+)\s*\/\s*100\b/g, " ")
    .replace(/\bPESOS?\b|\bONLY\b/g, " ")
    .replace(/[^A-Z0-9]/g, "");

/** Do the amount in figures and the amount in words agree? */
export function amountMatchesWords(amount: number | null, words: string | null, inWords: (n: number) => string): boolean {
  if (amount == null || !words) return false;
  return normWords(inWords(amount)) === normWords(words);
}

/** Pesos as a person reads them, for a warning line they are meant to act on. */
const peso = (n: number) => `₱${n.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export interface CheckIssue {
  key: "payee" | "amount" | "words" | "account" | "duplicate" | "unread" | "confidence";
  message: string;
}

/**
 * Everything wrong with a check photo, given what the PO says it should be.
 * An empty list means the read agrees with the PO on every point we can test.
 */
export function checkIssues(opts: {
  read: CheckRead | undefined;
  supplierCompany: string;
  /**
   * The PO's NET amount — what the check is actually written for.
   *
   * NET, not the gross total: where the supplier is EWT-capable we withhold the
   * EWT and remit it to the BIR ourselves, so the check is written for the
   * remainder and the supplier gets a BIR 2307 for the difference. The owner
   * confirmed this directly — on a PO reading "₱2,180.00 · Net ₱2,160.54" the
   * check is for ₱2,160.54. Where a supplier is not EWT-capable the two figures
   * are identical, so this is the correct comparison either way.
   *
   * It is the same `poTotals(po).net` the PO card prints, so the number the
   * check is judged against is always the number on screen beside it.
   */
  netAmount: number;
  /** Our own company name, from config. */
  ourCompany: string;
  /** Check numbers already recorded on OTHER purchase orders. */
  usedCheckNos?: string[];
  inWords: (n: number) => string;
}): CheckIssue[] {
  const r = opts.read;
  if (!r) return [{ key: "unread", message: "The check hasn't been read yet." }];
  const issues: CheckIssue[] = [];

  if (typeof r.confidence === "number" && r.confidence < 0.7) {
    issues.push({ key: "confidence", message: "The photo is unclear — check the figures against the check itself." });
  }
  // (b) The account name is OURS. A check drawn on someone else's account
  // attached to our PO is either the wrong photo or something worse.
  if (r.accountName && !sameCompany(r.accountName, opts.ourCompany)) {
    issues.push({ key: "account", message: `Account name reads "${r.accountName}" — not ${opts.ourCompany}.` });
  }
  // (d) Pay to the order of = this PO's supplier.
  if (r.payee && !sameCompany(r.payee, opts.supplierCompany)) {
    issues.push({ key: "payee", message: `Paid to "${r.payee}" but this PO is to ${opts.supplierCompany}.` });
  }
  // (f) The figure against the PO's net.
  if (r.amount != null && opts.netAmount > 0 && Math.abs(r.amount - opts.netAmount) > 0.01) {
    issues.push({ key: "amount", message: `Check is for ${peso(r.amount)} but this PO's net is ${peso(opts.netAmount)}.` });
  }
  // (g) The check's own self-check: figures against words.
  if (r.amount != null && r.amountWords && !amountMatchesWords(r.amount, r.amountWords, opts.inWords)) {
    issues.push({ key: "words", message: `The amount in words doesn't match the figure — "${r.amountWords}".` });
  }
  // (c) The same check number must not already be recorded elsewhere.
  if (r.checkNo) {
    const mine = normalizeCheckNo(r.checkNo);
    if (mine && (opts.usedCheckNos ?? []).some((n) => normalizeCheckNo(n) === mine)) {
      issues.push({ key: "duplicate", message: `Check No. ${formatCheckNo(r.checkNo)} is already recorded on another purchase order.` });
    }
  }
  return issues;
}
