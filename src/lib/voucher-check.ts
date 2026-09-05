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
import { AI_CHECK_READ_LIMIT } from "@/lib/ai/limits";

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
  /**
   * (f) the amount the check is for — `amountFromWords ?? amountFigures`.
   *
   * The written line wins, because that is what a bank pays when the two halves
   * of a check disagree. This is the figure the register and the cash position
   * quote.
   */
  amount: number | null;
  /** (f) the PESO BOX on its own, as read. Null if the photo didn't give it up. */
  amountFigures?: number | null;
  /** (g) the PESOS LINE on its own, read back as a number. Null if unparseable. */
  amountFromWords?: number | null;
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

/**
 * A person read the check and corrected the date the AI got wrong.
 *
 * NOT a reschedule. The two look the same on a form and mean opposite things:
 *
 *  - a **reschedule** says the check is dated the 12th of July and we are asking
 *    the supplier to hold it until October — history worth keeping, and the
 *    register says "moved from Jul 12" for as long as the check exists;
 *  - a **correction** says the check was ALWAYS dated the 17th of October and the
 *    reading was wrong. There is no "moved from", because nothing moved.
 *
 * With only one button, correcting a misread left the register announcing a
 * reschedule that never happened — the owner, having corrected 12 July to 17
 * October, still saw *"moved from Jul 12, 2026"* in amber under the right date.
 */
export interface CheckDateFix {
  ymd: string; // what the check actually says
  /** What the reading had claimed, kept so the misread is still auditable. */
  was: string | null;
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
  /**
   * How many AI reads THIS photo has cost a limited reader — see
   * `checkReadsUsed`. Absent on a photo read before the counter existed.
   */
  readCount?: number;
  /**
   * Why the last read FAILED, when one was attempted and did not produce a
   * `read`.
   *
   * A failed read used to leave nothing behind: the error was handed to the
   * browser, and the moment the page moved on, "Check number not read" meant
   * both *"the AI couldn't"* and *"nobody has pressed the button"*. Cleared on
   * the next successful read.
   */
  readError?: { message: string; at: string; byName: string };
  /**
   * A person corrected the date the read got wrong. Beats the read, loses to a
   * reschedule — see `effectiveClearingYMD`.
   */
  dateFix?: CheckDateFix;
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

/**
 * What the CHECK ITSELF says, as best anyone knows — a person's correction if
 * one was made, otherwise the date the read produced.
 *
 * A correction beats the read because the person had the paper in front of them.
 * It survives a later re-read for the same reason: if the model comes back with
 * a third answer, the eyes win.
 */
export function printedClearingYMD(doc: CheckDoc): string | null {
  return doc.dateFix?.ymd ?? doc.read?.clearingYMD ?? null;
}

export function effectiveClearingYMD(doc: CheckDoc): string | null {
  const moved = doc.reschedules?.length ? doc.reschedules[doc.reschedules.length - 1].to : null;
  return moved ?? printedClearingYMD(doc);
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
    amountFigures: typeof o.amountFigures === "number" && Number.isFinite(o.amountFigures) ? o.amountFigures : null,
    amountFromWords: typeof o.amountFromWords === "number" && Number.isFinite(o.amountFromWords) ? o.amountFromWords : null,
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

/** A real calendar day written YYYY-MM-DD. */
export function isClearingYMD(s: unknown): s is string {
  if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

function coerceDateFix(v: unknown): CheckDateFix | undefined {
  if (!v || typeof v !== "object") return undefined;
  const o = v as Record<string, unknown>;
  const str = (k: string) => (typeof o[k] === "string" ? (o[k] as string) : "");
  // A correction with no date corrects nothing, and one that isn't a real day
  // would poison the register's sort — drop it rather than carry it.
  if (!isClearingYMD(str("ymd"))) return undefined;
  return { ymd: str("ymd"), was: str("was") || null, byName: str("byName"), at: str("at") };
}

function coerceCleared(v: unknown): CheckCleared | undefined {
  if (!v || typeof v !== "object") return undefined;
  const o = v as Record<string, unknown>;
  const str = (k: string) => (typeof o[k] === "string" ? (o[k] as string) : "");
  if (!str("on")) return undefined;
  return { on: str("on"), byName: str("byName"), at: str("at"), ...(str("note") ? { note: str("note") } : {}) };
}

function coerceReadError(v: unknown): CheckDoc["readError"] | undefined {
  if (!v || typeof v !== "object") return undefined;
  const o = v as Record<string, unknown>;
  const str = (k: string) => (typeof o[k] === "string" ? (o[k] as string) : "");
  if (!str("message")) return undefined;
  return { message: str("message"), at: str("at"), byName: str("byName") };
}

export function coerceCheckDoc(v: unknown): CheckDoc | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  if (typeof o.path !== "string" || !o.path) return null;
  const read = coerceRead(o.read);
  const dateFix = coerceDateFix(o.dateFix);
  const reschedules = coerceReschedules(o.reschedules);
  const cleared = coerceCleared(o.cleared);
  const readError = coerceReadError(o.readError);
  return {
    path: o.path,
    name: typeof o.name === "string" && o.name ? o.name : "check",
    uploadedAt: typeof o.uploadedAt === "string" ? o.uploadedAt : "",
    uploadedByName: typeof o.uploadedByName === "string" ? o.uploadedByName : "",
    ...(read ? { read } : {}),
    // Kept even when it is 0 — see `nextCheckReadCount`: the zero is what says
    // "an admin read this, and it cost nobody a try".
    ...(typeof o.readCount === "number" && Number.isFinite(o.readCount)
      ? { readCount: Math.max(0, Math.floor(o.readCount)) }
      : {}),
    ...(readError ? { readError } : {}),
    ...(dateFix ? { dateFix } : {}),
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
 * | COMPLETED | ✗ for Accounting · **✓ for an admin or the Payment Approver** |
 *
 * COMPLETED sits in the Budgeted bucket, so "only on the budgeted tab" and
 * "completed is view-only" would contradict each other unless COMPLETED is
 * excluded — which is what the owner asked for, and the PO they were looking at
 * when they asked was a completed one.
 *
 * They later reopened that one corner, for two people only: *"allow admin and
 * payment approver to attach copy of check."* They had just deleted a wrongly
 * read photo off a completed PO and found no way to put the right one back.
 */
/**
 * The two people whose reach over a check outlives the Budgeted window.
 *
 * The owner opened this one step at a time, each time on a completed PO where
 * the control they needed had gone: *"Admin may re-read anytime"*, then *"add an
 * option to delete the uploaded file"*, then *"allow admin and payment approver
 * to attach copy of check."*
 */
export interface CheckActor {
  admin?: boolean;
  paymentApprover?: boolean;
  /** Holds the Accounting workflow role — the people who handle checks daily. */
  accounting?: boolean;
}

/**
 * The span in which a check exists at all: signed, and not thrown away.
 *
 * Everything below starts here, and NOTHING widens it. Pending, Approved,
 * Rejected and Cancelled stay shut for every actor including an admin: no check
 * has been signed yet, or ever will be, so a control there could only record a
 * payment that does not exist.
 */
const signedSpan = (status: PRStatus, ctx?: { isDept?: boolean; poApproved?: boolean }): boolean =>
  statusBucket(status, ctx) === "approved" && prMainIndex(status) >= prMainIndex(CHECK_EXPECTED_FROM);

export function checkReadableAt(
  status: PRStatus,
  ctx?: { isDept?: boolean; poApproved?: boolean },
  opts?: CheckActor,
): boolean {
  // An admin, at any stage. Reading a check moves no money and advances no
  // step — it fills in what the photo already says. Sharing the ATTACH window
  // meant a check that failed to read before its PO completed could never be
  // read at all, which is how two TKL checks ended up stranded reading
  // "Check number not read" with no button left to try again.
  //
  // The owner approved exactly this: *"Admin may re-read anytime"* — and later,
  // on the same grounds, deleting (see `checkRemovableAt`). ATTACHING is the one
  // that stays shut: their ruling was that uploading stops at Budgeted.
  if (opts?.admin) return true;
  return checkAttachableAt(status, ctx, opts);
}

/**
 * May this check photo be DELETED?
 *
 * Same shape as reading, different reason. The owner asked for it looking at a
 * completed PO whose check had been read wrongly: *"add an option to delete the
 * uploaded file."* Attaching is what their earlier ruling closed at COMPLETED —
 * so a wrong photo on a finished PO was permanent, which is a worse record than
 * no photo.
 *
 * Kept separate from `checkReadableAt` on purpose, though the two agree today:
 * re-reading is harmless and deleting destroys the only copy of what was
 * attached, so they should be free to diverge without one silently dragging the
 * other with it.
 */
export function checkRemovableAt(
  status: PRStatus,
  ctx?: { isDept?: boolean; poApproved?: boolean },
  opts?: CheckActor,
): boolean {
  if (opts?.admin) return true;
  if (!signedSpan(status, ctx)) return false;
  if (status !== "COMPLETED") return true;
  // On a COMPLETED PO this deliberately parts company with attaching. The owner
  // opened attaching to Accounting and kept deleting back: *"Attach only, not
  // delete."* Putting the right photo on is a correction; removing the only copy
  // of one from a finished PO is the destructive half, and stays with the two
  // who sign for the money.
  return !!opts?.paymentApprover;
}

export function checkAttachableAt(
  status: PRStatus,
  ctx?: { isDept?: boolean; poApproved?: boolean },
  actor?: CheckActor,
): boolean {
  if (!signedSpan(status, ctx)) return false;
  if (status !== "COMPLETED") return true;
  // COMPLETED is the corner the owner reopened, in two goes: first *"allow admin
  // and payment approver to attach copy of check"*, then Accounting as well
  // once the harness showed them stopped there — they are the role that handles
  // the checks daily, so the restriction mostly made work for the owner.
  //
  // Every OTHER role still sees a completed PO's check and cannot touch it.
  return !!actor?.admin || !!actor?.paymentApprover || !!actor?.accounting;
}

// --- How many AI reads one photo is worth ------------------------------------
//
// The owner: *"In AI reading allow 3 tries in every row or every attachment.
// … Admin/payment approved still allowed unlimited number of tries."*
//
// PER ATTACHMENT is the change. The allowance used to be per PURCHASE ORDER and
// counted photos-that-had-been-read rather than reads, so it did two wrong
// things at once: a PO paid by two checks spent its budget on the first photo
// and left the second unreadable by the person who attached it, while a single
// photo could be re-read forever. A try is now a read, and a photo is what has
// three of them.

/**
 * Who is never counted: the two who sign for the money.
 *
 * The same pair that may read a check outside the Budgeted window at all. The
 * limit exists to stop someone pressing a button until they like the answer;
 * these two are the ones a person appeals TO when it runs out, so a limit on
 * them would have no one behind it.
 */
export function hasUnlimitedCheckReads(actor?: CheckActor): boolean {
  return !!actor?.admin || !!actor?.paymentApprover;
}

/**
 * AI reads this photo has cost a limited reader.
 *
 * A read that FAILED costs nothing — it produced no answer to be tempted by, and
 * a run of server errors must not lock the one person who can fix the record out
 * of trying again. Nor does a read by an admin or the Payment Approver: their
 * reads are outside the count, so looking at a photo on someone's behalf cannot
 * spend that person's allowance.
 *
 * A photo attached before the counter existed but already read counts as one
 * try — conservative, and true of every such photo.
 */
export function checkReadsUsed(doc: CheckDoc): number {
  if (typeof doc.readCount === "number" && Number.isFinite(doc.readCount)) return Math.max(0, Math.floor(doc.readCount));
  return doc.read ? 1 : 0;
}

/** Tries left on this photo — `null` for a reader who has no limit. */
export function checkReadsLeft(doc: CheckDoc, opts?: { unlimited?: boolean }): number | null {
  if (opts?.unlimited) return null;
  return Math.max(0, AI_CHECK_READ_LIMIT - checkReadsUsed(doc));
}

/** May this photo be read (again) by this reader? */
export function canReadCheckAgain(doc: CheckDoc, opts?: { unlimited?: boolean }): boolean {
  const left = checkReadsLeft(doc, opts);
  return left === null || left > 0;
}

/**
 * What the counter should become after a SUCCESSFUL read — unchanged for a
 * reader with no limit, one more for everyone else.
 *
 * Always written, even when it does not move: a doc whose counter is explicitly
 * 0 is one an admin read and nobody else has, and without the zero the "read but
 * never counted" fallback above would charge the next person for it.
 */
export function nextCheckReadCount(doc: CheckDoc, opts?: { unlimited?: boolean }): number {
  const used = checkReadsUsed(doc);
  return opts?.unlimited ? used : used + 1;
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

/**
 * Two amounts built from the very same digits — 2,081.25 and 2,018.25.
 *
 * A check written for the wrong amount lands on a round-ish number of its own;
 * a MISREAD check lands on an anagram of the right one. Worth saying out loud on
 * the warning, because the two call for different actions: one is a trip to the
 * bank, the other is pressing Re-read.
 */
const sameDigits = (a: number, b: number): boolean => {
  const key = (n: number) => n.toFixed(2).replace(/\D/g, "").split("").sort().join("");
  return key(a) === key(b);
};

export interface CheckIssue {
  key: "payee" | "amount" | "words" | "account" | "duplicate" | "unread" | "confidence" | "date";
  message: string;
}

/**
 * The three-way tally the owner asked for: *"look at the check peso amount, word
 * amount and PO net. All must tally. If not tallied, inform the user of the
 * problem and cause."*
 *
 * Three numbers that should all be the same number:
 *
 *  - **the peso box** — the figure the check is written for;
 *  - **the PESOS line** — the same amount spelled out, and the one a bank pays
 *    when the two differ (Negotiable Instruments Law, Act 2031, sec. 17(c));
 *  - **the PO's net** — what we owe this supplier after the EWT we withhold.
 *
 * WHICH PAIR disagrees is the whole diagnosis, so each case gets its own
 * sentence rather than one generic "amounts don't match":
 *
 * | box | words | net | what it means |
 * | --- | --- | --- | --- |
 * | = | = | = | nothing to say |
 * | = | = | ≠ | the check is consistent but is not this PO's amount |
 * | ≠ | = | = | the FIGURE is wrong or misread — the bank pays the words |
 * | = | ≠ | = | the WORDS are wrong or misread — and the bank pays those |
 * | ≠ | ≠ | ≠ | the check disagrees with itself and with the PO |
 *
 * Returns null when they tally, or when there is nothing to compare.
 */
export function checkAmountTally(opts: {
  /** The peso box, as read. Null if the photo didn't give it up. */
  figures: number | null | undefined;
  /** The PESOS line read back as a number. Null if it couldn't be parsed. */
  words: number | null | undefined;
  /** The PO's net. Zero or negative means there is nothing to tally against. */
  net: number;
}): CheckIssue | null {
  const { figures, words } = opts;
  const net = opts.net > 0 ? opts.net : null;
  const same = (a: number | null | undefined, b: number | null | undefined) =>
    a != null && b != null && Math.abs(a - b) <= 0.01;
  // A misread lands on an anagram of the right answer; a wrongly written check
  // does not. Saying which one this looks like saves a trip to the bank.
  const hint = (a: number, b: number) =>
    sameDigits(a, b) ? " Those are the same digits in a different order, which is what a misread looks like — press Re-read before treating it as a wrong check." : "";

  // Nothing was legible. Say that, rather than reporting a false agreement.
  if (figures == null && words == null) {
    return { key: "amount", message: "The amount couldn't be read from this photo — neither the peso box nor the words. Re-read it, or check the figures against the check by hand." };
  }

  // Only one half of the check could be read. Compare what there is, and say
  // which half is missing so nobody reads silence as a clean bill.
  if (figures == null || words == null) {
    const got = figures ?? (words as number);
    const present = figures != null ? "peso box" : "words";
    const missing = figures != null ? "words" : "peso box";
    const half = `Only the ${present} could be read (${peso(got)}); the ${missing} couldn't.`;
    if (net == null) return { key: "amount", message: half };
    return same(got, net)
      ? { key: "amount", message: `${half} It matches this PO's net, but the check's own cross-check couldn't be confirmed.` }
      : { key: "amount", message: `${half} It does not match this PO's net of ${peso(net)}.${hint(got, net)}` };
  }

  const boxVsWords = same(figures, words);

  // No PO net to judge against — all we can do is the check's own cross-check.
  if (net == null) {
    return boxVsWords ? null : {
      key: "amount",
      message: `The check disagrees with itself: the peso box reads ${peso(figures)} but the words read ${peso(words)}. Cause: one of the two was written or read wrongly. The written amount governs on a check, so ${peso(words)} was used.${hint(figures, words)}`,
    };
  }

  const boxVsNet = same(figures, net);
  const wordsVsNet = same(words, net);
  if (boxVsWords && boxVsNet) return null; // all three tally

  // The check agrees with itself but not with the PO. The check is not at
  // fault; either it is for the wrong amount, or it is on the wrong PO.
  if (boxVsWords) {
    return {
      key: "amount",
      message: `The check is for ${peso(figures)} but this PO's net is ${peso(net)}. The check agrees with itself, so the amount written is not this PO's — either it was written for the wrong amount, or this photo belongs to a different PO.${hint(figures, net)}`,
    };
  }

  // The words agree with the PO; the figure is the odd one out.
  if (wordsVsNet) {
    return {
      key: "amount",
      message: `The peso box reads ${peso(figures)}, but the words and this PO's net both read ${peso(words)}. Cause: the figure on the check is wrong, or was misread. The written amount governs on a check, so ${peso(words)} was used.${hint(figures, words)}`,
    };
  }

  // The figure agrees with the PO — but the bank pays the WORDS, so this is the
  // expensive one, and it is not fixed by pressing Re-read if the check really
  // says that.
  if (boxVsNet) {
    return {
      key: "amount",
      message: `The peso box and this PO's net both read ${peso(figures)}, but the words read ${peso(words)}. Cause: the amount in words is wrong, or was misread. A bank pays the WORDS — if the check really says ${peso(words)}, it must be voided and rewritten.${hint(figures, words)}`,
    };
  }

  // Nothing agrees with anything.
  return {
    key: "amount",
    message: `Nothing tallies: the peso box reads ${peso(figures)}, the words read ${peso(words)}, and this PO's net is ${peso(net)}. Cause: the check disagrees with itself AND with the PO. Re-read the photo first; if it reads the same, the check itself is wrong.`,
  };
}

/**
 * The other half of the tally — the owner's *"if it tallies, show a message that
 * it tally."*
 *
 * An absence of warnings is not the same as a confirmation. Nothing on the card
 * distinguished *"the three agree"* from *"nobody checked"*, and those are the
 * two things a person releasing money most needs to tell apart.
 *
 * Returns the line to show in green, or null when there is nothing to confirm:
 * a half-read check, no PO net to compare against, or a disagreement (which
 * `checkAmountTally` reports instead).
 */
export function checkAmountAgreed(read: CheckRead | undefined, net: number): string | null {
  if (!read) return null;
  const figures = read.amountFigures;
  const words = read.amountFromWords;
  if (figures == null || words == null || !(net > 0)) return null;
  // Deliberately the SAME function that reports the problems: a green line the
  // amber line disagrees with would be worse than no green line at all.
  if (checkAmountTally({ figures, words, net })) return null;
  return `Tallies — the check's figure, its amount in words and this PO's net are all ${peso(net)}.`;
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
  // (e) The clearing date has to come from the eight DATE boxes. When the model
  // could not transcribe them, its own written date stands unchecked — and that
  // is exactly how a check for 17 October came to sit in the register as 17
  // July, reading "49 days ago". A date nobody confirmed must not look like one
  // that was.
  if (r.clearingYMD && !r.dateBoxes) {
    // A read stored while the model's own date was still allowed to stand in.
    issues.push({
      key: "date",
      message: "The date boxes couldn't be read, so this clearing date is the AI's own answer rather than the check's. Check it against the photo.",
    });
  } else if (!r.clearingYMD) {
    // …and how it reads now that the model's date is no longer accepted: the
    // check is undated until a person supplies the date from the photo. Saying
    // nothing here would leave the register's "No clearing date read" as the
    // only hint, on a screen the person attaching the check never opens.
    issues.push({
      key: "date",
      message: "No clearing date — the eight DATE boxes couldn't be read. Open the photo and set the date by hand on Check Monitoring.",
    });
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
  // (f) and (g) — the peso box, the PESOS line and the PO's net, all three at
  // once. One issue, because "which pair disagrees" is a single diagnosis.
  if (r.amountFigures != null || r.amountFromWords != null) {
    const tally = checkAmountTally({ figures: r.amountFigures, words: r.amountFromWords, net: opts.netAmount });
    if (tally) issues.push(tally);
  } else if (r.amount != null) {
    // A read stored before the three figures were kept apart. All it has is one
    // amount and the verbatim line, so it gets the checks it can support.
    if (opts.netAmount > 0 && Math.abs(r.amount - opts.netAmount) > 0.01) {
      const hint = sameDigits(r.amount, opts.netAmount)
        ? " Those are the same digits in a different order, which is what a misread looks like — press Re-read before treating it as a wrong check."
        : "";
      issues.push({ key: "amount", message: `Check is for ${peso(r.amount)} but this PO's net is ${peso(opts.netAmount)}.${hint}` });
    }
    if (r.amountWords && !amountMatchesWords(r.amount, r.amountWords, opts.inWords)) {
      issues.push({ key: "words", message: `The amount in words doesn't match the figure — "${r.amountWords}".` });
    }
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
