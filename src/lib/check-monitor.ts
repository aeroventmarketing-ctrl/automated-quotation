/**
 * Check monitoring — watching every issued check towards the day it clears.
 *
 * The owner's rule: *"Purpose of check monitoring tile is to monitor the checks
 * clearing date, notify the admin at least 3 days before clearing. Move the
 * cleared check to a separate tab once check is cleared. If in case the check
 * cannot be cleared because of lack of funds, admin has the option to move the
 * check date to other date."*
 *
 * The whole thing rests on a date the AI read off the face of the check, so two
 * things are deliberate:
 *
 *  - **An undated check is called undated, never assumed.** A photo with glare
 *    over the date box yields no clearing date, and inventing one would put a
 *    real payment on a day nobody agreed to.
 *  - **"Cleared" is recorded by a person.** Only the bank knows whether a check
 *    cleared; a date passing proves nothing. So a check does not move itself to
 *    the Cleared tab on its due date — it waits to be told.
 */
import type { CheckDoc } from "@/lib/voucher-check";
import { clearingFromDateBoxes, effectiveClearingYMD, printedClearingYMD, effectiveCheckAmount, effectiveCheckNo, normalizeCheckNo, openCheckIssues } from "@/lib/voucher-check";
import { duplicateCheckIndex, duplicateCheckKey, purchaseOrderKey } from "@/lib/check-duplicates";

/**
 * How far ahead a check reads as *Clearing soon* on screen.
 *
 * This is a DISPLAY threshold only. It began life as the owner's *"notify the
 * admin at least 3 days before clearing"*, but they withdrew the notification:
 * *"do not notify the admin for checks that will soon clear."* The badge stays
 * so the schedule can be read at a glance; nothing is pushed at anyone because
 * of it.
 */
export const CHECK_NOTICE_DAYS = 3;

export type CheckWatchState =
  | "cleared" // the bank cleared it — the Cleared tab
  | "overdue" // its clearing date has passed and nobody has cleared it
  | "due" // clears today
  | "soon" // within CHECK_NOTICE_DAYS — this is what the admin is notified about
  | "scheduled" // further out
  | "undated" // the check was never read, or its date couldn't be made out
  /**
   * No check photo is attached at all, but this PO is payable by check — the
   * owner's *"For Payment"*. Its money is owed and belongs in Accounts Payable;
   * nothing can clear until somebody writes and photographs the check, so it is
   * NOT First Priority and has no date to be overdue against.
   */
  | "awaiting";

/** Whole days from `fromYMD` to `toYMD`. Negative when `toYMD` is in the past. */
export function daysBetweenYMD(fromYMD: string, toYMD: string): number {
  const a = Date.parse(`${fromYMD}T00:00:00Z`);
  const b = Date.parse(`${toYMD}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.round((b - a) / 86_400_000);
}

export function checkWatchState(doc: CheckDoc, todayYMD: string): CheckWatchState {
  if (doc.cleared) return "cleared";
  const due = effectiveClearingYMD(doc);
  if (!due) return "undated";
  const days = daysBetweenYMD(todayYMD, due);
  if (days < 0) return "overdue";
  if (days === 0) return "due";
  return days <= CHECK_NOTICE_DAYS ? "soon" : "scheduled";
}

/**
 * The states drawn in amber ON SCREEN — clearing within 3 days, today, or
 * already past. A display rule: it decides colour, not who gets told.
 */
export function needsAttention(state: CheckWatchState): boolean {
  return state === "overdue" || state === "due" || state === "soon";
}

/**
 * The one state that PUSHES a task at the admin — a check whose date has passed
 * and which nobody has cleared.
 *
 * Deliberately narrower than `needsAttention`, on the owner's instruction: *"do
 * not notify the admin for checks that will soon clear."* A check that is merely
 * approaching, today's included, is on the register and in First Priority where
 * they are already looking; a check that should have cleared and did not is the
 * exception worth interrupting someone for.
 */
export function notifiesAdmin(state: CheckWatchState): boolean {
  return state === "overdue";
}

export const CHECK_STATE_LABEL: Record<CheckWatchState, string> = {
  cleared: "Cleared",
  overdue: "Overdue — not cleared",
  due: "Clears today",
  soon: "Clearing soon",
  scheduled: "Scheduled",
  undated: "No clearing date read",
  awaiting: "Check not attached",
};

/**
 * The owner's own status vocabulary, taken from the legend at the foot of their
 * register (`Pending · For Payment · Check Clearing · Finished`).
 *
 * Three of the four appear here. A row usually exists because a check exists, so
 * it is *Check Clearing* or *Finished*; since the owner asked for payable POs
 * with no check yet — *"september 3 and september 4 PO not showing"* — a row can
 * also be *For Payment*. Only *Pending* stays out: a PO that has not reached the
 * signing step has no payment to watch.
 */
export function registerStatus(state: CheckWatchState): "For Payment" | "Check Clearing" | "Finished" {
  if (state === "cleared") return "Finished";
  // The owner's own word for a PO that is due but whose check is not yet
  // written — their register's legend reads `Pending · For Payment · Check
  // Clearing · Finished`, and this is the second of those.
  return state === "awaiting" ? "For Payment" : "Check Clearing";
}

/**
 * Post-dated or not. Every row in the owner's register reads **PDC**, which is
 * the norm for a terms supplier — but it is derived rather than assumed, so a
 * current-dated check is not mislabelled.
 */
export function formOfPayment(poDate: string | null, clearingYMD: string | null): "PDC" | "Check" {
  if (!poDate || !clearingYMD) return "Check";
  return clearingYMD > poDate.slice(0, 10) ? "PDC" : "Check";
}

/** One check, as the monitoring screen and the tile see it. */
export interface CheckWatchRow {
  prId: string;
  path: string; // identifies the check within its PO — and is its storage path
  /** The photo's original file name, for the view link. */
  fileName: string;
  /** The date on the PO itself — the register's leading column. */
  poDate: string | null;
  poNumber: string;
  supplier: string;
  orderId: string | null;
  checkNo: string | null;
  amount: number | null;
  /** The date it is expected to clear — rescheduled if it was moved. */
  clearingYMD: string | null;
  /**
   * The date printed on the check, when it differs from the one above — i.e.
   * this check was RESCHEDULED off its own date.
   *
   * A date a person CORRECTED is not that: the check always said the corrected
   * date, so there is nothing to have moved from. See `dateFixedBy`.
   */
  originalYMD: string | null;
  /** Who corrected a misread date, if anyone did. */
  dateFixedBy: string | null;
  /** Who corrected a misread amount, if anyone did. */
  amountFixedBy: string | null;
  /** Who corrected a misread check number, if anyone did. */
  checkNoFixedBy: string | null;
  /**
   * OTHER purchase orders on this register carrying the SAME check number,
   * named. Empty for all but a handful of rows.
   *
   * Computed over the whole register every time it is built, rather than read
   * off the warning stored when the check was read. The stored one is a snapshot
   * of the moment of reading, so it appears on the PO read second and never on
   * the PO read first — which is how the owner came to be looking at two rows
   * sharing check no. 0000486718 with only one of them flagged. BOTH halves of a
   * pair say so here, in both tabs, to everyone who can open the page.
   */
  duplicateOf: string[];
  /**
   * How many of this check's issues are still unanswered.
   *
   * Zero on a check that never had any, and zero on one whose every issue an
   * admin or the Payment Approver has accepted — the two are the same thing to a
   * register asking "does this still need someone".
   */
  openIssues: number;
  /** Who accepted the discrepancies, if anyone has. */
  issuesApprovedBy: string | null;
  /** …and when, so the register can say it in the Remarks column. */
  issuesApprovedAt: string | null;
  /** How many times the date has been moved. */
  moves: number;
  /** Why it was last moved (typically insufficient funds). */
  lastMoveReason: string | null;
  daysLeft: number | null;
  /**
   * Did this clearing date come from somewhere trustworthy?
   *
   * TRUE when it was assembled from the check's own eight DATE boxes, or when a
   * person set it — a rescheduled date, or the day someone recorded the check as
   * cleared.
   *
   * FALSE when the date is the model's own written answer, unchecked against the
   * boxes. That happens two ways, and they look identical on screen: a read
   * taken before the boxes were transcribed at all, and a read where the model
   * could not make the boxes out and its own date stood by default. Both need a
   * person's eye, which is why the register says so rather than presenting the
   * date as fact.
   */
  dateVerified: boolean;
  state: CheckWatchState;
  clearedOn: string | null;
  clearedByName: string | null;
  /** "Check Clearing" / "Finished" — the owner's register wording. */
  statusLabel: string;
  /** "PDC" for a post-dated check, the register's Form of Payment column. */
  form: "PDC" | "Check";
  /** Why a date was moved, or the note left when it cleared. */
  remarks: string | null;
}

/** The PurchaseRequest fields this reads — a subset, so callers can select narrowly. */
export interface CheckWatchSource {
  id: string;
  quotationId: string | null;
  po: unknown;
  voucherCheckDocs: unknown;
  /** The PO's stage — decides whether a missing check is yet expected. */
  status?: string;
}

export function buildCheckWatch(
  prs: CheckWatchSource[],
  todayYMD: string,
  helpers: {
    coerceDocs: (v: unknown) => CheckDoc[];
  poOf: (v: unknown) => { poNumber: string; supplierCompany: string; date: string | null; net: number } | null;
    /**
     * Is a check expected on this PO but not yet attached? Injected rather than
     * derived here, because it needs the supplier's terms flag and the PO's
     * stage — see `checkExpected`. Omit and the register stays what it was: one
     * row per attached photo.
     */
    expectsCheck?: (pr: CheckWatchSource, supplierCompany: string) => boolean;
    /**
     * The combined-PO batch id on this request's `po` JSON, or null.
     *
     * Optional, and the grouping below falls back to the PO NUMBER without it —
     * which groups a combined PO correctly anyway, since every member carries
     * the same `po` JSON, number included. Supplying it makes the grouping
     * exact rather than merely reliable: two unrelated requests could in
     * principle be made to share a number, and those must not be merged.
     */
    batchIdOf?: (po: unknown) => string | null;
  },
): CheckWatchRow[] {
  const rows: CheckWatchRow[] = [];
  /**
   * Which PO each row belongs to, and that PO's stage — kept alongside `rows`
   * rather than on them, because they are the duplicate test's business and
   * nothing on screen wants either.
   *
   * Pushed in lockstep with `rows`, and read back BEFORE the sort at the end
   * reorders them.
   */
  const owners: { poKey: string; poLabel: string; status: string }[] = [];
  const ownerOf = (pr: CheckWatchSource, poNumber: string | null) => ({
    // No batch id here: a combined PO's member rows all carry the same `po`
    // JSON, PO number included, so the number already groups them into one
    // purchase order — which is the whole point of the key.
    poKey: purchaseOrderKey({ id: pr.id, poNumber, batchId: null }),
    poLabel: poNumber?.trim() || "a purchase order with no PO number yet",
    status: pr.status ?? "",
  });

  /**
   * ONE PURCHASE ORDER per group, not one purchase request.
   *
   * A combined PO is several `PurchaseRequest` rows carrying the SAME `po` JSON
   * — `purchase-batch.ts` says so outright — and that JSON holds the WHOLE PO's
   * lines and the whole PO's net. Walking requests therefore listed a three-member
   * combined PO three times, each row claiming the full amount, and the owner was
   * looking at PO-AFBM2026000762 three times at ₱5,834.44 and
   * PO-AFBM2026000770 twice at ₱235,668.86.
   *
   * That is not a cosmetic repeat. Those rows are Accounts Payable: they feed
   * "Still to clear", the Cash Position's Total Payables and the Funding
   * Shortfall. Two combined POs were inflating the payables by ₱247,000 between
   * them.
   *
   * It also mis-stated the check. One check is written per PO and attaches to the
   * ANCHOR request, so the other members hold no photo — and each of them was
   * being reported as a separate PO still "Check not attached", beside the anchor
   * that had it.
   */
  const groups = new Map<string, CheckWatchSource[]>();
  for (const pr of prs) {
    const key = purchaseOrderKey({
      id: pr.id,
      poNumber: helpers.poOf(pr.po)?.poNumber ?? null,
      batchId: helpers.batchIdOf?.(pr.po) ?? null,
    });
    const at = groups.get(key);
    if (at) at.push(pr);
    else groups.set(key, [pr]);
  }

  for (const members of groups.values()) {
    /**
     * The request this PO's row speaks for.
     *
     * The one holding the check photo where there is one — that is the anchor,
     * and it is the row every action on this PO has to address. Otherwise the
     * lowest id, which is stable: the register must not reshuffle between polls
     * because Postgres returned the members in a different order.
     */
    const pr = members.find((m) => helpers.coerceDocs(m.voucherCheckDocs).length > 0)
      ?? [...members].sort((a, b) => a.id.localeCompare(b.id))[0];
    const po = helpers.poOf(pr.po);
    // Every photo on the PO, whichever member holds it — and each keeps its own
    // member's id, so "attach"/"remove" still address the row that owns the file.
    const docs = members.flatMap((m) =>
      helpers.coerceDocs(m.voucherCheckDocs).map((doc) => ({ doc, owner: m })),
    );

    // A payable PO with no photo yet — the owner's *"For Payment"* row. It
    // carries the PO's NET, because that is what the check will be written for,
    // and nothing else: there is no number, no date and no photo to open.
    if (docs.length === 0) {
      // "Expected" is asked of EVERY member, because a combined PO's stage is
      // kept in step across them but its members can be of different kinds.
      if (po && members.some((m) => helpers.expectsCheck?.(m, po.supplierCompany))) {
        const poDate = po.date ? po.date.slice(0, 10) : null;
        rows.push({
          prId: pr.id, path: "", fileName: "",
          poDate, poNumber: po.poNumber, supplier: po.supplierCompany, orderId: pr.quotationId,
          checkNo: null, amount: po.net, clearingYMD: null, originalYMD: null,
          dateFixedBy: null,
          // Nothing has been read on a PO awaiting its photo, so there is nothing
          // to have corrected and nothing to disagree about.
          amountFixedBy: null, checkNoFixedBy: null,
          duplicateOf: [],
          openIssues: 0, issuesApprovedBy: null, issuesApprovedAt: null,
          moves: 0, lastMoveReason: null, daysLeft: null,
          // No check, so no date to doubt.
          dateVerified: true,
          state: "awaiting", clearedOn: null, clearedByName: null,
          statusLabel: registerStatus("awaiting"),
          form: formOfPayment(poDate, null),
          remarks: null,
        });
        owners.push(ownerOf(pr, po.poNumber));
      }
      continue;
    }

    for (const { doc, owner } of docs) {
      const due = effectiveClearingYMD(doc);
      // What the check says — a person's correction if there was one. Comparing
      // the DUE date against the AI's discarded answer is what left the register
      // reading "moved from Jul 12, 2026" under a date that had merely been
      // corrected to the 17th of October.
      const original = printedClearingYMD(doc);
      const moves = doc.reschedules?.length ?? 0;
      const state = checkWatchState(doc, todayYMD);
      const poDate = po?.date ? po.date.slice(0, 10) : null;
      rows.push({
        // The member that actually holds this photo — the anchor, in practice —
        // so "attach", "remove" and the register's link all address the row the
        // file lives on rather than whichever member spoke for the PO.
        prId: owner.id,
        path: doc.path,
        fileName: doc.name,
        poDate,
        poNumber: po?.poNumber ?? "—",
        supplier: po?.supplierCompany ?? "",
        orderId: owner.quotationId,
        // A person's correction beats the reading, here as on the PO card — the
        // register and the card must never quote different figures for one check.
        checkNo: effectiveCheckNo(doc),
        amount: effectiveCheckAmount(doc),
        amountFixedBy: doc.amountFix?.byName || null,
        checkNoFixedBy: doc.checkNoFix?.byName || null,
        duplicateOf: [], // filled in below, once every row is known

        // What still disagrees and nobody has accepted, and who accepted the rest.
        openIssues: openCheckIssues(doc).length,
        issuesApprovedBy: doc.issueApproval?.byName || null,
        issuesApprovedAt: doc.issueApproval?.at || null,
        clearingYMD: due,
        originalYMD: original && original !== due ? original : null,
        dateFixedBy: doc.dateFix?.byName || null,
        moves,
        lastMoveReason: moves ? doc.reschedules![moves - 1].reason || null : null,
        daysLeft: due ? daysBetweenYMD(todayYMD, due) : null,
        // A human-set date (corrected, moved, or recorded as cleared) is as good
        // as the boxes; anything else has to match what the boxes actually said.
        dateVerified: !!doc.cleared || !!doc.dateFix || moves > 0 || (!!due && clearingFromDateBoxes(doc.read?.dateBoxes) === due),
        state,
        clearedOn: doc.cleared?.on ?? null,
        clearedByName: doc.cleared?.byName ?? null,
        statusLabel: registerStatus(state),
        form: formOfPayment(poDate, due),
        // The register's Remarks column, filled with what the system actually
        // knows: why a date moved, or the note left when it cleared.
        remarks: doc.cleared?.note ?? (moves ? doc.reschedules![moves - 1].reason || null : null),
      });
      owners.push(ownerOf(owner, po?.poNumber ?? null));
    }
  }

  /**
   * The same check number on two different purchase orders — asked of the whole
   * register at once, so BOTH rows say so. See `CheckWatchRow.duplicateOf`.
   *
   * Cleared checks are included deliberately: a check that has already cleared
   * is the strongest possible evidence that the number on the other PO is wrong,
   * and hiding the pair once half of it clears would let the register look tidy
   * at exactly the wrong moment.
   */
  const dupes = duplicateCheckIndex(
    rows.map((r, i) => ({ poKey: owners[i].poKey, poLabel: owners[i].poLabel, checkNo: r.checkNo, status: owners[i].status })),
  );
  if (dupes.size) {
    rows.forEach((r, i) => {
      const key = duplicateCheckKey(owners[i].poKey, r.checkNo);
      r.duplicateOf = (key && dupes.get(key)) || [];
    });
  }

  // Soonest first among the live ones; most recently cleared first among the rest.
  return rows.sort((a, b) => {
    if (a.state === "cleared" && b.state !== "cleared") return 1;
    if (b.state === "cleared" && a.state !== "cleared") return -1;
    if (a.state === "cleared" && b.state === "cleared") return (b.clearedOn ?? "").localeCompare(a.clearedOn ?? "");
    // An undated check sorts last among the live ones — it has no day to sort by.
    if (!a.clearingYMD) return b.clearingYMD ? 1 : 0;
    if (!b.clearingYMD) return -1;
    return a.clearingYMD.localeCompare(b.clearingYMD) || a.poNumber.localeCompare(b.poNumber);
  });
}

export interface CheckWatchSummary {
  /** Everything not yet cleared. */
  open: number;
  /** Of those, the ones the admin is being told about (≤3 days, today, or past). */
  attention: number;
  /**
   * Open checks carrying a date that was never confirmed against the check's own
   * date boxes — see `CheckWatchRow.dateVerified`. The number a person needs in
   * order to know how much of the register to go and check.
   */
  unverifiedDates: number;
  overdue: number;
  cleared: number;
  undated: number;
  /**
   * How many check NUMBERS are recorded on more than one purchase order.
   *
   * Numbers, not rows: two rows sharing one number is ONE problem, and the
   * register's own banner counts it that way. A tile saying "4" beside a banner
   * saying "2" about the same register is the kind of disagreement nobody can
   * debug from the outside.
   *
   * Counted across BOTH tabs, cleared checks included — half a pair on the
   * Cleared tab is still half a pair, and a cleared check is the strongest
   * evidence that the other record is the wrong one.
   */
  duplicateNumbers: number;
  /** Total peso value still to clear (checks with a readable amount). */
  openAmount: number;
  /**
   * The owner's **Total First Priority**: every uncleared check whose clearing
   * date has ARRIVED — today or earlier.
   *
   * *"if not cleared it will stay in this row"* — a check whose date has passed
   * is more urgent, not less, so it keeps counting until someone confirms the
   * bank took it. Deliberately NOT the same set as the 3-day notice: that warns
   * ahead of time, this is money the bank can take today.
   */
  firstPriorityAmount: number;
  /** The next clearing date among the open checks. */
  nextYMD: string | null;
}

export function checkWatchSummary(rows: CheckWatchRow[]): CheckWatchSummary {
  const open = rows.filter((r) => r.state !== "cleared");
  const dated = open.filter((r) => r.clearingYMD).sort((a, b) => a.clearingYMD!.localeCompare(b.clearingYMD!));
  return {
    open: open.length,
    attention: open.filter((r) => needsAttention(r.state)).length,
    unverifiedDates: open.filter((r) => r.clearingYMD && !r.dateVerified).length,
    overdue: open.filter((r) => r.state === "overdue").length,
    cleared: rows.length - open.length,
    undated: open.filter((r) => r.state === "undated").length,
    duplicateNumbers: new Set(
      rows.filter((r) => r.duplicateOf.length > 0 && r.checkNo).map((r) => normalizeCheckNo(r.checkNo!)),
    ).size,
    openAmount: open.reduce((s, r) => s + (r.amount ?? 0), 0),
    firstPriorityAmount: open
      .filter((r) => r.state === "due" || r.state === "overdue")
      .reduce((s, r) => s + (r.amount ?? 0), 0),
    nextYMD: dated[0]?.clearingYMD ?? null,
  };
}
