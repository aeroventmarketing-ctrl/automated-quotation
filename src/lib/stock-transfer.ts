/**
 * Stock transfer between locations with a double-handshake receipt. Stock is
 * issued from the source on send (in transit) and received into the destination
 * only after BOTH a production head and the purchaser confirm the receiving
 * location got it. See src/app/(app)/inventory/transfer-actions.ts.
 */
import { PRODUCTION_DEPTS } from "@/lib/order-workflow";
import { userHasWorkflowRole, type WorkflowRoleKey, type WorkflowRoleAssignments } from "@/lib/workflow-roles";

export type StockTransferStatus = "IN_TRANSIT" | "RECEIVED" | "CANCELLED";

export const STOCK_TRANSFER_STATUS_LABEL: Record<StockTransferStatus, string> = {
  IN_TRANSIT: "In transit",
  RECEIVED: "Received",
  CANCELLED: "Cancelled",
};

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
  // Viewer capabilities on this row.
  canConfirmProdHead: boolean;
  canConfirmPurchaser: boolean;
  canUpload: boolean; // attach / remove proof
  canCancel: boolean; // recall an in-transit transfer
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
