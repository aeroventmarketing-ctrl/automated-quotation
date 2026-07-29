/**
 * Supplier returns for a purchase request. When items in a PO fail inspection
 * (quality or any other reason) the inspector records a return here; the item
 * goes back to the supplier for replacement and is then tracked all the way back
 * into stock. A PO can't be received into stock while any return is still
 * unresolved (not yet approved by the Plant Manager).
 *
 * Each return walks a fixed lifecycle so every role can monitor the replacement:
 *   sent to supplier → replaced/changed by supplier → checked by purchaser →
 *   in transit to plant → warehouse received → approved by plant manager.
 *
 * Returns ride in the PurchaseRequest.returns JSON column (array). For a combined
 * PO they attach to the anchor request — the whole PO.
 */
import type { PRStatus } from "@/lib/purchasing";
import type { WorkflowRoleKey } from "@/lib/workflow-roles";
import type { SaleDoc } from "@/lib/sale";

/** The ordered lifecycle a returned item walks from supplier back into stock. */
export type ReturnStage =
  | "sent" // returned to supplier, awaiting a replacement
  | "replaced" // supplier replaced / changed the item
  | "checked" // purchaser checked the replacement
  | "in_transit" // replacement on its way back to the plant
  | "received" // warehouse received the replacement
  | "approved"; // plant manager approved — return complete

export interface ReturnStamp {
  byName: string;
  role: string; // designation the actor advanced the stage in
  at: string; // ISO
}

export interface ReturnStageDef {
  key: ReturnStage;
  /** Status label for a return sitting AT this stage. */
  label: string;
  /** Button text to advance a return INTO this stage. */
  advanceLabel: string;
  /** The workflow role that advances a return INTO this stage (null = raise). */
  role: WorkflowRoleKey | null;
  /** Proof that the item was replaced is mandatory to reach this stage. */
  requiresProof?: boolean;
}

/** The lifecycle, in order. The first entry ("sent") is set when the return is raised. */
export const RETURN_STAGES: ReturnStageDef[] = [
  { key: "sent", label: "Sent to supplier", advanceLabel: "", role: null },
  { key: "replaced", label: "Replaced / changed by supplier", advanceLabel: "Supplier replaced item", role: "purchaser" },
  { key: "checked", label: "Checked by purchaser", advanceLabel: "Purchaser checked", role: "purchaser" },
  { key: "in_transit", label: "In transit to plant", advanceLabel: "Dispatch to plant", role: "logistics" },
  { key: "received", label: "Warehouse received", advanceLabel: "Warehouse received", role: "warehouse", requiresProof: true },
  { key: "approved", label: "Approved by plant manager", advanceLabel: "Approve (Plant Manager)", role: "plant_manager" },
];
export const RETURN_STAGE_ORDER: ReturnStage[] = RETURN_STAGES.map((s) => s.key);
const RETURN_STAGE_SET = new Set<string>(RETURN_STAGE_ORDER);

export function returnStageIndex(stage: ReturnStage): number {
  return RETURN_STAGE_ORDER.indexOf(stage);
}
export function returnStageDef(stage: ReturnStage): ReturnStageDef {
  return RETURN_STAGES[returnStageIndex(stage)] ?? RETURN_STAGES[0];
}
/** The stage a return should advance to next, or null if already approved. */
export function nextReturnStage(stage: ReturnStage): ReturnStageDef | null {
  const i = returnStageIndex(stage);
  return i >= 0 && i < RETURN_STAGES.length - 1 ? RETURN_STAGES[i + 1] : null;
}
/** True once the Plant Manager has approved — the return is fully complete. */
export function isReturnComplete(stage: ReturnStage): boolean {
  return stage === "approved";
}

export interface PurchaseReturn {
  id: string;
  items: string; // free text: which item(s) + quantity being returned
  reason: string; // why it was disapproved (quality / wrong item / damaged / …)
  raisedByName: string;
  raisedRole: string; // designation the return was raised in
  raisedAt: string; // ISO
  stage: ReturnStage; // current lifecycle stage
  stamps: Partial<Record<ReturnStage, ReturnStamp>>; // who advanced each stage + when
  resolvedByName?: string; // set when the return reaches "approved"
  resolvedRole?: string;
  resolvedAt?: string; // ISO — plant-manager approval (fully resolved)
  resolutionNote?: string;
  proof?: SaleDoc[]; // proof the item was replaced (attached at "warehouse received")
}

function coerceDoc(v: unknown): SaleDoc | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  if (typeof o.path !== "string" || typeof o.name !== "string") return null;
  return { path: o.path, name: o.name, uploadedAt: typeof o.uploadedAt === "string" ? o.uploadedAt : "" };
}

function coerceStamp(v: unknown): ReturnStamp | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  if (typeof o.at !== "string") return null;
  return {
    byName: typeof o.byName === "string" ? o.byName : "",
    role: typeof o.role === "string" ? o.role : "",
    at: o.at,
  };
}

function coerceStamps(v: unknown): Partial<Record<ReturnStage, ReturnStamp>> {
  const out: Partial<Record<ReturnStage, ReturnStamp>> = {};
  if (!v || typeof v !== "object") return out;
  for (const [k, e] of Object.entries(v as Record<string, unknown>)) {
    if (!RETURN_STAGE_SET.has(k)) continue;
    const s = coerceStamp(e);
    if (s) out[k as ReturnStage] = s;
  }
  return out;
}

export function coercePurchaseReturns(v: unknown): PurchaseReturn[] {
  if (!Array.isArray(v)) return [];
  const out: PurchaseReturn[] = [];
  for (const e of v) {
    if (!e || typeof e !== "object") continue;
    const o = e as Record<string, unknown>;
    if (typeof o.id !== "string") continue;
    const raisedByName = typeof o.raisedByName === "string" ? o.raisedByName : "";
    const raisedRole = typeof o.raisedRole === "string" ? o.raisedRole : "";
    const raisedAt = typeof o.raisedAt === "string" ? o.raisedAt : "";
    const resolvedAt = typeof o.resolvedAt === "string" ? o.resolvedAt : undefined;
    // Stage: honour a stored stage; else migrate legacy rows (resolved → approved,
    // otherwise still sitting at "sent" with the supplier).
    const stage: ReturnStage =
      typeof o.stage === "string" && RETURN_STAGE_SET.has(o.stage) ? (o.stage as ReturnStage) : resolvedAt ? "approved" : "sent";
    const stamps = coerceStamps(o.stamps);
    // Ensure the "sent" stamp always exists (it's the raise).
    if (!stamps.sent && raisedAt) stamps.sent = { byName: raisedByName, role: raisedRole, at: raisedAt };
    out.push({
      id: o.id,
      items: typeof o.items === "string" ? o.items : "",
      reason: typeof o.reason === "string" ? o.reason : "",
      raisedByName,
      raisedRole,
      raisedAt,
      stage,
      stamps,
      resolvedByName: typeof o.resolvedByName === "string" ? o.resolvedByName : undefined,
      resolvedRole: typeof o.resolvedRole === "string" ? o.resolvedRole : undefined,
      resolvedAt,
      resolutionNote: typeof o.resolutionNote === "string" ? o.resolutionNote : undefined,
      proof: Array.isArray(o.proof) ? o.proof.map(coerceDoc).filter((d): d is SaleDoc => d !== null) : undefined,
    });
  }
  return out;
}

/** True once at least one return is still walking back (not yet plant-approved). */
export function hasUnresolvedReturn(returns: PurchaseReturn[]): boolean {
  return returns.some((r) => !isReturnComplete(r.stage));
}

/**
 * A return can be raised once the items exist to inspect — from the purchaser's
 * check through the plant manager's final approval, and even after the good
 * items have been received into stock (COMPLETED): a defect found later can
 * still be sent back, and an open return stays actionable on a received PO.
 */
const RETURNABLE_STATUSES: PRStatus[] = ["PURCHASED", "CHECKED", "DELIVERED", "RECEIVED", "PLANT_APPROVED", "COMPLETED"];
export function canRaiseReturnAt(status: PRStatus): boolean {
  return RETURNABLE_STATUSES.includes(status);
}
