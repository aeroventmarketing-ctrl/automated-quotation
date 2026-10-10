/**
 * Whose dashboard gets "Confirm materials received" for an MRF.
 *
 * The owner, looking at the Purchaser's dashboard full of *"Confirm materials
 * received · MRF #0420"*, *"#0351"*, *"#0404"*…: *"In my dashboard, show only the
 * task related to each role except for admin role."*
 *
 * Those were all **Office** MRFs. Office has no production head, so five seats
 * count as its requestor — Admin, Sales, Engineer, Purchaser, Payment Approver
 * (`isOfficeMrfRequestor`) — and every one of them was handed every Office
 * confirmation, whoever had actually asked for the materials. Asked who should
 * get it, the owner chose **the person who raised it**, plus Admin.
 *
 * ## What this changes, and what it does not
 *
 * It decides which DASHBOARDS list the task. It does **not** decide who may
 * confirm: the order page and `confirmMaterialReceipt` still accept any of the
 * five Office seats (frozen Phase 3 gating, untouched), so a colleague can still
 * confirm on someone's behalf from the order — they are simply no longer told to.
 *
 * Production-department MRFs are unchanged: they already go to that
 * department's own head, which is exactly one role.
 *
 * ## The orphan guard
 *
 * An MRF records its raiser by NAME (`raisedByName`, stamped from the account
 * name). If that name no longer belongs to any account — renamed, or removed —
 * narrowing to it would leave the confirmation on nobody's list but Admin's. So
 * an MRF whose raiser can't be found goes back to all the Office seats, as before.
 */

const norm = (s: string | null | undefined): string => String(s ?? "").trim().replace(/\s+/g, " ").toLowerCase();

export interface ConfirmTaskViewer {
  name: string;
  admin: boolean;
  /** The server's rule for this MRF's department — the outer bound, never widened. */
  mayConfirm: boolean;
}

export function showsConfirmReceiptTask(
  mrf: { office: boolean; raisedByName?: string | null },
  viewer: ConfirmTaskViewer,
  knownAccountNames: ReadonlySet<string>,
): boolean {
  if (!viewer.mayConfirm) return false;
  if (!mrf.office || viewer.admin) return true;
  const raiser = norm(mrf.raisedByName);
  if (!raiser || !knownAccountNames.has(raiser)) return true; // orphaned → every Office seat
  return raiser === norm(viewer.name);
}

/** The set `showsConfirmReceiptTask` compares against, built from account names. */
export const accountNameSet = (names: readonly (string | null | undefined)[]): ReadonlySet<string> =>
  new Set(names.map(norm).filter(Boolean));
