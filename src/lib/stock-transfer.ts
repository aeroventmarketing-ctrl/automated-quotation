/**
 * Stock transfer between locations with a double-handshake receipt. Stock is
 * issued from the source on send (in transit) and received into the destination
 * only after BOTH a production head and the purchaser confirm the receiving
 * location got it. See src/app/(app)/inventory/transfer-actions.ts.
 */
import { PRODUCTION_DEPTS } from "@/lib/order-workflow";
import { userHasWorkflowRole, type WorkflowRoleKey, type WorkflowRoleAssignments } from "@/lib/workflow-roles";

export type StockTransferStatus =
  | "REQUESTED" | "APPROVED" | "RELEASED" | "DELIVERING" // Office chain (Fans → Office)
  | "IN_TRANSIT" | "RECEIVED" | "CANCELLED";

export const STOCK_TRANSFER_STATUS_LABEL: Record<StockTransferStatus, string> = {
  REQUESTED: "Requested",
  APPROVED: "Approved",
  RELEASED: "Released",
  DELIVERING: "Delivering",
  IN_TRANSIT: "In transit",
  RECEIVED: "Received",
  CANCELLED: "Cancelled",
};

/** The 5-step Office chain runs when a transfer's destination is the Office. */
export function isOfficeTransfer(toLocation: string): boolean {
  return (toLocation ?? "").trim().toLowerCase() === "office";
}

/** Office-chain statuses that still hold stock in transit (source already deducted). */
export const OFFICE_IN_FLIGHT: StockTransferStatus[] = ["RELEASED", "DELIVERING"];

/** An uploaded proof document (delivery note / photo). */
export interface StockDoc {
  path: string;
  name: string;
  uploadedAt: string; // ISO
}

/** Coerce arbitrary JSON (StockTransfer.proof) into a StockDoc, or null. */
export function coerceStockDoc(v: unknown): StockDoc | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  if (typeof o.path !== "string" || !o.path) return null;
  return {
    path: o.path,
    name: typeof o.name === "string" ? o.name : o.path.split("/").pop() ?? "file",
    uploadedAt: typeof o.uploadedAt === "string" ? o.uploadedAt : "",
  };
}

/** The row shape the transfers UI renders (dates as ISO strings, plus permissions). */
export interface StockTransferView {
  id: string;
  itemName: string;
  unit: string;
  qty: number;
  fromLocation: string;
  toLocation: string;
  status: StockTransferStatus;
  note: string | null;
  proof: StockDoc | null;
  initiatedByName: string;
  initiatedAt: string;
  prodHeadByName: string | null;
  prodHeadAt: string | null;
  purchaserByName: string | null;
  purchaserAt: string | null;
  receivedAt: string | null;
  cancelledByName: string | null;
  cancelledAt: string | null;
  // Office chain (Fans → Office) — step stamps.
  isOffice: boolean; // true → renders the 5-step Office chain instead of the handshake
  approvedByName: string | null;
  approvedAt: string | null;
  releasedByName: string | null;
  releasedAt: string | null;
  deliveredByName: string | null;
  deliveredAt: string | null;
  receivedByName: string | null;
  // Viewer capabilities on this row.
  canConfirmProdHead: boolean;
  canConfirmPurchaser: boolean;
  canApprove: boolean; // Office chain: Plant Manager approves the request
  canRelease: boolean; // Office chain: Warehouse releases (deducts source)
  canDeliver: boolean; // Office chain: Logistics delivers to Office
  canReceive: boolean; // Office chain: Sales/Office confirms receipt (credits Office)
  canUpload: boolean; // attach / remove proof
  canCancel: boolean; // recall an in-transit transfer
  /** Who must act next (designation + assigned names) — drives the flashing
   *  "awaiting approval" badge. Null once RECEIVED / CANCELLED. */
  nextApprover?: { role: string; names: string[] } | null;
}

/**
 * Who must act next on an OFFICE transfer, by status — designation + the assigned
 * people's names — for the flashing "awaiting approval" badge. Null once the
 * transfer is RECEIVED / CANCELLED (no one left to act). `dir` is an
 * ApproverDirectory-shaped lookup; `salesNames` are the base-role Sales users
 * (the office-receipt step is Sales OR the Purchaser).
 */
export function nextOfficeTransferApprover(
  status: StockTransferStatus,
  dir: { namesFor: (r: string) => string[]; labelFor: (r: string) => string },
  salesNames: string[],
): { role: string; names: string[] } | null {
  switch (status) {
    case "REQUESTED":
      return { role: dir.labelFor("plant_manager"), names: dir.namesFor("plant_manager") };
    case "APPROVED":
      return { role: dir.labelFor("warehouse"), names: dir.namesFor("warehouse") };
    case "RELEASED":
      return { role: dir.labelFor("logistics"), names: dir.namesFor("logistics") };
    case "DELIVERING":
      return { role: "Sales / Purchaser", names: Array.from(new Set([...salesNames, ...dir.namesFor("purchaser")])) };
    default:
      return null;
  }
}

const PROD_HEAD_ROLES = PRODUCTION_DEPTS.map((d) => d.role) as WorkflowRoleKey[];

/** Whether the user holds any production-head role. */
export function isProductionHead(roles: WorkflowRoleAssignments, userId: string): boolean {
  return PROD_HEAD_ROLES.some((r) => userHasWorkflowRole(roles, userId, r));
}

/** Whether the user holds the purchaser role. */
export function isPurchaserRole(roles: WorkflowRoleAssignments, userId: string): boolean {
  return userHasWorkflowRole(roles, userId, "purchaser" as WorkflowRoleKey);
}
