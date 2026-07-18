"use server";

import { randomUUID } from "crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { COMPANY } from "@/lib/config";
import { getCurrentUser, isAdmin } from "@/lib/auth";
import { coercePurchaseOrder, formatPoNumber, type PurchaseOrder } from "@/lib/purchase-order";
import { poMemberIds, poBatchId } from "@/lib/purchase-batch";
import { rememberProduct } from "@/lib/product-catalog";
import { rememberSupplier } from "@/lib/suppliers";
import { savePaymentTerm, type PaymentTerm } from "@/lib/payment-terms";
import {
  getWorkflowRoles,
  userHasWorkflowRole,
  workflowRoleLabel,
  type WorkflowRoleKey,
} from "@/lib/workflow-roles";
import {
  ORDER_STEPS,
  ORDER_STAGES,
  APPROVAL_STEPS,
  stageIndex,
  readOrderWorkflow,
  PRODUCTION_DEPTS,
  deptRole,
  deptLabel,
  allJobOrdersFinished,
  type OrderStage,
  type OrderStepKey,
  type ProductionDeptKey,
  type JobOrder,
  type MaterialRequest,
  type MRFItem,
  type MRFLineDisposition,
} from "@/lib/order-workflow";
import { purchaseStep, isCancellable, type PRStatus } from "@/lib/purchasing";
import { saleFromClassification, docCheckMissing } from "@/lib/sale";
import { payableTotal, round2 } from "@/lib/quote";
import { applyStockChange } from "@/lib/inventory";
import { coerceFansJobOrder, joTypeReady, joTypeLabel, type FansJobOrder } from "@/lib/job-order";

interface StockMatch { stockItemId: string; qty: number }

const DEPT_KEY_SET = new Set(PRODUCTION_DEPTS.map((d) => d.key));
const COMMISSION_RATE_PCT = 1.5;

/**
 * Advance an order through a Phase 1 approval step. The signed-in user must hold
 * the step's workflow role (or be an admin), and the order must be at the step's
 * "from" stage. Records the sign-off (who + when) and moves the stage forward.
 */
export async function advanceOrderStage(quotationId: string, step: OrderStepKey): Promise<void> {
  const user = await getCurrentUser();
  if (!user) throw new Error("Unauthorized");

  const def = ORDER_STEPS[step];
  if (!def) throw new Error("Unknown step");

  const assignments = await getWorkflowRoles();
  const allowed = isAdmin(user) || userHasWorkflowRole(assignments, user.id, def.requiredRole);
  if (!allowed) {
    throw new Error(`Only ${workflowRoleLabel(def.requiredRole)} or an admin can do this.`);
  }

  const quote = await prisma.quotation.findUnique({
    where: { id: quotationId },
    select: { id: true, classification: true },
  });
  if (!quote) throw new Error("Order not found");

  const wf = readOrderWorkflow(quote.classification);
  if (wf.stage !== def.from) {
    throw new Error("This step isn't available at the order's current stage.");
  }

  // Documents can only be marked checked once the required files are attached.
  if (step === "doc_check") {
    const missing = docCheckMissing(saleFromClassification(quote.classification));
    if (missing.length) throw new Error(`Attach ${missing.join(", ")} before marking documents checked.`);
  }

  const cls = (quote.classification as Record<string, unknown>) ?? {};
  const workflow = {
    ...wf,
    stage: def.to,
    approvals: {
      ...wf.approvals,
      [step]: { by: user.id, byName: user.name, at: new Date().toISOString() },
    },
  };

  await prisma.quotation.update({
    where: { id: quotationId },
    data: { classification: { ...cls, workflow } as unknown as Prisma.InputJsonObject },
  });
  revalidatePath("/orders");
  revalidatePath(`/orders/${quotationId}`);
}

async function loadWorkflow(quotationId: string) {
  const quote = await prisma.quotation.findUnique({
    where: { id: quotationId },
    select: { id: true, quoteNumber: true, classification: true, preparedById: true },
  });
  if (!quote) throw new Error("Order not found");
  return { quote, cls: (quote.classification as Record<string, unknown>) ?? {}, wf: readOrderWorkflow(quote.classification) };
}

async function saveWorkflow(quotationId: string, cls: Record<string, unknown>, workflow: unknown) {
  await prisma.quotation.update({
    where: { id: quotationId },
    data: { classification: { ...cls, workflow } as unknown as Prisma.InputJsonObject },
  });
  revalidatePath("/orders");
  revalidatePath(`/orders/${quotationId}`);
}

/**
 * Technical Head issues job orders to the relevant departments. The order must be
 * released (Phase 1 complete); this moves it into production.
 */
export async function issueJobOrders(quotationId: string, deptKeys: string[]): Promise<void> {
  const user = await getCurrentUser();
  if (!user) throw new Error("Unauthorized");
  if (!(isAdmin(user) || userHasWorkflowRole(await getWorkflowRoles(), user.id, "technical_head" as WorkflowRoleKey))) {
    throw new Error("Only the Technical Head or an admin can issue job orders.");
  }
  const depts = Array.from(new Set(deptKeys.filter((k) => DEPT_KEY_SET.has(k as ProductionDeptKey)))) as ProductionDeptKey[];
  if (depts.length === 0) throw new Error("Select at least one department.");

  const { cls, wf } = await loadWorkflow(quotationId);
  if (wf.stage !== "released") throw new Error("Job orders can only be issued once the order is released.");

  const now = new Date().toISOString();
  const jobOrders = { ...wf.jobOrders };
  for (const d of depts) jobOrders[d] = { status: "issued", issuedAt: now, issuedByName: user.name };

  await saveWorkflow(quotationId, cls, { ...wf, stage: "in_production", jobOrders });
}

/**
 * The Plant Manager receives the released job orders before production can begin.
 * Moves the order from "JO released" (in_production) to "JO Received" (jo_received).
 */
export async function receiveJobOrders(quotationId: string): Promise<void> {
  const user = await getCurrentUser();
  if (!user) throw new Error("Unauthorized");
  if (!(isAdmin(user) || userHasWorkflowRole(await getWorkflowRoles(), user.id, "plant_manager" as WorkflowRoleKey))) {
    throw new Error("Only the Plant Manager or an admin can receive job orders.");
  }
  const { cls, wf } = await loadWorkflow(quotationId);
  if (wf.stage !== "in_production") throw new Error("Job orders can only be received once they are released.");
  await saveWorkflow(quotationId, cls, { ...wf, stage: "jo_received", approvals: stamp(wf, "jo_received", user) });
}

/**
 * A department's Head of Production advances its job order: issued → in_production
 * → finished. Production runs once the Plant Manager has received the job orders
 * (jo_received). When every issued job order is finished, the order moves to
 * "production finished" (Sales can then coordinate delivery).
 */
export async function advanceJobOrder(
  quotationId: string,
  dept: string,
  to: "in_production" | "finished",
): Promise<void> {
  const user = await getCurrentUser();
  if (!user) throw new Error("Unauthorized");
  if (!DEPT_KEY_SET.has(dept as ProductionDeptKey)) throw new Error("Unknown department");
  const deptKey = dept as ProductionDeptKey;

  if (!(isAdmin(user) || userHasWorkflowRole(await getWorkflowRoles(), user.id, deptRole(deptKey) as WorkflowRoleKey))) {
    throw new Error(`Only the ${deptLabel(deptKey)} head or an admin can update this job order.`);
  }

  const { cls, wf } = await loadWorkflow(quotationId);
  if (wf.stage !== "jo_received" && wf.stage !== "producing") throw new Error("Production can start only after the Plant Manager receives the job orders.");
  const jo = wf.jobOrders[deptKey];
  if (!jo) throw new Error("No job order for this department.");

  const valid = (to === "in_production" && jo.status === "issued") || (to === "finished" && jo.status === "in_production");
  if (!valid) throw new Error("That job-order step isn't available right now.");

  const now = new Date().toISOString();
  const updated: JobOrder =
    to === "in_production"
      ? { ...jo, status: "in_production", startedAt: now, startedByName: user.name }
      : { ...jo, status: "finished", finishedAt: now, finishedByName: user.name };

  const nextWf = { ...wf, jobOrders: { ...wf.jobOrders, [deptKey]: updated } };
  // First "Start production" moves the order from JO Received into In Production.
  if (to === "in_production" && nextWf.stage === "jo_received") nextWf.stage = "producing";
  if (allJobOrdersFinished(nextWf)) nextWf.stage = "production_finished";

  await saveWorkflow(quotationId, cls, nextWf);
}

// --- Fans & Blowers Job Orders (Engineer) ---------------------------------

/** Next running JO base sequence (claimed once per order). */
async function nextJoBaseNo(): Promise<number> {
  const KEY = "jo_counter";
  return prisma.$transaction(async (tx) => {
    const row = await tx.appSetting.findUnique({ where: { key: KEY } });
    const last = Number((row?.value as { last?: unknown } | null)?.last ?? 0) || 0;
    const next = last + 1;
    await tx.appSetting.upsert({
      where: { key: KEY },
      create: { key: KEY, value: { last: next } as Prisma.InputJsonValue },
      update: { value: { last: next } as Prisma.InputJsonValue },
    });
    return next;
  });
}

const fansJoSchema = z.object({
  type: z.string().trim().default("centrifugal_blower"),
  date: z.string().trim().default(""),
  project: z.string().trim().default(""),
  make: z.string().trim().default(""),
  targetDate: z.string().trim().default(""),
  quantity: z.string().trim().default(""),
  uom: z.string().trim().default(""),
  bodyLeadTime: z.string().trim().default(""),
  bladeLeadTime: z.string().trim().default(""),
  bladeDiameter: z.string().trim().default(""),
  orientation: z.string().trim().default(""),
  rotation: z.string().trim().default(""),
  bladeType: z.string().trim().default(""),
  driveType: z.string().trim().default(""),
  capacity: z.string().trim().default(""),
  capacityAt0: z.string().trim().default(""),
  rpmCatalogue: z.string().trim().default(""),
  motorBrand: z.string().trim().default(""),
  motorPhAlias: z.string().trim().default(""),
  motorHp: z.string().trim().default(""),
  voltage: z.string().trim().default(""),
  frequency: z.string().trim().default(""),
  mounting: z.string().trim().default(""),
  enclosure: z.string().trim().default(""),
  motorPulley: z.string().trim().default(""),
  fanPulley: z.string().trim().default(""),
  assignedPersonnel: z.string().trim().default(""),
  directDrive: z.boolean().optional().default(false),
});

async function assertEngineer() {
  const user = await getCurrentUser();
  if (!user) throw new Error("Unauthorized");
  if (!(isAdmin(user) || user.role === "ENGINEER")) {
    throw new Error("Only an engineer or an admin can make a Fans & Blowers job order.");
  }
  return user;
}

/**
 * The Engineer creates or edits a Fans & Blowers job order on an order. Pass
 * index = null to add a new one, or an existing index to edit. The first JO on
 * an order claims the running base number.
 */
export async function saveFansJobOrder(
  quotationId: string,
  index: number | null,
  input: z.infer<typeof fansJoSchema>,
): Promise<void> {
  await assertEngineer();
  const d = fansJoSchema.parse(input);
  if (!joTypeReady(d.type)) {
    throw new Error(`The "${joTypeLabel(d.type)}" job order template is not set up yet.`);
  }
  const { cls, wf } = await loadWorkflow(quotationId);

  let joBaseNo = wf.joBaseNo;
  let joBaseYear = wf.joBaseYear;
  if (joBaseNo == null) {
    joBaseNo = await nextJoBaseNo();
    joBaseYear = new Date().getFullYear();
  }

  const jo: FansJobOrder = { ...(coerceFansJobOrder({}) as FansJobOrder), ...d };
  const list = [...wf.fansJobOrders];
  if (index != null && index >= 0 && index < list.length) list[index] = jo;
  else list.push(jo);

  await saveWorkflow(quotationId, cls, { ...wf, fansJobOrders: list, joBaseNo, joBaseYear });
}

/** Remove a Fans & Blowers job order by index. */
export async function deleteFansJobOrder(quotationId: string, index: number): Promise<void> {
  await assertEngineer();
  const { cls, wf } = await loadWorkflow(quotationId);
  const list = wf.fansJobOrders.filter((_, i) => i !== index);
  await saveWorkflow(quotationId, cls, { ...wf, fansJobOrders: list });
}

/**
 * A production department's head raises a Material Request Form against the order
 * (during production). The warehouse then issues or escalates it.
 */
export async function raiseMaterialRequest(
  quotationId: string,
  dept: string,
  items: MRFItem[],
  note: string,
): Promise<void> {
  const user = await getCurrentUser();
  if (!user) throw new Error("Unauthorized");
  if (!DEPT_KEY_SET.has(dept as ProductionDeptKey)) throw new Error("Unknown department");
  const deptKey = dept as ProductionDeptKey;

  if (!(isAdmin(user) || userHasWorkflowRole(await getWorkflowRoles(), user.id, deptRole(deptKey) as WorkflowRoleKey))) {
    throw new Error(`Only the ${deptLabel(deptKey)} head or an admin can raise its material request.`);
  }

  const cleanItems: MRFItem[] = (items ?? [])
    .map((it) => ({
      description: (it.description ?? "").trim(),
      qty: (it.qty ?? "").trim(),
      unit: (it.unit ?? "").trim(),
      remark: (it.remark ?? "").trim() || undefined,
    }))
    .filter((it) => it.description !== "");
  if (cleanItems.length === 0) throw new Error("List at least one item.");

  const { cls, wf } = await loadWorkflow(quotationId);
  const deptJo = wf.jobOrders[deptKey];
  if (!deptJo) throw new Error("This department has no job order on this order.");
  // Phase 3 opens only once production has started on this job order — after the
  // Plant Manager receives the released job orders, the production head presses
  // "Start production" (status leaves "issued").
  if (deptJo.status === "issued") {
    throw new Error("Start production on this job order before requesting materials.");
  }

  const req: MaterialRequest = {
    id: randomUUID(),
    formNo: await nextMrfNo(),
    dept: deptKey,
    items: cleanItems,
    note: note.trim() || undefined,
    status: "requested",
    raisedAt: new Date().toISOString(),
    raisedByName: user.name,
  };
  await saveWorkflow(quotationId, cls, { ...wf, materialRequests: [...wf.materialRequests, req] });

  // Auto-save any newly typed items to the product catalogue (best effort — the
  // product table may not exist yet). Never blocks the request.
  try {
    for (const it of cleanItems) await rememberProduct(it.description, it.unit);
  } catch {
    /* product table not migrated yet — ignore */
  }
}

/** Next running Material Request Form number, zero-padded (e.g. "0173"). */
async function nextMrfNo(): Promise<string> {
  const KEY = "mrf_counter";
  return prisma.$transaction(async (tx) => {
    const row = await tx.appSetting.findUnique({ where: { key: KEY } });
    const last = Number((row?.value as { last?: unknown } | null)?.last ?? 0) || 0;
    const next = last + 1;
    await tx.appSetting.upsert({
      where: { key: KEY },
      create: { key: KEY, value: { last: next } as Prisma.InputJsonValue },
      update: { value: { last: next } as Prisma.InputJsonValue },
    });
    return String(next).padStart(4, "0");
  });
}

/**
 * The requesting department head (or an admin) withdraws a material request
 * before the warehouse handles it. Only possible while it's still "requested".
 */
export async function cancelMaterialRequest(quotationId: string, requestId: string): Promise<void> {
  const user = await getCurrentUser();
  if (!user) throw new Error("Unauthorized");
  const { cls, wf } = await loadWorkflow(quotationId);
  const idx = wf.materialRequests.findIndex((m) => m.id === requestId);
  if (idx < 0) throw new Error("Material request not found.");
  const mrf = wf.materialRequests[idx];
  if (mrf.status !== "requested") throw new Error("Only a request the warehouse hasn't handled yet can be cancelled.");
  if (!(isAdmin(user) || userHasWorkflowRole(await getWorkflowRoles(), user.id, deptRole(mrf.dept) as WorkflowRoleKey))) {
    throw new Error(`Only the ${deptLabel(mrf.dept)} head or an admin can cancel this material request.`);
  }
  const materialRequests = wf.materialRequests.slice();
  materialRequests[idx] = { ...mrf, status: "cancelled", handledAt: new Date().toISOString(), handledByName: user.name };
  await saveWorkflow(quotationId, cls, { ...wf, materialRequests });
}

/** Render one MRF item as a single display line for the purchasing chain. */
function mrfItemLine(it: MRFItem): string {
  const qtyUnit = [it.qty, it.unit].filter(Boolean).join(" ");
  return [qtyUnit, it.description].filter(Boolean).join(" · ") + (it.remark ? ` (${it.remark})` : "");
}

interface LineDisposition {
  action: "issue" | "purchase" | "reserve";
  stockItemId?: string;
  qty?: number;
}

/**
 * Warehouse triages a material request line by line: some items are issued from
 * stock (deducted here), the rest are escalated to a single purchase request.
 * All in one transaction. The MRF is marked issued / purchasing / partial to
 * reflect the mix, and each line records its disposition.
 */
export async function processMaterialRequest(
  quotationId: string,
  requestId: string,
  dispositions: LineDisposition[],
): Promise<void> {
  const user = await getCurrentUser();
  if (!user) throw new Error("Unauthorized");
  if (!(isAdmin(user) || userHasWorkflowRole(await getWorkflowRoles(), user.id, "warehouse" as WorkflowRoleKey))) {
    throw new Error("Only the Warehouse or an admin can handle material requests.");
  }

  const { quote, cls, wf } = await loadWorkflow(quotationId);
  const idx = wf.materialRequests.findIndex((m) => m.id === requestId);
  if (idx < 0) throw new Error("Material request not found.");
  const mrf = wf.materialRequests[idx];
  if (mrf.status !== "requested") throw new Error("This request has already been handled.");
  if (!Array.isArray(dispositions) || dispositions.length !== mrf.items.length) {
    throw new Error("Mark every line as issue-from-stock or purchase.");
  }

  const dispOf = (a: LineDisposition["action"]): MRFLineDisposition =>
    a === "purchase" ? "purchase" : a === "reserve" ? "reserve" : "issue";
  const items: MRFItem[] = mrf.items.map((it, i) => ({ ...it, disposition: dispOf(dispositions[i]?.action ?? "issue") }));
  const matchesFor = (action: "issue" | "reserve") =>
    dispositions
      .filter((d) => d.action === action && d.stockItemId && Number(d.qty) > 0)
      .map((d) => ({ stockItemId: d.stockItemId as string, qty: Number(d.qty) }));
  const issueMatches = matchesFor("issue");
  const reserveMatches = matchesFor("reserve");
  const purchaseItems = items.filter((it) => it.disposition === "purchase");

  const anyStock = items.some((it) => it.disposition === "issue" || it.disposition === "reserve");
  const anyPurchase = purchaseItems.length > 0;
  if (!anyStock && !anyPurchase) throw new Error("Nothing to process.");
  const status: MaterialRequest["status"] = anyStock && anyPurchase ? "partial" : anyPurchase ? "purchasing" : "issued";
  const orderRef = quote.quoteNumber || "order";

  await prisma.$transaction(async (tx) => {
    for (const m of issueMatches) {
      await applyStockChange(tx, { stockItemId: m.stockItemId, kind: "ISSUE", qty: m.qty, reason: `MRF #${mrf.formNo}` }, user.name);
    }
    // Reserve lines: soft-hold against the order (available = on-hand − reserved).
    for (const m of reserveMatches) {
      const item = await tx.stockItem.findUnique({ where: { id: m.stockItemId } });
      if (!item) continue;
      const agg = await tx.stockReservation.aggregate({ where: { stockItemId: m.stockItemId, active: true }, _sum: { qty: true } });
      const available = Number(item.quantity) - Number(agg._sum.qty ?? 0);
      if (m.qty > available) throw new Error(`Only ${available} ${item.unit} of ${item.name} available to reserve.`);
      await tx.stockReservation.create({
        data: { stockItemId: m.stockItemId, qty: m.qty, forRef: orderRef, note: `MRF #${mrf.formNo}`, byName: user.name },
      });
    }
    const materialRequests = wf.materialRequests.slice();
    materialRequests[idx] = { ...mrf, items, status, handledAt: new Date().toISOString(), handledByName: user.name };
    await tx.quotation.update({
      where: { id: quotationId },
      data: { classification: { ...cls, workflow: { ...wf, materialRequests } } as unknown as Prisma.InputJsonObject },
    });
    if (anyPurchase) {
      await tx.purchaseRequest.create({
        data: {
          quotationId,
          mrfId: mrf.id,
          dept: mrf.dept,
          items: purchaseItems.map(mrfItemLine) as Prisma.InputJsonValue,
          note: mrf.note ?? null,
          createdById: user.id,
          createdByName: user.name,
          status: "PENDING_APPROVAL",
        },
      });
    }
  });

  revalidatePath("/orders");
  revalidatePath(`/orders/${quotationId}`);
  revalidatePath("/inventory");
}

/**
 * Advance a PurchaseRequest one step along the chain (approve/reject → voucher →
 * buy → check → receive → final approval). Guarded by the step's workflow role.
 */
export async function advancePurchaseRequest(
  purchaseRequestId: string,
  stepKey: string,
  note?: string,
): Promise<void> {
  const user = await getCurrentUser();
  if (!user) throw new Error("Unauthorized");
  const step = purchaseStep(stepKey);
  if (!step) throw new Error("Unknown step");

  if (!(isAdmin(user) || userHasWorkflowRole(await getWorkflowRoles(), user.id, step.role))) {
    throw new Error(`Only ${workflowRoleLabel(step.role)} or an admin can do this.`);
  }

  const pr = await prisma.purchaseRequest.findUnique({ where: { id: purchaseRequestId } });
  if (!pr) throw new Error("Purchase request not found");
  if (pr.status !== step.from) throw new Error("That step isn't available at the current status.");

  // The supplier Purchase Order must be issued before the request can be
  // approved/rejected or the voucher & check readied — everything downstream is
  // drawn against the PO. (Replenishment top-ups have no PO panel, so this only
  // gates order-linked purchase requests.)
  const poRequiredSteps = new Set(["approve", "reject", "voucher"]);
  if (poRequiredSteps.has(stepKey) && pr.kind !== "replenishment" && !coercePurchaseOrder(pr.po)) {
    throw new Error("Create the Purchase Order first.");
  }

  const now = new Date();
  const data: Prisma.PurchaseRequestUpdateInput = { status: step.to };
  switch (stepKey) {
    case "approve":
    case "reject":
      data.decidedById = user.id;
      data.decidedByName = user.name;
      data.decidedAt = now;
      if (note) data.decisionNote = note;
      break;
    case "voucher":
      data.voucherByName = user.name;
      data.voucherAt = now;
      if (note) data.voucherRef = note;
      break;
    case "buy":
      data.purchasedByName = user.name;
      data.purchasedAt = now;
      break;
    case "check":
      data.checkedByName = user.name;
      data.checkedAt = now;
      break;
    case "receive":
      data.receivedByName = user.name;
      data.receivedAt = now;
      break;
    case "plant":
      data.plantApprovedByName = user.name;
      data.plantApprovedAt = now;
      break;
  }
  await prisma.purchaseRequest.update({ where: { id: purchaseRequestId }, data });
  if (pr.quotationId) revalidatePath(`/orders/${pr.quotationId}`);
  revalidatePath("/purchasing");
}

/**
 * Cancel a purchase request (single or the whole combined PO). Before approval
 * the requestor, the purchaser, or an admin can cancel; once approved only an
 * admin can. Not possible once received into stock.
 */
export async function cancelPurchaseRequest(purchaseRequestId: string): Promise<void> {
  const user = await getCurrentUser();
  if (!user) throw new Error("Unauthorized");
  const pr = await prisma.purchaseRequest.findUnique({ where: { id: purchaseRequestId } });
  if (!pr) throw new Error("Purchase request not found");
  // Cancel every member if it's part of a combined PO, otherwise just this one.
  const ids = poMemberIds(pr.po);
  const targetIds = ids.length ? ids : [pr.id];
  const members = await prisma.purchaseRequest.findMany({ where: { id: { in: targetIds } } });
  if (members.some((m) => !isCancellable(m.status as PRStatus))) {
    throw new Error("This purchase order can no longer be cancelled.");
  }

  const admin = isAdmin(user);
  const purchaser = userHasWorkflowRole(await getWorkflowRoles(), user.id, "purchaser" as WorkflowRoleKey);
  const requestor = members.some((m) => m.createdById === user.id);
  const approvedPhase = members.some((m) => (m.status as PRStatus) !== "PENDING_APPROVAL");
  if (approvedPhase) {
    if (!admin) throw new Error("Once approved, a purchase order can only be cancelled by an admin.");
  } else if (!(admin || purchaser || requestor)) {
    throw new Error("Only the requestor, the purchaser, or an admin can cancel this.");
  }

  const now = new Date();
  await prisma.$transaction(
    targetIds.map((id) =>
      prisma.purchaseRequest.update({ where: { id }, data: { status: "CANCELLED", decidedByName: user.name, decidedAt: now } }),
    ),
  );
  for (const qid of [...new Set(members.map((m) => m.quotationId).filter((q): q is string => !!q))]) {
    revalidatePath(`/orders/${qid}`);
  }
  revalidatePath("/purchasing");
}

// --- Supplier Purchase Order ------------------------------------------------

const poInputSchema = z.object({
  supplier: z.object({
    company: z.string().trim().default(""),
    attention: z.string().trim().default(""),
    address: z.string().trim().default(""),
  }),
  date: z.string().trim().default(""),
  lines: z
    .array(
      z.object({
        description: z.string().trim().default(""),
        qty: z.string().trim().default(""),
        unit: z.string().trim().default(""),
        unitPrice: z.string().trim().default(""),
      }),
    )
    .default([]),
  ewtPct: z.number().min(0).max(100).default(1),
  remarks: z.string().trim().default(""),
});

/** Next running Purchase Order number: PO-AFBM<year><7-digit seq>. */
async function nextPoNo(): Promise<string> {
  const KEY = "po_counter";
  const year = new Date().getFullYear();
  return prisma.$transaction(async (tx) => {
    const row = await tx.appSetting.findUnique({ where: { key: KEY } });
    const last = Number((row?.value as { last?: unknown } | null)?.last ?? 0) || 0;
    const next = last + 1;
    await tx.appSetting.upsert({
      where: { key: KEY },
      create: { key: KEY, value: { last: next } as Prisma.InputJsonValue },
      update: { value: { last: next } as Prisma.InputJsonValue },
    });
    return formatPoNumber(next, year);
  });
}

/**
 * The purchaser issues (or edits) the supplier Purchase Order on a purchase
 * request: supplier details, priced lines, EWT % and remarks. The PO number is
 * assigned once, on first save, and never changes afterwards. Purchaser/admin only.
 */
export async function savePurchaseOrder(
  purchaseRequestId: string,
  input: z.infer<typeof poInputSchema>,
): Promise<void> {
  const user = await getCurrentUser();
  if (!user) throw new Error("Unauthorized");
  if (!(isAdmin(user) || userHasWorkflowRole(await getWorkflowRoles(), user.id, "purchaser" as WorkflowRoleKey))) {
    throw new Error("Only the Purchaser or an admin can issue a purchase order.");
  }
  const d = poInputSchema.parse(input);

  const pr = await prisma.purchaseRequest.findUnique({ where: { id: purchaseRequestId } });
  if (!pr) throw new Error("Purchase request not found");
  if (pr.status === "REJECTED") throw new Error("This purchase request was rejected.");

  const lines = d.lines.filter((l) => l.description.trim() !== "");
  if (lines.length === 0) throw new Error("Add at least one line to the purchase order.");

  const existing = coercePurchaseOrder(pr.po);
  const po: PurchaseOrder = {
    poNumber: existing?.poNumber ?? (await nextPoNo()),
    date: d.date || new Date().toISOString(),
    supplier: d.supplier,
    lines,
    ewtPct: d.ewtPct,
    remarks: d.remarks || COMPANY.poDefaultRemarks,
    createdByName: existing?.createdByName ?? user.name,
    createdAt: existing?.createdAt ?? new Date().toISOString(),
  };

  await prisma.purchaseRequest.update({
    where: { id: purchaseRequestId },
    data: { po: po as unknown as Prisma.InputJsonObject },
  });
  // Remember the supplier for next time (searchable in the PO form).
  await rememberSupplier(po.supplier);
  revalidatePath(`/orders/${pr.quotationId}`);
}

// --- Combined Purchase Order (one PO covering several requests) -------------

/**
 * Create one supplier Purchase Order covering several purchase requests (a
 * "batch"). Every selected request must be pending approval with no PO yet.
 * The combined PO (one number, all lines) is written to each member and they
 * move through the chain together. Purchaser/admin only.
 */
export async function createCombinedPO(
  purchaseRequestIds: string[],
  input: z.infer<typeof poInputSchema>,
): Promise<void> {
  const user = await getCurrentUser();
  if (!user) throw new Error("Unauthorized");
  if (!(isAdmin(user) || userHasWorkflowRole(await getWorkflowRoles(), user.id, "purchaser" as WorkflowRoleKey))) {
    throw new Error("Only the Purchaser or an admin can issue a purchase order.");
  }
  const ids = [...new Set((purchaseRequestIds ?? []).filter(Boolean))];
  if (ids.length < 2) throw new Error("Select at least two requests to combine.");
  const d = poInputSchema.parse(input);
  const lines = d.lines.filter((l) => l.description.trim() !== "");
  if (lines.length === 0) throw new Error("Add at least one line to the purchase order.");

  const prs = await prisma.purchaseRequest.findMany({ where: { id: { in: ids } } });
  if (prs.length !== ids.length) throw new Error("Some requests could not be found.");
  for (const pr of prs) {
    if (pr.status !== "PENDING_APPROVAL") throw new Error("Every request must be awaiting approval to combine.");
    if (coercePurchaseOrder(pr.po)) throw new Error("One of the requests already has a purchase order.");
  }

  const poNumber = await nextPoNo();
  const now = new Date().toISOString();
  const po = {
    poNumber,
    date: d.date || now,
    supplier: d.supplier,
    lines,
    ewtPct: d.ewtPct,
    remarks: d.remarks || COMPANY.poDefaultRemarks,
    createdByName: user.name,
    createdAt: now,
    batchId: randomUUID(),
    memberPrIds: ids,
  };

  await prisma.$transaction(
    ids.map((id) =>
      prisma.purchaseRequest.update({ where: { id }, data: { po: po as unknown as Prisma.InputJsonObject } }),
    ),
  );
  await rememberSupplier(d.supplier);
  for (const qid of [...new Set(prs.map((p) => p.quotationId).filter((q): q is string => !!q))]) {
    revalidatePath(`/orders/${qid}`);
  }
  revalidatePath("/purchasing");
}

/** Edit a combined PO's supplier, lines, EWT and remarks (before it's purchased). */
export async function updateCombinedPO(
  anchorPurchaseRequestId: string,
  input: z.infer<typeof poInputSchema>,
): Promise<void> {
  const user = await getCurrentUser();
  if (!user) throw new Error("Unauthorized");
  if (!(isAdmin(user) || userHasWorkflowRole(await getWorkflowRoles(), user.id, "purchaser" as WorkflowRoleKey))) {
    throw new Error("Only the Purchaser or an admin can edit a purchase order.");
  }
  const anchor = await prisma.purchaseRequest.findUnique({ where: { id: anchorPurchaseRequestId } });
  if (!anchor) throw new Error("Purchase request not found");
  const ids = poMemberIds(anchor.po);
  if (ids.length === 0) throw new Error("This is not a combined purchase order.");
  if (!(["PENDING_APPROVAL", "APPROVED", "VOUCHER_READY"] as string[]).includes(anchor.status)) {
    throw new Error("A combined PO can only be edited before it is purchased.");
  }
  const existing = coercePurchaseOrder(anchor.po);
  const batchId = poBatchId(anchor.po);
  const d = poInputSchema.parse(input);
  const lines = d.lines.filter((l) => l.description.trim() !== "");
  if (lines.length === 0) throw new Error("Add at least one line to the purchase order.");

  const po = {
    poNumber: existing?.poNumber ?? (await nextPoNo()),
    date: d.date || existing?.date || new Date().toISOString(),
    supplier: d.supplier,
    lines,
    ewtPct: d.ewtPct,
    remarks: d.remarks || COMPANY.poDefaultRemarks,
    createdByName: existing?.createdByName ?? user.name,
    createdAt: existing?.createdAt ?? new Date().toISOString(),
    batchId,
    memberPrIds: ids,
  };
  await prisma.$transaction(
    ids.map((id) => prisma.purchaseRequest.update({ where: { id }, data: { po: po as unknown as Prisma.InputJsonObject } })),
  );
  await rememberSupplier(d.supplier);
  const members = await prisma.purchaseRequest.findMany({ where: { id: { in: ids } }, select: { quotationId: true } });
  for (const qid of [...new Set(members.map((m) => m.quotationId).filter((q): q is string => !!q))]) {
    revalidatePath(`/orders/${qid}`);
  }
  revalidatePath("/purchasing");
}

/** Advance a combined PO one chain step, updating every member together. */
export async function advanceCombinedPO(anchorPurchaseRequestId: string, stepKey: string): Promise<void> {
  const user = await getCurrentUser();
  if (!user) throw new Error("Unauthorized");
  const step = purchaseStep(stepKey);
  if (!step) throw new Error("Unknown step");
  if (!(isAdmin(user) || userHasWorkflowRole(await getWorkflowRoles(), user.id, step.role))) {
    throw new Error(`Only ${workflowRoleLabel(step.role)} or an admin can do this.`);
  }
  const anchor = await prisma.purchaseRequest.findUnique({ where: { id: anchorPurchaseRequestId } });
  if (!anchor) throw new Error("Purchase request not found");
  const ids = poMemberIds(anchor.po);
  if (ids.length === 0) throw new Error("This is not a combined purchase order.");
  const members = await prisma.purchaseRequest.findMany({ where: { id: { in: ids } } });
  if (members.some((m) => m.status !== step.from)) throw new Error("That step isn't available at the current status.");

  const now = new Date();
  const data: Prisma.PurchaseRequestUpdateInput = { status: step.to };
  switch (stepKey) {
    case "approve":
    case "reject":
      data.decidedById = user.id;
      data.decidedByName = user.name;
      data.decidedAt = now;
      break;
    case "voucher":
      data.voucherByName = user.name;
      data.voucherAt = now;
      break;
    case "buy":
      data.purchasedByName = user.name;
      data.purchasedAt = now;
      break;
    case "check":
      data.checkedByName = user.name;
      data.checkedAt = now;
      break;
    case "plant":
      data.plantApprovedByName = user.name;
      data.plantApprovedAt = now;
      break;
  }
  await prisma.$transaction(ids.map((id) => prisma.purchaseRequest.update({ where: { id }, data })));
  for (const qid of [...new Set(members.map((m) => m.quotationId).filter((q): q is string => !!q))]) {
    revalidatePath(`/orders/${qid}`);
  }
  revalidatePath("/purchasing");
}

/** Receive a combined PO into stock and mark every member RECEIVED together. */
export async function receiveCombinedPO(anchorPurchaseRequestId: string, matches: StockMatch[]): Promise<void> {
  const user = await getCurrentUser();
  if (!user) throw new Error("Unauthorized");
  if (!(isAdmin(user) || userHasWorkflowRole(await getWorkflowRoles(), user.id, "warehouse" as WorkflowRoleKey))) {
    throw new Error("Only the Warehouse or an admin can receive purchases.");
  }
  const anchor = await prisma.purchaseRequest.findUnique({ where: { id: anchorPurchaseRequestId } });
  if (!anchor) throw new Error("Purchase request not found");
  const ids = poMemberIds(anchor.po);
  if (ids.length === 0) throw new Error("This is not a combined purchase order.");
  const members = await prisma.purchaseRequest.findMany({ where: { id: { in: ids } } });
  if (members.some((m) => m.status !== "CHECKED")) throw new Error("This purchase isn't ready to receive.");

  const clean = (matches ?? []).filter((m) => m.stockItemId && Number(m.qty) > 0);
  await prisma.$transaction(async (tx) => {
    for (const m of clean) {
      await applyStockChange(tx, { stockItemId: m.stockItemId, kind: "RECEIPT", qty: Number(m.qty), reason: "Purchase received (combined PO)" }, user.name);
    }
    for (const id of ids) {
      await tx.purchaseRequest.update({ where: { id }, data: { status: "RECEIVED", receivedByName: user.name, receivedAt: new Date() } });
    }
  });
  for (const qid of [...new Set(members.map((m) => m.quotationId).filter((q): q is string => !!q))]) {
    revalidatePath(`/orders/${qid}`);
  }
  revalidatePath("/purchasing");
  revalidatePath("/inventory");
}

/** Purchaser/admin adds a reusable supplier payment term from the PO form. */
export async function addPaymentTerm(text: string): Promise<PaymentTerm[]> {
  const user = await getCurrentUser();
  if (!user) throw new Error("Unauthorized");
  if (!(isAdmin(user) || userHasWorkflowRole(await getWorkflowRoles(), user.id, "purchaser" as WorkflowRoleKey))) {
    throw new Error("Only the Purchaser or an admin can add payment terms.");
  }
  const list = await savePaymentTerm({ text });
  revalidatePath("/admin/payment-terms");
  return list;
}

// --- Phase 5 & 6: final payment + delivery documents -----------------------

/** Record a fulfillment sign-off (who + when) under the given step key. */
function stamp(wf: { approvals: Record<string, unknown> }, key: string, user: { id: string; name: string }) {
  return { ...wf.approvals, [key]: { by: user.id, byName: user.name, at: new Date().toISOString() } };
}

// --- Admin: roll back the workflow / an approver's approval -----------------

/**
 * Admin-only: roll the order back to an earlier stage. Any sign-offs recorded for
 * steps after the target are cleared, and job-order progress is reset to match
 * the target stage (cleared before issuance; reset to "issued" before production
 * completes). The Engineer's Fans & Blowers JO documents are preserved.
 */
export async function adminRollbackStage(quotationId: string, toStage: OrderStage): Promise<void> {
  const user = await getCurrentUser();
  if (!user || !isAdmin(user)) throw new Error("Only an admin can roll back the workflow.");
  if (!ORDER_STAGES.some((s) => s.key === toStage)) throw new Error("Unknown stage.");

  const { cls, wf } = await loadWorkflow(quotationId);
  const curIdx = stageIndex(wf.stage);
  const tgtIdx = stageIndex(toStage);
  if (tgtIdx < 0 || tgtIdx >= curIdx) throw new Error("Choose an earlier stage to roll back to.");

  // Drop approvals whose step advanced INTO a stage after the target.
  const approvals: typeof wf.approvals = {};
  for (const [k, v] of Object.entries(wf.approvals)) {
    const st = APPROVAL_STEPS[k]?.to;
    if (!st || stageIndex(st) <= tgtIdx) approvals[k] = v;
  }

  // Reset job-order progress to be consistent with the target stage.
  let jobOrders = wf.jobOrders;
  if (tgtIdx < stageIndex("in_production")) {
    jobOrders = {}; // job orders aren't issued until production
  } else if (tgtIdx <= stageIndex("jo_received")) {
    jobOrders = Object.fromEntries(
      Object.entries(wf.jobOrders).map(([k, jo]) => [
        k,
        { status: "issued" as const, issuedAt: jo!.issuedAt, issuedByName: jo!.issuedByName },
      ]),
    ) as typeof wf.jobOrders;
  } else if (tgtIdx <= stageIndex("producing")) {
    // Back to "In Production": nothing may be finished — reopen finished JOs.
    jobOrders = Object.fromEntries(
      Object.entries(wf.jobOrders).map(([k, jo]) =>
        jo!.status === "finished"
          ? [k, { ...jo!, status: "in_production" as const, finishedAt: undefined, finishedByName: undefined }]
          : [k, jo!],
      ),
    ) as typeof wf.jobOrders;
  }

  await saveWorkflow(quotationId, cls, { ...wf, stage: toStage, approvals, jobOrders });
}

/**
 * Admin-only: roll back a single approver's approval. The recorded sign-off is
 * removed and the order returns to the stage just before that step (i.e. waiting
 * for that approval again).
 */
export async function adminRollbackApproval(quotationId: string, key: string): Promise<void> {
  const user = await getCurrentUser();
  if (!user || !isAdmin(user)) throw new Error("Only an admin can roll back an approval.");
  const step = APPROVAL_STEPS[key];
  if (!step) throw new Error("Unknown approval.");
  await adminRollbackStage(quotationId, step.from);
}

/** Sales/preparer informs the client the order is ready (Phase 5, step 17). */
export async function notifyClientReady(quotationId: string): Promise<void> {
  const user = await getCurrentUser();
  if (!user) throw new Error("Unauthorized");
  const { quote, cls, wf } = await loadWorkflow(quotationId);
  const isSales = isAdmin(user) || quote.preparedById === user.id || user.role === "SALES" || user.role === "ENGINEER";
  if (!isSales) throw new Error("Only Sales (the order's preparer) or an admin can do this.");
  if (wf.stage !== "production_finished") throw new Error("The order isn't finished production yet.");
  await saveWorkflow(quotationId, cls, { ...wf, stage: "final_pay_review", approvals: stamp(wf, "client_notified", user) });
}

/** Accounting checks the final payment (Phase 5, step 19a). */
export async function checkFinalPayment(quotationId: string): Promise<void> {
  const user = await getCurrentUser();
  if (!user) throw new Error("Unauthorized");
  if (!(isAdmin(user) || userHasWorkflowRole(await getWorkflowRoles(), user.id, "accounting" as WorkflowRoleKey)))
    throw new Error("Only Accounting or an admin can do this.");
  const { cls, wf } = await loadWorkflow(quotationId);
  if (wf.stage !== "final_pay_review") throw new Error("Final payment isn't awaiting a check.");
  await saveWorkflow(quotationId, cls, { ...wf, stage: "final_pay_checked", approvals: stamp(wf, "final_pay_checked", user) });
}

/** Payment Approver confirms the final payment is cleared (Phase 5, step 19b). */
export async function confirmFinalPayment(quotationId: string): Promise<void> {
  const user = await getCurrentUser();
  if (!user) throw new Error("Unauthorized");
  if (!(isAdmin(user) || userHasWorkflowRole(await getWorkflowRoles(), user.id, "payment_approver" as WorkflowRoleKey)))
    throw new Error("Only the Payment Approver or an admin can do this.");
  const { cls, wf } = await loadWorkflow(quotationId);
  if (wf.stage !== "final_pay_checked") throw new Error("Final payment hasn't been checked yet.");
  await saveWorkflow(quotationId, cls, { ...wf, stage: "final_pay_cleared", approvals: stamp(wf, "final_pay_confirmed", user) });
}

/** Accounting prepares the delivery documents and approves delivery (Phase 6, step 21). */
export async function prepareDeliveryDocs(
  quotationId: string,
  docs: { dr: string; si: string; or: string },
): Promise<void> {
  const user = await getCurrentUser();
  if (!user) throw new Error("Unauthorized");
  if (!(isAdmin(user) || userHasWorkflowRole(await getWorkflowRoles(), user.id, "accounting" as WorkflowRoleKey)))
    throw new Error("Only Accounting or an admin can do this.");
  const { cls, wf } = await loadWorkflow(quotationId);
  if (wf.stage !== "final_pay_cleared") throw new Error("The order isn't ready for delivery documents.");
  const documents = {
    ...wf.documents,
    dr: docs.dr.trim() || undefined,
    si: docs.si.trim() || undefined,
    or: docs.or.trim() || undefined,
  };
  await saveWorkflow(quotationId, cls, { ...wf, stage: "delivery_docs_ready", documents, approvals: stamp(wf, "delivery_approved", user) });
}

/** Logistics delivers and records the proof of delivery (Phase 6, steps 20/22). */
export async function markDelivered(quotationId: string, pod: string): Promise<void> {
  const user = await getCurrentUser();
  if (!user) throw new Error("Unauthorized");
  if (!(isAdmin(user) || userHasWorkflowRole(await getWorkflowRoles(), user.id, "logistics" as WorkflowRoleKey)))
    throw new Error("Only Logistics or an admin can do this.");
  const { cls, wf } = await loadWorkflow(quotationId);
  if (wf.stage !== "delivery_docs_ready") throw new Error("Delivery documents aren't ready yet.");
  const documents = { ...wf.documents, pod: pod.trim() || undefined };
  await saveWorkflow(quotationId, cls, { ...wf, stage: "delivered", documents, approvals: stamp(wf, "delivered", user) });
}

/** Accounting files the signed documents and closes the order (Phase 6, steps 23-24). */
export async function fileDocuments(quotationId: string): Promise<void> {
  const user = await getCurrentUser();
  if (!user) throw new Error("Unauthorized");
  if (!(isAdmin(user) || userHasWorkflowRole(await getWorkflowRoles(), user.id, "accounting" as WorkflowRoleKey)))
    throw new Error("Only Accounting or an admin can do this.");
  const { cls, wf } = await loadWorkflow(quotationId);
  if (wf.stage !== "delivered") throw new Error("The order hasn't been delivered yet.");
  await saveWorkflow(quotationId, cls, { ...wf, stage: "closed", approvals: stamp(wf, "documents_filed", user) });

  // Phase 7 — compute the 1.5% sales commission for the close month. Guarded so a
  // missing table (before the migration is applied) never blocks closing the order.
  try {
    const q = await prisma.quotation.findUnique({ where: { id: quotationId }, include: { preparedBy: true } });
    if (q) {
      const orderValue = payableTotal(q);
      const amount = round2((orderValue * COMMISSION_RATE_PCT) / 100);
      const now = new Date();
      const salesMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
      await prisma.commission.upsert({
        where: { quotationId },
        create: {
          quotationId,
          salespersonId: q.preparedById,
          salespersonName: q.preparedBy.name,
          orderValue,
          ratePct: COMMISSION_RATE_PCT,
          amount,
          salesMonth,
        },
        update: {}, // never overwrite an existing commission (keeps paid state)
      });
    }
  } catch {
    // Commission table not set up yet — closing the order still succeeds.
  }
  revalidatePath("/commissions");
}

// --- Inventory integration --------------------------------------------------

/**
 * Warehouse receives a purchased order into stock — adding the matched stock
 * items and advancing the purchase request to RECEIVED (awaiting Plant Manager).
 */
export async function receivePurchaseRequest(
  purchaseRequestId: string,
  matches: StockMatch[],
): Promise<void> {
  const user = await getCurrentUser();
  if (!user) throw new Error("Unauthorized");
  if (!(isAdmin(user) || userHasWorkflowRole(await getWorkflowRoles(), user.id, "warehouse" as WorkflowRoleKey))) {
    throw new Error("Only the Warehouse or an admin can receive purchases.");
  }
  const pr = await prisma.purchaseRequest.findUnique({ where: { id: purchaseRequestId } });
  if (!pr) throw new Error("Purchase request not found");
  if (pr.status !== "CHECKED") throw new Error("This purchase isn't ready to receive.");

  const clean = (matches ?? []).filter((m) => m.stockItemId && Number(m.qty) > 0);

  await prisma.$transaction(async (tx) => {
    for (const m of clean) {
      await applyStockChange(tx, { stockItemId: m.stockItemId, kind: "RECEIPT", qty: Number(m.qty), reason: "Purchase received" }, user.name);
    }
    await tx.purchaseRequest.update({
      where: { id: purchaseRequestId },
      data: { status: "RECEIVED", receivedByName: user.name, receivedAt: new Date() },
    });
  });
  if (pr.quotationId) revalidatePath(`/orders/${pr.quotationId}`);
  revalidatePath("/purchasing");
  revalidatePath("/inventory");
}
