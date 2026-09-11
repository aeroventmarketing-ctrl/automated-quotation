/**
 * One row of the check register, flattened for a file.
 *
 * The owner: *"add an option to download in excel file and pdf file."* Two
 * formats, one shape — otherwise the spreadsheet and the PDF drift into
 * disagreeing about the same register, which is the sort of difference nobody
 * notices until it is quoted at somebody.
 *
 * The columns are the screen's own, in the screen's order, minus the Actions
 * column (a button is not a fact) and minus the check PHOTO link (a file on a
 * spreadsheet is a dead link the moment it leaves the app).
 */
import type { CheckWatchRow } from "@/lib/check-monitor";
import type { CashPosition } from "@/lib/cash-position";
import { formatCheckNo, isClearingYMD } from "@/lib/voucher-check";

export const CHECK_EXPORT_HEADERS = [
  "Date",
  "Company",
  "Purchase Order Number",
  "Check No.",
  "Amount",
  "Date Paid/Cleared",
  "Form of Payment",
  "Status",
  "Remarks",
] as const;

/**
 * A date cell holds a date or nothing.
 *
 * ISO, because dd/mm/yyyy is ambiguous and this register has already lost a
 * month to that — and because a spreadsheet sorts it correctly as text.
 *
 * Anything that is not a real calendar day prints EMPTY rather than being passed
 * through: a stored value of "not-a-date" (which a hostile row in the harness
 * really does carry) is not information, and printing it in a date column just
 * moves the confusion onto paper.
 */
const ymd = (s: string | null): string => (isClearingYMD(s) ? s : "");

/**
 * What a person reads in the Remarks column, plus the notes the screen prints
 * under the date — a moved date, a corrected one, a date nobody confirmed. On
 * screen those sit in the date cell; on a page with fixed columns they belong
 * with the remarks, where they read as sentences.
 */
function remarksFor(r: CheckWatchRow): string {
  const notes: string[] = [];
  if (r.remarks) notes.push(r.remarks);
  if (r.originalYMD) notes.push(`moved from ${r.originalYMD}${r.moves > 1 ? ` · ${r.moves} times` : ""}`);
  if (r.dateFixedBy) notes.push(`date corrected by ${r.dateFixedBy}`);
  if (r.amountFixedBy) notes.push(`amount corrected by ${r.amountFixedBy}`);
  if (r.checkNoFixedBy) notes.push(`check no. corrected by ${r.checkNoFixedBy}`);
  // A discrepancy and its answer travel together onto the paper. A printed
  // register that showed neither would let a reader take a figure on trust that
  // somebody had to sign for.
  if (r.issuesApprovedBy) notes.push(`discrepancy approved by ${r.issuesApprovedBy}`);
  if (r.openIssues > 0 && !r.issuesApprovedBy) notes.push(`${r.openIssues} unresolved discrepanc${r.openIssues === 1 ? "y" : "ies"}`);
  if (r.clearingYMD && !r.dateVerified) notes.push("clearing date unconfirmed");
  if (r.state === "cleared" && r.clearedByName) notes.push(`cleared by ${r.clearedByName}`);
  return notes.join(" · ");
}

/**
 * The row as cells. `Amount` stays a NUMBER so a spreadsheet can total the
 * column — the whole reason for offering Excel rather than only a PDF.
 */
export function checkRegisterRow(r: CheckWatchRow): (string | number | null)[] {
  return [
    ymd(r.poDate),
    r.supplier || "",
    r.poNumber,
    formatCheckNo(r.checkNo) ?? "",
    r.amount ?? null,
    ymd(r.state === "cleared" ? r.clearedOn ?? r.clearingYMD : r.clearingYMD),
    r.form,
    r.statusLabel,
    remarksFor(r),
  ];
}

/** The same row as text, for the PDF — where a null cell would print "null". */
export function checkRegisterTextRow(r: CheckWatchRow): string[] {
  return checkRegisterRow(r).map((v) =>
    v == null ? "" : typeof v === "number" ? v.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : v,
  );
}

/**
 * A file name that says what is in it. Someone with four of these in a Downloads
 * folder should not have to open them to tell which is which.
 */
export function checkExportFileName(tab: "open" | "cleared", todayYMD: string, ext: "xlsx" | "pdf"): string {
  return `check-register-${tab === "cleared" ? "cleared" : "to-clear"}-${todayYMD}.${ext}`;
}


// --- The cash position, for a file ------------------------------------------
//
// The owner: *"include cash position in the printed or downloaded file."*
//
// Same ten lines as the panel under the register, in the same order and under
// the owner's own names. Listed here rather than re-typed in each format, for
// the same reason the register rows are: a spreadsheet and a PDF that disagree
// about the bank balance is the worst kind of difference — quotable, and wrong.
//
// WHO gets it is not decided here. `canSeeCashPosition` decides, in the routes,
// exactly as it does on screen: the panel is the admin's and the Payment
// Approver's, and a download must not become a way round that.

export interface CashPositionLine {
  label: string;
  value: number;
  /** A heading-weight line — the owner's own highlighting. */
  strong?: boolean;
  /** Can go either way, so it carries its sign. */
  signed?: boolean;
}

/** The panel's rows, in the panel's order. */
export function cashPositionLines(pos: CashPosition): CashPositionLine[] {
  return [
    { label: "OUTSTANDING CHECK", value: pos.firstPriority, strong: true },
    { label: "Cash in Bank", value: pos.cob },
    { label: "Available Bank Balance", value: pos.remainingCob, strong: true, signed: true },
    { label: "Cash on Hand", value: pos.coh },
    { label: "Receivables", value: pos.receivables },
    { label: "Expected Collections", value: pos.cashGcashChecking },
    { label: "Available Cash Balance", value: pos.remainingCash, signed: true },
    { label: "Available Funds", value: pos.dispensableCash, strong: true, signed: true },
    { label: "Accounts Payable", value: pos.totalPayables },
    { label: "Funding Shortfall", value: pos.fundingShortfall, strong: true, signed: true },
  ];
}

/**
 * A figure with its sign in front — the owner's *"Put a + or - indicator"*. A
 * true minus sign, and the amount itself unsigned, so the two never read as
 * "-−123".
 */
export function signedAmount(n: number): string {
  const abs = Math.abs(n).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${n > 0 ? "+" : n < 0 ? "\u2212" : ""}${abs}`;
}

/**
 * Where the panel's figures come from, said on the page.
 *
 * A printed cash position is read away from the app, by somebody who cannot
 * click anything to find out — so the sheet has to explain itself. The three
 * hand-entered lines are named because a stale one is the only way this can be
 * quietly wrong.
 */
export function cashPositionNote(pos: CashPosition): string {
  const hand = pos.updatedByName
    ? `Cash in Bank, Cash on Hand and Expected Collections were entered by hand — last by ${pos.updatedByName}${pos.updatedAt ? ` on ${pos.updatedAt.slice(0, 10)}` : ""}.`
    : "Cash in Bank, Cash on Hand and Expected Collections are entered by hand and have not been set yet.";
  return `Outstanding Check and Accounts Payable come from the whole register, not the rows above; Receivables from the Management Dashboard. ${hand}`;
}
