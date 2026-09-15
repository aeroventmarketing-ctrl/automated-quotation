/**
 * Which commission rows a proof of payment lands on when it is attached to ONE of
 * them — "the said voucher".
 *
 * The owner: *"once file is attached. File will also attach to other rows that is
 * related to the said voucher and can be viewable. Purpose of such is faster
 * attachment of voucher. I attach once and auto attach to other."*
 *
 * A commission voucher pays a whole set of commissions at once — *"Total every
 * approved inquiry and make a single cash voucher per sales personnel"* — so one
 * deposit slip evidences every row on it. Attaching it fifteen times is not
 * fifteen facts; it is one fact typed fifteen times.
 *
 * ## How the set is decided
 *
 * In order of how well each answer knows what it is talking about:
 *
 *  1. **The printed voucher.** `recordPrintedCommissionVoucher` stores the exact
 *     deal keys a numbered voucher covers. That is not an inference — it is the
 *     document. When the row is on one, the set is that voucher and nothing else.
 *  2. **The release day.** No voucher printed: a commission voucher totals
 *     everything one salesperson is owed and goes out on a release date — the
 *     15th and the 30th — so their commissions released on the same day in Manila
 *     were one payment. A *day*, not a matching timestamp: "Mark voucher paid"
 *     stamps a whole voucher in one millisecond, but Accounting pressing fifteen
 *     row buttons over two minutes is just as much one voucher, and a rule that
 *     could not see that would fail on the ordinary case.
 *  3. **The payout in flight.** Still nothing — a payment that straddled two days:
 *     the person's paid-and-unsigned-for rows, which is the set
 *     `attachCommissionProof` already treats as one payout. Applied only when the
 *     target itself is unsigned-for, so a slip put on a closed row can never
 *     sweep into an open payout.
 *
 * And two boundaries that hold in every case:
 *
 *  - **Never across salespeople.** The file lives under the payee's id, and the
 *    route that serves it reads the payee out of that path. A row belonging to
 *    someone else could not open it anyway; putting it there would only show a
 *    name beside a file nobody can see.
 *  - **Never from no voucher onto a voucher.** If the target is on no printed
 *    voucher and a candidate is, they are different payments — the candidate's
 *    voucher says which rows it covers, and this one is not among them.
 */
import { PH_TIME_ZONE } from "@/lib/utils";

/** What this rule reads off a `Commission` row. */
export interface VoucherRow {
  id: string;
  salespersonId: string;
  /** `<order|counter>-<refId>-<base|override>` — `dealKey` in `sales-commission`. */
  dealKey: string;
  paid: boolean;
  /** The day the money was released, in Manila — `releaseDay(paidAt)`. */
  paidYMD: string | null;
  /** ISO, once the payee has signed for it. */
  receivedAt: string | null;
}

/**
 * The day a payout was released, as the Philippines saw it.
 *
 * Manila and not UTC, because the release day is a day in the Philippines. The
 * two agree through the working day and part company before 8 AM local, which is
 * stamped on the PREVIOUS date in UTC — so a voucher finished early, or an
 * overnight correction to one, would be filed under the day before and split off
 * from the rows it was paid with.
 */
export function releaseDay(paidAt: Date | string | null | undefined): string | null {
  if (!paidAt) return null;
  const d = paidAt instanceof Date ? paidAt : new Date(paidAt);
  if (Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: PH_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit",
  }).format(d);
}

/**
 * The rows one attachment covers, `target` included.
 *
 * Empty when the target has not been paid: a proof of payment needs a payment.
 * `rows` is every paid commission in play; it may or may not contain the target,
 * and the answer is the same either way.
 */
export function voucherMates<T extends VoucherRow>(
  target: T,
  rows: readonly T[],
  voucherByDeal: ReadonlyMap<string, string>,
): T[] {
  if (!target.paid) return [];
  const no = voucherByDeal.get(target.dealKey);

  const mine = rows.filter((r) => r.paid && r.salespersonId === target.salespersonId);
  const covered = mine.filter((r) => {
    if (r.dealKey === target.dealKey) return true;
    // 1 · the document itself.
    if (no) return voucherByDeal.get(r.dealKey) === no;
    // A row that belongs to some OTHER printed voucher belongs to that payment.
    if (voucherByDeal.get(r.dealKey)) return false;
    // 2 · released on the same day.
    if (target.paidYMD && r.paidYMD === target.paidYMD) return true;
    // 3 · the payout in flight.
    return !target.receivedAt && !r.receivedAt;
  });

  return covered.some((r) => r.dealKey === target.dealKey) ? covered : [target, ...covered];
}
