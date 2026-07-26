/**
 * Double-handshake stock actions. An Edit / Adjust / Reserve / Transfer proposed
 * on the Inventory page is held pending and only applied once BOTH a Warehouseman
 * and a Purchaser approve it. Types + serialisable view helpers.
 */
import type { StockActionKind, StockActionStatus } from "@prisma/client";
import { coerceStockDoc, type StockDoc } from "@/lib/stock-transfer";

export { coerceStockDoc };
export type { StockDoc };

export interface EditPayload {
  category: string | null;
  location: string | null;
  reorderLevel: number;
  unitCost: number;
  sellPrice: number;
}
export interface AdjustPayload {
  kind: "RECEIPT" | "ISSUE" | "ADJUSTMENT";
  qty: number;
  reason: string | null;
}
export interface ReservePayload {
  qty: number;
  forRef: string;
  note: string | null;
}
export interface TransferPayload {
  qty: number;
  toLocation: string;
  note: string | null;
  proof: StockDoc | null;
}
export type StockActionPayload = EditPayload | AdjustPayload | ReservePayload | TransferPayload;

/** The row shape the Inventory + dashboards render. */
export interface StockActionView {
  id: string;
  stockItemId: string;
  itemName: string;
  kind: StockActionKind;
  kindLabel: string;
  summary: string;
  status: StockActionStatus;
  proof: StockDoc | null; // transfer proof (eye-view), else null
  proposedByName: string;
  proposedAt: string;
  warehouseByName: string | null;
  purchaserByName: string | null;
  /** Whether the viewer may fill each still-open handshake slot. */
  canApproveWarehouse: boolean;
  canApprovePurchaser: boolean;
}

export const STOCK_ACTION_LABEL: Record<StockActionKind, string> = {
  EDIT: "Edit item",
  ADJUST: "Stock adjustment",
  RESERVE: "Reservation",
  TRANSFER: "Stock transfer",
};

/** Both handshakes complete? */
export function bothApproved(a: { warehouseAt: Date | null; purchaserAt: Date | null }): boolean {
  return a.warehouseAt != null && a.purchaserAt != null;
}
