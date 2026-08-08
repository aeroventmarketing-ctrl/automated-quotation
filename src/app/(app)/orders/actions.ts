"use server";

import { randomUUID } from "crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { COMPANY } from "@/lib/config";
import { getCurrentUser, isAdmin } from "@/lib/auth";
import { coercePurchaseOrder, formatPoNumber, isIssuedFromStockLine, issuedFromStockLine, isToPurchaseLine, toPurchaseLine, poLineFromPRItem, type PurchaseOrder } from "@/lib/purchase-order";
import { poMemberIds, poBatchId } from "@/lib/purchase-batch";
import { rememberSupplier } from "@/lib/suppliers";
import { savePaymentTerm, type PaymentTerm } from "@/lib/payment-terms";
import { logActivity } from "@/lib/activity-log";
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
  OFFICE_DEPT_KEY,
  REQUISITION_DEPT_KEYS,
  requisitionDeptLabel,
  requestorDeptKey,
  allJobOrdersFinished,
  type OrderStage,
  type OrderStepKey,
  type OrderWorkflow,
  type FulfillmentMode,
  type ProductionDeptKey,
  type JobOrder,
  type JobOrderProof,
  type MaterialRequest,
  type MRFItem,
  type MRFLineDisposition,
  type OrderConversation,
} from "@/lib/order-workflow";
import { buildAutoJobOrders } from "@/lib/job-order-autogen";
import { getFanMotorBrand } from "@/lib/fan-motor-brand";
import { purchaseStep, purchaseStepsFrom, isPoApproved, effectiveStepRole, isDeptRequisition, isCancellable, PURCHASE_STEPS, PR_MAIN_ORDER, prMainIndex, priorPurchaseStatuses, type PRStatus } from "@/lib/purchasing";
import { coercePurchaseReturns, canRaiseReturnAt, nextReturnStage, returnStageDef, isReturnComplete, type ReturnStage } from "@/lib/purchase-returns";
import { coerceReconciliation, canReconcileAt, isReconciled } from "@/lib/purchase-reconcile";
import { saleFromClassification, docCheckMissing, closeDocsState, afterPaymentDocTypes, plantDocTypes, plantCloseState, type SaleDoc, type SalePayment } from "@/lib/sale";
import { applyPaymentSlipRules } from "@/lib/payment-slip";
import { orderBoughtInLines, isBoughtInOnlyOrder, isStockOnlyOrder } from "@/lib/department-pnl";
import {
  MB_DELIVERED_STEP,
  MB_FINAL_STEP,
  mbStepDef,
  mbProgress,
  mbBatchedByDescription,
  mbDeliveredByDescription,
  isMbFiled,
  type MultiDeliveryBatch,
  type MBStamp,
} from "@/lib/delivery-multibatch";
import { getDocCheckGateEnabled } from "@/lib/doc-check-gate";
import { payableTotal, round2 } from "@/lib/quote";
import { applyStockChange } from "@/lib/inventory";
import { recordDeptStockTransfer, isDuctHardwareStockName } from "@/lib/dept-stock-transfer";
import { coerceFansJobOrder, joTypeReady, joTypeLabel, type FansJobOrder } from "@/lib/job-order";
import { coerceDuctJobOrder, isReducingDuctType, type DuctJobOrder, type DuctSegment } from "@/lib/duct-job-order";
import { coerceAccessoriesJobOrder, type AccessoriesJobOrder, type AccessoryLine } from "@/lib/accessories-job-order";
import { coerceMotorControllerJobOrder, type MotorControllerJobOrder, type MotorControllerLine } from "@/lib/motor-controller-job-order";

interface StockMatch { stockItemId: string; qty: number }

const DEPT_KEY_SET = new Set(PRODUCTION_DEPTS.map((d) => d.key));
const COMMISSION_RATE_PCT = 1.5;

/**
 * Create the sales-commission row for a closed order (idempotent — never
 * overwrites an existing one, keeping its paid state). Guarded so a missing table
 * never blocks closing the order. Used by both the single-batch close and the
 * multiple-batch close.
 */
async function ensureCommissionRow(quotationId: string): Promise<void> {
  try {
    const q = await prisma.quotation.findUnique({ where: { id: quotationId }, include: { preparedBy: true } });
    if (!q) return;
    const orderValue = payableTotal(q);
    const amount = round2((orderValue * COMMISSION_RATE_PCT) / 100);
    const now = new Date();
    const salesMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    await prisma.commission.upsert({
      where: { quotationId },
      create: { quotationId, salespersonId: q.preparedById, salespersonName: q.preparedBy.name, orderValue, ratePct: COMMISSION_RATE_PCT, amount, salesMonth },
      update: {},
    });
  } catch {
    // Commission table not set up yet — closing the order still succeeds.
  }
}

/**
 * Advance an order through a Phase 1 approval step. The signed-in user must hold
 * the step's workflow role (or be an admin), and the order must be at the step's
 * "from" stage. Records the sign-off (who + when) and moves the stage forward.
 */
/** Today's date (Asia/Manila) as YYYY-MM-DD — stamped on a job order when it's
 *  created or revised, and matches the JO form's date input format. */
function joToday(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

/** Deleting or modifying an uploaded document is admin-only, system-wide. */
async function assertUploadAdmin() {
  const user = await getCurrentUser();
  if (!user || !isAdmin(user)) throw new Error("Only an admin can delete or modify uploaded documents.");
  return user;
}

/** A short "order <quoteNumber>" label for activity summaries (best-effort). */
async function orderRefLabel(quotationId: string): Promise<string> {
  try {
    const q = await prisma.quotation.findUnique({ where: { id: quotationId }, select: { quoteNumber: true } });
    return q?.quoteNumber ? `order ${q.quoteNumber}` : "an order";
  } catch {
    return "an order";
  }
}

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
    select: {
      id: true,
      classification: true,
      quoteNumber: true,
      projectName: true,
      items: { select: { qty: true, descriptionSnapshot: true, specsSnapshot: true } },
    },
  });
  if (!quote) throw new Error("Order not found");

  const wf = readOrderWorkflow(quote.classification);
  if (wf.stage !== def.from) {
    throw new Error("This step isn't available at the order's current stage.");
  }

  // Documents can only be marked checked once the required files are attached
  // (unless an admin has turned the gate off, e.g. for testing).
  if (step === "doc_check" && (await getDocCheckGateEnabled())) {
    const missing = docCheckMissing(saleFromClassification(quote.classification));
    if (missing.length) throw new Error(`Attach ${missing.join(", ")} before marking documents checked.`);
  }

  const cls = (quote.classification as Record<string, unknown>) ?? {};
  let workflow: Record<string, unknown> = {
    ...wf,
    stage: def.to,
    approvals: {
      ...wf.approvals,
      [step]: { by: user.id, byName: user.name, at: new Date().toISOString() },
    },
  };

  // When payment is cleared (order → "For JO creation"), auto-generate the job
  // orders from the quotation lines so the engineer only reviews/edits/approves.
  // A fully bought-in order has none — instead it files the supplier requisition
  // ("Clear payment & create PO") so the Purchaser can prepare the PO.
  const boughtInOnly = isBoughtInOnlyOrder(quote.items);
  // A from-stock order (in-house duct hardware, nothing fabricated / bought-in)
  // generates no job orders either — it's released from stock in Phase 2 instead.
  const stockOnly = isStockOnlyOrder(quote.items);
  if (step === "payment_cleared" && !boughtInOnly && !stockOnly) {
    workflow = await mergeAutoJobOrders(workflow, wf, quote);
  }

  await prisma.quotation.update({
    where: { id: quotationId },
    data: { classification: { ...cls, workflow } as unknown as Prisma.InputJsonObject },
  });
  if (step === "payment_cleared" && boughtInOnly) {
    await autoRaiseBoughtInRequisition(quotationId, quote.quoteNumber, quote.items, user);
  }
  await logActivity(user, {
    action: "order.stage.advance",
    category: "order",
    summary: `${def.label} — order ${quote.quoteNumber}`,
    entity: "order",
    entityId: quotationId,
    href: `/orders/${quotationId}`,
  });
  revalidatePath("/orders");
  revalidatePath(`/orders/${quotationId}`);
}

/** Quotation shape the job-order autogen reads. */
type AutogenQuote = {
  quoteNumber: string;
  projectName: string | null;
  items: { qty: number; descriptionSnapshot: string | null; specsSnapshot: unknown }[];
};

/**
 * Merge auto-generated job orders (Fans, Duct, Motor Controller, Accessories)
 * built from the quotation lines into a workflow object. A department is only
 * populated when it currently has NO job orders, so this never overwrites manual
 * work and is safe to run more than once. Base numbers are claimed on demand.
 */
/** True if none of the job orders in a department have been approved yet. */
function noneApproved(list: { approvedByName?: string }[]): boolean {
  return !list.some((j) => (j.approvedByName ?? "").trim());
}

async function mergeAutoJobOrders(
  base: Record<string, unknown>,
  wf: OrderWorkflow,
  quote: AutogenQuote,
  mode: "fill-empty" | "regenerate-unapproved" = "fill-empty",
): Promise<Record<string, unknown>> {
  const items = (quote.items ?? []).map((it) => ({
    qty: Number(it.qty) || 0,
    descriptionSnapshot: it.descriptionSnapshot ?? "",
    specsSnapshot: it.specsSnapshot,
  }));
  const auto = buildAutoJobOrders(items, {
    project: (quote.projectName ?? "").trim(),
    orderNumber: quote.quoteNumber ?? "",
    date: joToday(),
    motorBrand: await getFanMotorBrand(),
  });
  const year = new Date().getFullYear();
  const regen = mode === "regenerate-unapproved";
  // A department may be touched when it's empty (fill-empty), or — in regenerate
  // mode — when none of its job orders are approved yet. In regenerate mode we
  // ALWAYS set the department to the fresh output (even when empty), so a job
  // order whose source lines are gone (e.g. a VFD-only motor controller) is
  // removed instead of lingering.
  const canTouch = (existing: { approvedByName?: string }[]) =>
    regen ? noneApproved(existing) : existing.length === 0;
  let workflow = base;
  if (canTouch(wf.fansJobOrders)) {
    if (auto.fans.length) workflow = { ...workflow, fansJobOrders: auto.fans, joBaseNo: wf.joBaseNo ?? (await nextJoBaseNo()), joBaseYear: wf.joBaseYear ?? year };
    else if (regen) workflow = { ...workflow, fansJobOrders: [] };
  }
  if (canTouch(wf.ductJobOrders)) {
    if (auto.duct.length) workflow = { ...workflow, ductJobOrders: auto.duct, ductJoBaseNo: wf.ductJoBaseNo ?? (await nextDuctJoBaseNo()), ductJoBaseYear: wf.ductJoBaseYear ?? year };
    else if (regen) workflow = { ...workflow, ductJobOrders: [] };
  }
  if (canTouch(wf.motorJobOrders)) {
    if (auto.motor.length) workflow = { ...workflow, motorJobOrders: auto.motor, mcJoBaseNo: wf.mcJoBaseNo ?? (await nextMcJoBaseNo()), mcJoBaseYear: wf.mcJoBaseYear ?? year };
    else if (regen) workflow = { ...workflow, motorJobOrders: [] };
  }
  if (canTouch(wf.accessoriesJobOrders)) {
    if (auto.accessories.length) workflow = { ...workflow, accessoriesJobOrders: auto.accessories, accJoBaseNo: wf.accJoBaseNo ?? (await nextAccJoBaseNo()), accJoBaseYear: wf.accJoBaseYear ?? year };
    else if (regen) workflow = { ...workflow, accessoriesJobOrders: [] };
  }
  return workflow;
}

/**
 * Manually (re)generate job orders from the quotation for an order that's already
 * at the JO-creation stage. Regenerates any department whose job orders are not
 * yet approved (approved ones are never touched), so it refreshes stale/partial
 * auto-fills with the latest mapping.
 */
export async function autofillJobOrders(quotationId: string): Promise<void> {
  await assertEngineer();
  const quote = await prisma.quotation.findUnique({
    where: { id: quotationId },
    select: {
      classification: true,
      quoteNumber: true,
      projectName: true,
      items: { select: { qty: true, descriptionSnapshot: true, specsSnapshot: true } },
    },
  });
  if (!quote) throw new Error("Order not found");
  const wf = readOrderWorkflow(quote.classification);
  if (stageIndex(wf.stage) < stageIndex("released")) {
    throw new Error("Job orders can be generated once the order's payment is cleared.");
  }
  const cls = (quote.classification as Record<string, unknown>) ?? {};
  const workflow = await mergeAutoJobOrders({ ...wf }, wf, quote, "regenerate-unapproved");
  await prisma.quotation.update({
    where: { id: quotationId },
    data: { classification: { ...cls, workflow } as unknown as Prisma.InputJsonObject },
  });
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
  if (!(isAdmin(user) || user.role === "ENGINEER" || userHasWorkflowRole(await getWorkflowRoles(), user.id, "technical_head" as WorkflowRoleKey))) {
    throw new Error("Only the Engineer, Technical Head or an admin can issue job orders.");
  }
  const depts = Array.from(new Set(deptKeys.filter((k) => DEPT_KEY_SET.has(k as ProductionDeptKey)))) as ProductionDeptKey[];
  if (depts.length === 0) throw new Error("Select at least one department.");

  const { cls, wf } = await loadWorkflow(quotationId);
  // Departments can be issued at the "released" stage and topped up while
  // production is underway, so each department's job order is issued from its own
  // panel when its production head is ready.
  const issuableStages = new Set(["released", "in_production", "jo_received", "producing"]);
  if (!issuableStages.has(wf.stage)) throw new Error("Job orders can only be issued during Phase 2 (before production is finished).");

  const now = new Date().toISOString();
  const jobOrders = { ...wf.jobOrders };
  // Only issue departments that don't already have a job order — never disturb one
  // that's already in production.
  const added = depts.filter((d) => !jobOrders[d]);
  if (added.length === 0) throw new Error("That department already has a job order.");
  for (const d of added) jobOrders[d] = { status: "issued", issuedAt: now, issuedByName: user.name };

  // The first issuance releases the order into production; later top-ups keep the
  // current stage so departments already in production aren't reset.
  const stage = wf.stage === "released" ? "in_production" : wf.stage;
  await saveWorkflow(quotationId, cls, { ...wf, stage, jobOrders });
  await logActivity(user, {
    action: "order.jo.issue",
    category: "order",
    summary: `Issued job order${added.length > 1 ? "s" : ""} (${added.map(deptLabel).join(", ")}) — ${await orderRefLabel(quotationId)}`,
    entity: "order",
    entityId: quotationId,
    href: `/orders/${quotationId}`,
  });
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
  await logActivity(user, {
    action: "order.jo.received",
    category: "order",
    summary: `Received job orders — ${await orderRefLabel(quotationId)}`,
    entity: "order",
    entityId: quotationId,
    href: `/orders/${quotationId}`,
  });
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
  // Proofing gate: at least one proof picture must be attached before a
  // department can mark its job order finished.
  if (to === "finished" && !(jo.proofs && jo.proofs.length > 0)) {
    throw new Error("Attach at least one proof picture before marking this job order finished.");
  }

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
  await logActivity(user, {
    action: "order.jo.advance",
    category: "order",
    summary: `${deptLabel(deptKey)}: ${to === "in_production" ? "started" : "finished"} production — ${await orderRefLabel(quotationId)}`,
    entity: "order",
    entityId: quotationId,
    href: `/orders/${quotationId}`,
  });
}

/**
 * Attach a proofing picture to a department's job order. Uploaded by the
 * department's production head (or an admin). At least one proof is required by
 * `advanceJobOrder` before the "Mark finished" step is allowed; further pictures
 * may still be added afterwards (e.g. photos taken after completion).
 */
export async function addJobOrderProof(quotationId: string, dept: string, doc: SaleDoc): Promise<void> {
  const user = await getCurrentUser();
  if (!user) throw new Error("Unauthorized");
  if (!DEPT_KEY_SET.has(dept as ProductionDeptKey)) throw new Error("Unknown department");
  const deptKey = dept as ProductionDeptKey;
  if (!(isAdmin(user) || userHasWorkflowRole(await getWorkflowRoles(), user.id, deptRole(deptKey) as WorkflowRoleKey))) {
    throw new Error(`Only the ${deptLabel(deptKey)} head or an admin can attach a proof.`);
  }
  if (!doc || typeof doc.path !== "string" || !doc.path) throw new Error("No file uploaded.");

  const { cls, wf } = await loadWorkflow(quotationId);
  const jo = wf.jobOrders[deptKey];
  if (!jo) throw new Error("No job order for this department.");
  // Proofs may be added at any point once the job order exists — including after
  // it's finished (e.g. the dept head attaching a picture they took later).

  const proof: JobOrderProof = { path: doc.path, name: doc.name, uploadedAt: doc.uploadedAt, byName: user.name };
  const updated: JobOrder = { ...jo, proofs: [...(jo.proofs ?? []), proof] };
  await saveWorkflow(quotationId, cls, { ...wf, jobOrders: { ...wf.jobOrders, [deptKey]: updated } });
  await logActivity(user, {
    action: "order.jo.proof.add",
    category: "order",
    summary: `${deptLabel(deptKey)}: attached a production proof — ${await orderRefLabel(quotationId)}`,
    entity: "order",
    entityId: quotationId,
    href: `/orders/${quotationId}`,
  });
}

/**
 * Remove a proofing picture from a department's job order. The department's
 * production head may remove while the job order is still open; an admin may
 * remove any proof at any time (even after it's marked finished).
 */
export async function removeJobOrderProof(quotationId: string, dept: string, path: string): Promise<void> {
  const user = await getCurrentUser();
  if (!user) throw new Error("Unauthorized");
  if (!DEPT_KEY_SET.has(dept as ProductionDeptKey)) throw new Error("Unknown department");
  const deptKey = dept as ProductionDeptKey;
  const admin = isAdmin(user);
  if (!(admin || userHasWorkflowRole(await getWorkflowRoles(), user.id, deptRole(deptKey) as WorkflowRoleKey))) {
    throw new Error(`Only the ${deptLabel(deptKey)} head or an admin can remove a proof.`);
  }

  const { cls, wf } = await loadWorkflow(quotationId);
  const jo = wf.jobOrders[deptKey];
  if (!jo) throw new Error("No job order for this department.");
  // The dept head may only remove while the JO is open; an admin can remove any
  // uploaded proof, even after the job order is finished (for corrections).
  if (jo.status === "finished" && !admin) throw new Error("This job order is already finished.");

  const proofs = (jo.proofs ?? []).filter((p) => p.path !== path);
  const updated: JobOrder = { ...jo, proofs: proofs.length ? proofs : undefined };
  await saveWorkflow(quotationId, cls, { ...wf, jobOrders: { ...wf.jobOrders, [deptKey]: updated } });
}

/**
 * Set (or clear) a job order's target completion date. Set by an Engineer or an
 * admin only. `dueAt` is a YYYY-MM-DD date string; pass null/"" to clear it.
 */
export async function setJobOrderDue(quotationId: string, dept: string, dueAt: string | null): Promise<void> {
  const user = await getCurrentUser();
  if (!user) throw new Error("Unauthorized");
  if (!DEPT_KEY_SET.has(dept as ProductionDeptKey)) throw new Error("Unknown department");
  const deptKey = dept as ProductionDeptKey;
  if (!(isAdmin(user) || user.role === "ENGINEER")) {
    throw new Error("Only an Engineer or an admin can set a deadline.");
  }

  const { cls, wf } = await loadWorkflow(quotationId);
  const jo = wf.jobOrders[deptKey];
  if (!jo) throw new Error("No job order for this department.");
  const clean = (dueAt ?? "").trim();
  const due = /^\d{4}-\d{2}-\d{2}$/.test(clean) ? clean : undefined;
  const updated: JobOrder = { ...jo, dueAt: due };
  await saveWorkflow(quotationId, cls, { ...wf, jobOrders: { ...wf.jobOrders, [deptKey]: updated } });
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

  // New job orders can't be added once the order is In Production (or later).
  const isNew = index == null || index < 0 || index >= wf.fansJobOrders.length;
  if (isNew && stageIndex(wf.stage) >= stageIndex("producing")) {
    throw new Error("The order is in production — new job orders can no longer be added.");
  }

  let joBaseNo = wf.joBaseNo;
  let joBaseYear = wf.joBaseYear;
  if (joBaseNo == null) {
    joBaseNo = await nextJoBaseNo();
    joBaseYear = new Date().getFullYear();
  }

  const jo: FansJobOrder = { ...(coerceFansJobOrder({}) as FansJobOrder), ...d, date: joToday() };
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

// Which workflow base fields hold each department's JO numbering.
const JO_BASE_FIELDS = {
  fans: ["joBaseNo", "joBaseYear"],
  duct: ["ductJoBaseNo", "ductJoBaseYear"],
  accessories: ["accJoBaseNo", "accJoBaseYear"],
  motor: ["mcJoBaseNo", "mcJoBaseYear"],
} as const;

/**
 * Admin-only: edit a department's Job Order number. The printed JO number is
 * derived from a per-department base sequence + year (AFBM-JO<YY><5-digit seq>),
 * so overriding those two values renumbers every JO in that department. Admins
 * use this to correct a JO number after the fact.
 */
export async function setJobOrderNumbering(
  quotationId: string,
  dept: keyof typeof JO_BASE_FIELDS,
  baseNo: number,
  baseYear: number,
): Promise<void> {
  const user = await getCurrentUser();
  if (!user || !isAdmin(user)) throw new Error("Only an admin can edit job order numbers.");
  const fields = JO_BASE_FIELDS[dept];
  if (!fields) throw new Error("Unknown department.");
  if (!Number.isInteger(baseNo) || baseNo < 1 || baseNo > 99999) {
    throw new Error("The job order sequence must be a whole number between 1 and 99999.");
  }
  if (!Number.isInteger(baseYear) || baseYear < 2000 || baseYear > 2999) {
    throw new Error("The year must be a valid four-digit year.");
  }
  const { cls, wf } = await loadWorkflow(quotationId);
  const [noField, yearField] = fields;
  await saveWorkflow(quotationId, cls, { ...wf, [noField]: baseNo, [yearField]: baseYear });
}

// --- Duct Job Orders (Engineer) -------------------------------------------

/** Next running Duct JO base sequence (claimed once per order). */
async function nextDuctJoBaseNo(): Promise<number> {
  const KEY = "duct_jo_counter";
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

const ductSegmentSchema = z.object({
  type: z.string().trim().default("Straight Duct"),
  quantity: z.string().trim().default(""),
  uom: z.string().trim().default("pc"),
  horizontal: z.string().trim().default(""),
  vertical: z.string().trim().default(""),
  length: z.string().trim().default(""),
  toHorizontal: z.string().trim().default(""),
  toVertical: z.string().trim().default(""),
  material: z.string().trim().default(""),
  gauge: z.string().trim().default(""),
});

const ductJoSchema = z.object({
  date: z.string().trim().default(""),
  project: z.string().trim().default(""),
  dueDate: z.string().trim().default(""),
  quantity: z.string().trim().default(""),
  uom: z.string().trim().default(""),
  segments: z.array(ductSegmentSchema).default([]),
  note: z.string().trim().default(""),
  assignedPersonnel: z.string().trim().default(""),
});

/**
 * The Engineer creates or edits a Duct job order on an order. Pass index = null
 * to add a new one, or an existing index to edit. The first Duct JO on an order
 * claims the running DUCT-JO base number.
 */
export async function saveDuctJobOrder(
  quotationId: string,
  index: number | null,
  input: z.infer<typeof ductJoSchema>,
): Promise<void> {
  await assertEngineer();
  const d = ductJoSchema.parse(input);
  const { cls, wf } = await loadWorkflow(quotationId);

  // New job orders can't be added once the order is In Production (or later).
  const isNew = index == null || index < 0 || index >= wf.ductJobOrders.length;
  if (isNew && stageIndex(wf.stage) >= stageIndex("producing")) {
    throw new Error("The order is in production — new job orders can no longer be added.");
  }

  // Keep only segments that carry at least the leading dimensions.
  const segments: DuctSegment[] = d.segments
    .map((s) => {
      const reducing = isReducingDuctType(s.type);
      return {
        type: s.type || "Straight Duct",
        quantity: s.quantity,
        uom: s.uom || "pc",
        horizontal: s.horizontal,
        vertical: s.vertical,
        length: s.length,
        toHorizontal: reducing ? s.toHorizontal : "",
        toVertical: reducing ? s.toVertical : "",
        material: s.material || "G.I. Material",
        gauge: s.gauge || "GA20",
      };
    })
    .filter((s) => s.horizontal !== "" || s.vertical !== "" || s.length !== "");

  let ductJoBaseNo = wf.ductJoBaseNo;
  let ductJoBaseYear = wf.ductJoBaseYear;
  if (ductJoBaseNo == null) {
    ductJoBaseNo = await nextDuctJoBaseNo();
    ductJoBaseYear = new Date().getFullYear();
  }

  const jo: DuctJobOrder = { ...(coerceDuctJobOrder({}) as DuctJobOrder), ...d, date: joToday(), segments };
  const list = [...wf.ductJobOrders];
  if (index != null && index >= 0 && index < list.length) list[index] = jo;
  else list.push(jo);

  await saveWorkflow(quotationId, cls, { ...wf, ductJobOrders: list, ductJoBaseNo, ductJoBaseYear });
}

/** Remove a Duct job order by index. */
export async function deleteDuctJobOrder(quotationId: string, index: number): Promise<void> {
  await assertEngineer();
  const { cls, wf } = await loadWorkflow(quotationId);
  const list = wf.ductJobOrders.filter((_, i) => i !== index);
  await saveWorkflow(quotationId, cls, { ...wf, ductJobOrders: list });
}

// --- Accessories Job Orders (Engineer) ------------------------------------

/** Next running Accessories JO base sequence (claimed once per order). */
async function nextAccJoBaseNo(): Promise<number> {
  const KEY = "acc_jo_counter";
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

const accDimensionSchema = z.object({
  value: z.string().trim().default(""),
  label: z.string().trim().default(""),
});
const accLineSchema = z.object({
  type: z.string().trim().default(""),
  quantity: z.string().trim().default(""),
  uom: z.string().trim().default(""),
  dimensions: z.array(accDimensionSchema).default([]),
  material: z.string().trim().default(""),
  note: z.string().trim().default(""),
});
const accJoSchema = z.object({
  date: z.string().trim().default(""),
  project: z.string().trim().default(""),
  dueDate: z.string().trim().default(""),
  lines: z.array(accLineSchema).default([]),
  note: z.string().trim().default(""),
  assignedPersonnel: z.string().trim().default(""),
});

/**
 * The Engineer creates or edits an Accessories job order on an order. Pass
 * index = null to add a new one, or an existing index to edit. The first
 * Accessories JO on an order claims the running ACCE-JO base number.
 */
export async function saveAccessoriesJobOrder(
  quotationId: string,
  index: number | null,
  input: z.infer<typeof accJoSchema>,
): Promise<void> {
  await assertEngineer();
  const d = accJoSchema.parse(input);
  const { cls, wf } = await loadWorkflow(quotationId);

  const isNew = index == null || index < 0 || index >= wf.accessoriesJobOrders.length;
  if (isNew && stageIndex(wf.stage) >= stageIndex("producing")) {
    throw new Error("The order is in production — new job orders can no longer be added.");
  }

  // Keep only lines that carry a type or at least one dimension value; clean each
  // line's dimensions down to the entries that have a value.
  const lines: AccessoryLine[] = d.lines
    .map((l) => ({
      type: l.type,
      quantity: l.quantity,
      uom: l.uom || "pc",
      dimensions: l.dimensions.filter((dim) => dim.value !== "" || dim.label !== ""),
      material: l.material,
      note: l.note,
    }))
    .filter((l) => l.type !== "" || l.dimensions.length > 0);

  let accJoBaseNo = wf.accJoBaseNo;
  let accJoBaseYear = wf.accJoBaseYear;
  if (accJoBaseNo == null) {
    accJoBaseNo = await nextAccJoBaseNo();
    accJoBaseYear = new Date().getFullYear();
  }

  const jo: AccessoriesJobOrder = { ...(coerceAccessoriesJobOrder({}) as AccessoriesJobOrder), ...d, date: joToday(), lines };
  const list = [...wf.accessoriesJobOrders];
  if (index != null && index >= 0 && index < list.length) list[index] = jo;
  else list.push(jo);

  await saveWorkflow(quotationId, cls, { ...wf, accessoriesJobOrders: list, accJoBaseNo, accJoBaseYear });
}

/** Remove an Accessories job order by index. */
export async function deleteAccessoriesJobOrder(quotationId: string, index: number): Promise<void> {
  await assertEngineer();
  const { cls, wf } = await loadWorkflow(quotationId);
  const list = wf.accessoriesJobOrders.filter((_, i) => i !== index);
  await saveWorkflow(quotationId, cls, { ...wf, accessoriesJobOrders: list });
}

// --- Motor Controller Job Orders (Engineer) -------------------------------

/** Next running Motor Controller JO base sequence (claimed once per order). */
async function nextMcJoBaseNo(): Promise<number> {
  const KEY = "mc_jo_counter";
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

const mcLineSchema = z.object({
  quantity: z.string().trim().default(""),
  uom: z.string().trim().default(""),
  starterType: z.string().trim().default(""),
  hp: z.string().trim().default(""),
  phase: z.string().trim().default(""),
  voltage: z.string().trim().default(""),
});
const mcJoSchema = z.object({
  date: z.string().trim().default(""),
  project: z.string().trim().default(""),
  dueDate: z.string().trim().default(""),
  lines: z.array(mcLineSchema).default([]),
  note: z.string().trim().default(""),
  assignedPersonnel: z.string().trim().default(""),
});

/**
 * The Engineer creates or edits a Motor Controller job order on an order. Pass
 * index = null to add a new one, or an existing index to edit. The first Motor
 * Controller JO on an order claims the running MC-JO base number.
 */
export async function saveMotorControllerJobOrder(
  quotationId: string,
  index: number | null,
  input: z.infer<typeof mcJoSchema>,
): Promise<void> {
  await assertEngineer();
  const d = mcJoSchema.parse(input);
  const { cls, wf } = await loadWorkflow(quotationId);

  const isNew = index == null || index < 0 || index >= wf.motorJobOrders.length;
  if (isNew && stageIndex(wf.stage) >= stageIndex("producing")) {
    throw new Error("The order is in production — new job orders can no longer be added.");
  }

  // Keep only lines that carry a starter type or a rating.
  const lines: MotorControllerLine[] = d.lines
    .map((l) => ({
      quantity: l.quantity,
      uom: l.uom || "pc",
      starterType: l.starterType,
      hp: l.hp,
      phase: l.phase,
      voltage: l.voltage,
    }))
    .filter((l) => l.starterType !== "" || l.hp !== "" || l.voltage !== "");

  let mcJoBaseNo = wf.mcJoBaseNo;
  let mcJoBaseYear = wf.mcJoBaseYear;
  if (mcJoBaseNo == null) {
    mcJoBaseNo = await nextMcJoBaseNo();
    mcJoBaseYear = new Date().getFullYear();
  }

  const jo: MotorControllerJobOrder = { ...(coerceMotorControllerJobOrder({}) as MotorControllerJobOrder), ...d, date: joToday(), lines };
  const list = [...wf.motorJobOrders];
  if (index != null && index >= 0 && index < list.length) list[index] = jo;
  else list.push(jo);

  await saveWorkflow(quotationId, cls, { ...wf, motorJobOrders: list, mcJoBaseNo, mcJoBaseYear });
}

/** Remove a Motor Controller job order by index. */
export async function deleteMotorControllerJobOrder(quotationId: string, index: number): Promise<void> {
  await assertEngineer();
  const { cls, wf } = await loadWorkflow(quotationId);
  const list = wf.motorJobOrders.filter((_, i) => i !== index);
  await saveWorkflow(quotationId, cls, { ...wf, motorJobOrders: list });
}

// --- Job order review / approval (Engineer or admin) ------------------------
export type JobOrderDept = "fans" | "duct" | "accessories" | "motor";
const JO_DEPT_FIELD: Record<JobOrderDept, "fansJobOrders" | "ductJobOrders" | "accessoriesJobOrders" | "motorJobOrders"> = {
  fans: "fansJobOrders",
  duct: "ductJobOrders",
  accessories: "accessoriesJobOrders",
  motor: "motorJobOrders",
};

/**
 * Engineer/admin review sign-off on a single job order. `approve=false` reopens
 * it (clears the stamp). Editing a job order also clears its approval, so an
 * edited order must be re-approved.
 */
export async function setJobOrderApproval(
  quotationId: string,
  dept: JobOrderDept,
  index: number,
  approve: boolean,
): Promise<void> {
  const user = await assertEngineer();
  const { cls, wf } = await loadWorkflow(quotationId);
  const field = JO_DEPT_FIELD[dept];
  const list = [...(wf[field] as { approvedByName: string; approvedAt: string }[])];
  if (index < 0 || index >= list.length) throw new Error("Job order not found");
  list[index] = {
    ...list[index],
    approvedByName: approve ? user.name : "",
    approvedAt: approve ? new Date().toISOString() : "",
  };
  await saveWorkflow(quotationId, cls, { ...wf, [field]: list });
  await logActivity(user, {
    action: "order.jo.approval",
    category: "order",
    summary: `${approve ? "Approved" : "Reopened"} ${deptLabel(dept as ProductionDeptKey)} job order — ${await orderRefLabel(quotationId)}`,
    entity: "order",
    entityId: quotationId,
    href: `/orders/${quotationId}`,
  });
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

  const mrfRoles = await getWorkflowRoles();
  // The department head raises their own line's MRF; the Plant Manager (who
  // oversees all lines) or an admin may raise it for any department.
  if (
    !(
      isAdmin(user) ||
      userHasWorkflowRole(mrfRoles, user.id, "plant_manager" as WorkflowRoleKey) ||
      userHasWorkflowRole(mrfRoles, user.id, deptRole(deptKey) as WorkflowRoleKey)
    )
  ) {
    throw new Error(`Only the ${deptLabel(deptKey)} head, the Plant Manager or an admin can raise its material request.`);
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
  // Phase 3 is open to any authorized department head throughout production —
  // from when the job orders are released until production is finished. It no
  // longer waits for this department's own job order to be individually started.
  if (stageIndex(wf.stage) < stageIndex("in_production")) {
    throw new Error("Job orders haven't been released for production yet.");
  }
  if (stageIndex(wf.stage) >= stageIndex("production_finished") || deptJo.status === "finished") {
    throw new Error("Production is finished — material requests are closed.");
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
  // Note: items are NOT auto-added to the product catalogue. Only the Purchaser
  // or an admin adds products (with a supplier and price) on the Products page.
}

/** Sales (or admin) logs a conversation with a production head about the order. */
export async function addOrderConversation(
  quotationId: string,
  input: { at: string; withName: string; message: string },
): Promise<void> {
  const user = await getCurrentUser();
  if (!user) throw new Error("Unauthorized");
  const { quote, cls, wf } = await loadWorkflow(quotationId);
  if (!(isAdmin(user) || user.id === quote.preparedById || user.role === "SALES" || user.role === "ENGINEER")) {
    throw new Error("Only sales or an admin can log a conversation.");
  }
  const message = (input.message ?? "").trim();
  if (!message) throw new Error("Enter the conversation details.");
  const entry: OrderConversation = {
    id: randomUUID(),
    at: (input.at ?? "").trim() || new Date().toISOString(),
    withName: (input.withName ?? "").trim(),
    message,
    loggedByName: user.name,
    loggedAt: new Date().toISOString(),
  };
  await saveWorkflow(quotationId, cls, { ...wf, conversations: [...wf.conversations, entry] });
}

/** Remove a logged conversation (sales owner or admin). */
export async function deleteOrderConversation(quotationId: string, id: string): Promise<void> {
  const user = await getCurrentUser();
  if (!user) throw new Error("Unauthorized");
  const { quote, cls, wf } = await loadWorkflow(quotationId);
  if (!(isAdmin(user) || user.id === quote.preparedById || user.role === "SALES" || user.role === "ENGINEER")) {
    throw new Error("Only sales or an admin can remove a conversation.");
  }
  await saveWorkflow(quotationId, cls, { ...wf, conversations: wf.conversations.filter((c) => c.id !== id) });
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
 * Raise a department requisition — production supplies/consumables/equipment not
 * tied to a customer order. Created by the department head (for their own dept)
 * or by the purchaser/admin (any dept). Walks the same purchasing chain and is
 * received into stock. Stored as a PurchaseRequest with kind "department".
 */
export async function createDepartmentRequisition(
  _dept: string,
  items: MRFItem[],
  note: string,
): Promise<void> {
  const user = await getCurrentUser();
  if (!user) throw new Error("Unauthorized");

  const roles = await getWorkflowRoles();
  // The department is fixed to the requestor's own department (production head →
  // their line; everyone else → Office). Derived server-side so it can't be set
  // from the client. EXCEPTIONS: the Plant Manager and the Warehouseman may
  // target any of the 4 production departments (never Office); Logistics may
  // target any of the 5 (including Office). The client sends the chosen line and
  // we validate it here.
  // Logistics and the Technical Head may target any of the 5 departments
  // (including Office); the Plant Manager and Warehouseman only the 4 production
  // lines.
  const isLogistics = userHasWorkflowRole(roles, user.id, "logistics" as WorkflowRoleKey);
  const isTechHead = userHasWorkflowRole(roles, user.id, "technical_head" as WorkflowRoleKey);
  // Purchaser and Technical Head (and Logistics / admin) may target any of the 5
  // departments, including Office.
  const canPickAnyDept = isLogistics || isTechHead || isAdmin(user) || userHasWorkflowRole(roles, user.id, "purchaser" as WorkflowRoleKey);
  const canPickProdDept =
    userHasWorkflowRole(roles, user.id, "plant_manager" as WorkflowRoleKey) ||
    userHasWorkflowRole(roles, user.id, "warehouse" as WorkflowRoleKey);
  const chosen =
    canPickAnyDept && REQUISITION_DEPT_KEYS.has(String(_dept)) ? String(_dept)
    : canPickProdDept && PRODUCTION_DEPTS.some((d) => d.key === _dept) ? String(_dept)
    : null;
  const dept = chosen ?? requestorDeptKey((role) => userHasWorkflowRole(roles, user.id, role as WorkflowRoleKey));
  const isOffice = dept === OFFICE_DEPT_KEY;
  const purchaserOrAdmin = isAdmin(user) || userHasWorkflowRole(roles, user.id, "purchaser" as WorkflowRoleKey);
  // Office requisitions are for Sales, Purchaser, Logistics, the Technical Head
  // or admin — not Engineers or other office roles with no requisition duty.
  const allowed = isOffice ? purchaserOrAdmin || user.role === "SALES" || canPickAnyDept : true;
  if (!allowed) throw new Error("You don't have access to raise a requisition.");

  const cleanItems: MRFItem[] = (items ?? [])
    .map((it) => ({
      description: (it.description ?? "").trim(),
      qty: (it.qty ?? "").trim(),
      unit: (it.unit ?? "").trim(),
      remark: (it.remark ?? "").trim() || undefined,
    }))
    .filter((it) => it.description !== "");
  if (cleanItems.length === 0) throw new Error("List at least one item.");

  // Office requisitions normally need no Plant Manager approval — they start
  // APPROVED so the Purchaser can prepare the PO directly. EXCEPTION: an Office
  // requisition that includes in-house duct hardware (Duct Angle corner / TDC
  // Cleat / S-clip / C-clip) is Fans-produced stock the warehouse would release,
  // so the Plant Manager must approve it first — those start PENDING_APPROVAL like
  // a production requisition. Production requisitions always start pending.
  const hasDuctHardware = cleanItems.some((it) => isDuctHardwareStockName(it.description));
  const status = isOffice && !hasDuctHardware ? "APPROVED" : "PENDING_APPROVAL";
  await prisma.purchaseRequest.create({
    data: {
      kind: "department",
      dept,
      items: cleanItems.map(mrfItemLine) as Prisma.InputJsonValue,
      note: note.trim() || null,
      createdById: user.id,
      createdByName: user.name,
      status,
    },
  });

  // Note: items are NOT auto-added to the product catalogue. Only the Purchaser
  // or an admin adds products (with a supplier and price) on the Products page.
  revalidatePath("/requisitions");
  revalidatePath("/purchasing");
}

/**
 * Raise a supplier requisition (→ PO) for an order's BOUGHT-IN products — the
 * "buy" equivalent of the auto job orders for fabricated items. Pulls only the
 * bought-in product lines (fabricated items and typed service / charges are
 * excluded), links the requisition to the order, and files it as an Office
 * requisition (APPROVED) so the Purchaser can prepare the PO directly.
 */
/**
 * Auto-file the supplier requisition for a bought-in order's products when its
 * payment is cleared ("Clear payment & create PO"). Encodes the supplier grid
 * price so the Purchaser's PO auto-fills the unit price. Deduped + serialized per
 * order (advisory lock) so a re-clear can't file a second requisition.
 */
async function autoRaiseBoughtInRequisition(
  quotationId: string,
  quoteNumber: string,
  items: { qty: number; descriptionSnapshot: string; specsSnapshot: unknown }[],
  user: { id: string; name: string },
): Promise<void> {
  const boughtIn = orderBoughtInLines(items);
  if (boughtIn.length === 0) return;
  const lines = boughtIn.map((b) => {
    const line = mrfItemLine({ description: b.name, qty: String(b.qty), unit: "unit" });
    return b.unitPrice != null ? `${line} · @${b.unitPrice}` : line;
  });
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${quotationId}))`;
    const existing = await tx.purchaseRequest.count({
      where: { quotationId, kind: "department", status: { notIn: ["REJECTED", "COMPLETED"] } },
    });
    if (existing > 0) return; // already raised — don't duplicate on a re-clear
    await tx.purchaseRequest.create({
      data: {
        kind: "department",
        dept: OFFICE_DEPT_KEY,
        quotationId,
        items: lines as Prisma.InputJsonValue,
        note: `Bought-in items for order ${quoteNumber}`,
        createdById: user.id,
        createdByName: user.name,
        status: "APPROVED", // Office requisition → straight to the Purchaser for the PO
      },
    });
  });
  revalidatePath("/requisitions");
  revalidatePath("/purchasing");
}

/**
 * Sales notifies the client a bought-in order is ready → the order enters Phase 5
 * (billing / final payment). Available once the supplier goods have been received
 * (the full purchasing chain is complete).
 */
export async function notifyClientBoughtInOrder(quotationId: string): Promise<void> {
  const user = await getCurrentUser();
  if (!user) throw new Error("Unauthorized");
  const { quote, cls, wf } = await loadWorkflow(quotationId);
  const isSales = isAdmin(user) || quote.preparedById === user.id || user.role === "SALES" || user.role === "ENGINEER";
  if (!isSales) throw new Error("Only a Sales team member or an admin can do this.");
  if (wf.stage !== "released") throw new Error("The order isn't awaiting client notification.");
  // The Purchaser must have bought the goods (bought items go straight to the
  // client — they don't pass warehouse receiving into stock).
  const purchased: PRStatus[] = ["PURCHASED", "CHECKED", "DELIVERED", "RECEIVED", "PLANT_APPROVED", "COMPLETED"];
  const bought = await prisma.purchaseRequest.count({
    where: { quotationId, kind: "department", status: { in: purchased } },
  });
  if (bought === 0) throw new Error("The Purchaser must buy the goods before notifying the client.");
  await saveWorkflow(quotationId, cls, { ...wf, stage: "final_pay_review", approvals: stamp(wf, "client_notified", user) });
  await logActivity(user, {
    action: "order.boughtin.notify",
    category: "order",
    summary: `Notified client — bought-in order ready — ${await orderRefLabel(quotationId)}`,
    entity: "order",
    entityId: quotationId,
    href: `/orders/${quotationId}`,
  });
}

/** Who may release a from-stock order — the Warehouse (the Fans & Blowers head has
 *  no authority to release stock items). */
const STOCK_RELEASE_ROLES: WorkflowRoleKey[] = ["warehouse"];

/**
 * A from-stock order (in-house duct hardware, nothing fabricated, nothing bought
 * from a supplier) is fulfilled by issuing the goods from Fans & Blowers on-hand
 * stock. The Warehouse matches each line to a stock item and releases
 * it here: inventory is deducted (an ISSUE movement is the stock record) and the
 * order jumps straight to Phase 5 (final payment → deliver / client pickup),
 * skipping production and the supplier PO — mirrors notifyClientBoughtInOrder.
 */
/**
 * The Plant Manager or an admin approves any from-stock order's release before the
 * warehouse issues it. An Engineer may also approve, but only when every from-stock
 * line is in-house duct hardware (angle corner, TDC cleat, S-clip, C-clip) — not the
 * Office-supplied resale goods (AlphaAir, Vent Cap). The "ask permission first" gate.
 */
export async function approveStockRelease(quotationId: string): Promise<void> {
  const user = await getCurrentUser();
  if (!user) throw new Error("Unauthorized");
  const roles = await getWorkflowRoles();
  const { cls, wf } = await loadWorkflow(quotationId);
  if (wf.stage !== "released") throw new Error("The order isn't awaiting stock release.");
  const items = await prisma.quotationItem.findMany({
    where: { quotationId },
    select: { qty: true, descriptionSnapshot: true, specsSnapshot: true },
  });
  if (!isStockOnlyOrder(items)) throw new Error("This order isn't a from-stock order.");
  // Normal (non-pickup) from-stock release is approved by the Plant Manager (or an
  // admin) only. The Engineer's stock-release role now lives in the office-pickup
  // flow (which uses the single "Release from Stock and Notify Client" action).
  if (!(isAdmin(user) || userHasWorkflowRole(roles, user.id, "plant_manager" as WorkflowRoleKey))) {
    throw new Error("Only the Plant Manager or an admin can approve the stock release.");
  }
  await saveWorkflow(quotationId, cls, { ...wf, approvals: stamp(wf, "stock_release_approved", user) });
  await logActivity(user, {
    action: "order.stock.release.approve",
    category: "order",
    summary: `Approved stock release — ${await orderRefLabel(quotationId)}`,
    entity: "order",
    entityId: quotationId,
    href: `/orders/${quotationId}`,
  });
}

export async function releaseOrderFromStock(quotationId: string, matches: StockMatch[] = []): Promise<void> {
  const user = await getCurrentUser();
  if (!user) throw new Error("Unauthorized");
  const roles = await getWorkflowRoles();
  const { quote, cls, wf } = await loadWorkflow(quotationId);
  if (wf.stage !== "released") throw new Error("The order isn't awaiting stock release.");
  const items = await prisma.quotationItem.findMany({
    where: { quotationId },
    select: { qty: true, descriptionSnapshot: true, specsSnapshot: true },
  });
  if (!isStockOnlyOrder(items)) throw new Error("This order isn't a from-stock order.");
  // Office pickup collapses approval + warehouse release into a single step: the
  // Plant Manager / Engineer (in-house duct hardware only) / admin releases from
  // stock and notifies the client in one action. The normal from-stock flow keeps
  // its two steps (Warehouse releases only after the Plant Manager's approval).
  const pickup = wf.officePickup === true;
  if (pickup) {
    // Office pickup is released by the Engineer alone (or an admin) — not the
    // Plant Manager.
    if (!(isAdmin(user) || user.role === "ENGINEER")) {
      throw new Error("Only an Engineer or an admin can release an office-pickup order from stock.");
    }
  } else {
    if (!(isAdmin(user) || STOCK_RELEASE_ROLES.some((r) => userHasWorkflowRole(roles, user.id, r)))) {
      throw new Error("Only the Warehouse or an admin can release from stock.");
    }
    // The Plant Manager must approve the release before the warehouse issues the stock.
    if (!wf.approvals.stock_release_approved) {
      throw new Error("The Plant Manager must approve the stock release first.");
    }
  }
  // Deduct the released quantities from inventory. Unmatched lines are skipped
  // (nothing deducted) — the warehouse reconciles in Inventory if stock went short,
  // exactly like the MRF release. Then advance straight to Phase 5.
  const clean = (matches ?? []).filter((m) => m.stockItemId && Number(m.qty) > 0);
  // Pickup records the release-approval stamp too (the single action both approves
  // and releases), so the trail shows who released it.
  const approvals = pickup
    ? stamp({ approvals: stamp(wf, "stock_release_approved", user) }, "client_notified", user)
    : stamp(wf, "client_notified", user);
  const workflow = { ...wf, stage: "final_pay_review", approvals };
  await prisma.$transaction(async (tx) => {
    for (const m of clean) {
      const item = await tx.stockItem.findUnique({ where: { id: m.stockItemId } });
      if (!item) continue; // stock item gone (e.g. merged) — skip its deduction
      const deduct = Math.min(Number(m.qty), Math.max(0, Number(item.quantity)));
      if (deduct > 0) {
        await applyStockChange(
          tx,
          { stockItemId: m.stockItemId, kind: "ISSUE", qty: deduct, reason: `Order ${quote.quoteNumber} released from stock` },
          user.name,
        );
      }
    }
    await tx.quotation.update({
      where: { id: quotationId },
      data: { classification: { ...cls, workflow } as unknown as Prisma.InputJsonObject },
    });
  });
  revalidatePath("/orders");
  revalidatePath(`/orders/${quotationId}`);
  revalidatePath("/inventory");
  await logActivity(user, {
    action: "order.stock.release",
    category: "order",
    summary: `Released order from stock — ${await orderRefLabel(quotationId)}`,
    entity: "order",
    entityId: quotationId,
    href: `/orders/${quotationId}`,
  });
}

/**
 * The requesting department head (or an admin) withdraws a material request
 * before the warehouse handles it. Only possible while it's still "requested".
 */
export async function cancelMaterialRequest(quotationId: string, requestId: string): Promise<void> {
  const user = await getCurrentUser();
  if (!user) throw new Error("Unauthorized");
  const { quote, cls, wf } = await loadWorkflow(quotationId);
  const idx = wf.materialRequests.findIndex((m) => m.id === requestId);
  if (idx < 0) throw new Error("Material request not found.");
  const mrf = wf.materialRequests[idx];
  if (mrf.status === "cancelled" || mrf.status === "completed") throw new Error("This material request is already closed.");
  const admin = isAdmin(user);
  const isDeptHead = userHasWorkflowRole(await getWorkflowRoles(), user.id, deptRole(mrf.dept) as WorkflowRoleKey);
  // The requesting dept head may cancel only while it's still 'requested' (before
  // the warehouse handles it); an admin may cancel a material request at ANY stage.
  if (mrf.status !== "requested" && !admin) {
    throw new Error("Only an admin can cancel a material request the warehouse has already handled.");
  }
  if (!(admin || isDeptHead)) {
    throw new Error(`Only the ${deptLabel(mrf.dept)} head or an admin can cancel this material request.`);
  }
  // Release any active soft-reservations held for this MRF (safe cleanup). Issued
  // stock isn't reversed (it's already been taken) and a linked purchase request,
  // if any, is left for the Purchaser/admin to cancel in Purchasing.
  await prisma.stockReservation
    .updateMany({
      where: { active: true, forRef: quote.quoteNumber || "order", note: `MRF #${mrf.formNo}` },
      data: { active: false, releasedByName: user.name, releasedAt: new Date() },
    })
    .catch(() => {});
  const materialRequests = wf.materialRequests.slice();
  materialRequests[idx] = { ...mrf, status: "cancelled", handledAt: new Date().toISOString(), handledByName: user.name };
  await saveWorkflow(quotationId, cls, { ...wf, materialRequests });
  revalidatePath("/inventory");
}

/** Helper: load an MRF and enforce the requesting-department-head (or admin) actor. */
async function loadMrfForDeptHead(quotationId: string, requestId: string) {
  const user = await getCurrentUser();
  if (!user) throw new Error("Unauthorized");
  const { cls, wf } = await loadWorkflow(quotationId);
  const idx = wf.materialRequests.findIndex((m) => m.id === requestId);
  if (idx < 0) throw new Error("Material request not found.");
  const mrf = wf.materialRequests[idx];
  if (!(isAdmin(user) || userHasWorkflowRole(await getWorkflowRoles(), user.id, deptRole(mrf.dept) as WorkflowRoleKey))) {
    throw new Error(`Only the ${deptLabel(mrf.dept)} head or an admin can do this.`);
  }
  return { user, cls, wf, idx, mrf };
}

/** The requesting department confirms it received the released materials. */
export async function confirmMaterialReceipt(quotationId: string, requestId: string): Promise<void> {
  const { user, cls, wf, idx, mrf } = await loadMrfForDeptHead(quotationId, requestId);
  if (mrf.status !== "issued" && mrf.status !== "partial") {
    throw new Error("There are no released materials to confirm yet.");
  }
  // A stock line issued below its requested quantity still owes a balance — the
  // MRF can't be "completed" until every requested item is actually issued. (An
  // outstanding purchase line does not block completion; the department confirms
  // it received what was released, and purchasing is tracked separately.)
  const hasShortfall = mrf.items.some((it) => {
    const req = Number(it.qty || 0);
    if (it.disposition === "issue" || it.disposition === "reserve") return Number(it.issuedQty ?? it.qty ?? 0) < req;
    // A purchase line is short when it hasn't been fully released yet
    // (undefined = not released). This keeps a partial release from completing.
    if (it.disposition === "purchase") return Number(it.issuedQty ?? 0) < req;
    return false;
  });
  const materialRequests = wf.materialRequests.slice();
  materialRequests[idx] = {
    ...mrf,
    status: hasShortfall ? mrf.status : "completed",
    confirmedAt: new Date().toISOString(),
    confirmedByName: user.name,
  };
  await saveWorkflow(quotationId, cls, { ...wf, materialRequests });
  await logActivity(user, {
    action: "mrf.confirmed", category: "order",
    summary: hasShortfall
      ? `MRF #${mrf.formNo} received (partial — balance still owing) — ${deptLabel(mrf.dept)} confirmed · ${await orderRefLabel(quotationId)}`
      : `MRF #${mrf.formNo} completed — ${deptLabel(mrf.dept)} confirmed receipt · ${await orderRefLabel(quotationId)}`,
    entity: "order", entityId: quotationId, href: `/orders/${quotationId}`,
  });
}

/** The requesting department follows up on an outstanding material request. */
export async function followUpMaterialRequest(quotationId: string, requestId: string): Promise<void> {
  const { user, cls, wf, idx, mrf } = await loadMrfForDeptHead(quotationId, requestId);
  const followUps = [...(mrf.followUps ?? []), { at: new Date().toISOString(), byName: user.name }];
  const materialRequests = wf.materialRequests.slice();
  materialRequests[idx] = { ...mrf, followUps };
  await saveWorkflow(quotationId, cls, { ...wf, materialRequests });
  await logActivity(user, {
    action: "mrf.followup", category: "order",
    summary: `${deptLabel(mrf.dept)} followed up MRF #${mrf.formNo} — ${await orderRefLabel(quotationId)}`,
    entity: "order", entityId: quotationId, href: `/orders/${quotationId}`,
  });
}

/** The warehouse informs the requesting department that the materials are available. */
export async function informMaterialAvailable(quotationId: string, requestId: string): Promise<void> {
  const user = await getCurrentUser();
  if (!user) throw new Error("Unauthorized");
  if (!(isAdmin(user) || userHasWorkflowRole(await getWorkflowRoles(), user.id, "warehouse" as WorkflowRoleKey))) {
    throw new Error("Only the Warehouse or an admin can inform the requestor.");
  }
  const { cls, wf } = await loadWorkflow(quotationId);
  const idx = wf.materialRequests.findIndex((m) => m.id === requestId);
  if (idx < 0) throw new Error("Material request not found.");
  const mrf = wf.materialRequests[idx];
  const materialRequests = wf.materialRequests.slice();
  materialRequests[idx] = { ...mrf, informedAt: new Date().toISOString(), informedByName: user.name };
  await saveWorkflow(quotationId, cls, { ...wf, materialRequests });
  await logActivity(user, {
    action: "mrf.informed", category: "order",
    summary: `Warehouse told ${deptLabel(mrf.dept)}: MRF #${mrf.formNo} materials are available — ${await orderRefLabel(quotationId)}`,
    entity: "order", entityId: quotationId, href: `/orders/${quotationId}`,
  });
}

/** Roles that can release purchased materials to the requesting department. */
const MRF_RELEASE_ROLES: WorkflowRoleKey[] = ["warehouse", "purchaser", "payment_approver"];

/**
 * Release the purchased materials of an MRF to the requesting department (after
 * they have been bought and received into stock). Done by the Warehouse,
 * Purchaser, Payment Approver or an admin. Marks the purchase lines as released
 * and moves a "purchasing" MRF to "issued" so the department can then confirm
 * receipt with its "<Dept> Request Received" button.
 */
export async function releaseMaterialToRequestor(
  quotationId: string,
  requestId: string,
  matches: StockMatch[] = [],
  released: { description: string; qty: number }[] = [],
): Promise<void> {
  const user = await getCurrentUser();
  if (!user) throw new Error("Unauthorized");
  const roles = await getWorkflowRoles();
  if (!(isAdmin(user) || MRF_RELEASE_ROLES.some((r) => userHasWorkflowRole(roles, user.id, r)))) {
    throw new Error("Only the Warehouse, Purchaser, Payment Approver or an admin can release the materials.");
  }
  const { cls, wf } = await loadWorkflow(quotationId);
  const idx = wf.materialRequests.findIndex((m) => m.id === requestId);
  if (idx < 0) throw new Error("Material request not found.");
  const mrf = wf.materialRequests[idx];
  if (mrf.status === "cancelled") throw new Error("A cancelled request can't be released.");
  // Record the released quantity PER purchase line (accumulating across releases).
  // Only the lines actually released this round are updated — a partial release
  // leaves the rest as "To purchase" so the card shows what/how much was released.
  const relByDesc = new Map<string, number>();
  for (const r of released ?? []) {
    const k = r.description.trim().toLowerCase();
    if (k && Number(r.qty) > 0) relByDesc.set(k, (relByDesc.get(k) ?? 0) + Number(r.qty));
  }
  // Fallback: if no per-line data was passed (older callers), release every line.
  const items = mrf.items.map((it) => {
    if (it.disposition !== "purchase") return it;
    if (relByDesc.size === 0) return { ...it, issuedQty: it.issuedQty ?? it.qty };
    const add = relByDesc.get(it.description.trim().toLowerCase());
    if (add == null) return it; // not released this round
    return { ...it, issuedQty: String(Number(it.issuedQty ?? 0) + add) };
  });
  // Fully released only when every purchase line's released qty covers what was
  // requested; otherwise the MRF stays "partial".
  const purchaseLines = items.filter((it) => it.disposition === "purchase");
  const allReleased = purchaseLines.length > 0 && purchaseLines.every((it) => Number(it.issuedQty ?? 0) >= Number(it.qty || 0));
  const status: MaterialRequest["status"] =
    mrf.status === "purchasing" || mrf.status === "partial" ? (allReleased ? "issued" : "partial") : mrf.status;
  // Deduct the released quantities from inventory (the purchase already received
  // them into stock; releasing to the department issues them out). Lines left
  // unmatched are skipped — nothing is deducted for them.
  const clean = (matches ?? []).filter((m) => m.stockItemId && Number(m.qty) > 0);
  const materialRequests = wf.materialRequests.slice();
  materialRequests[idx] = { ...mrf, items, status, releasedAt: new Date().toISOString(), releasedByName: user.name };
  await prisma.$transaction(async (tx) => {
    for (const m of clean) {
      const item = await tx.stockItem.findUnique({ where: { id: m.stockItemId } });
      if (!item) continue; // stock item gone (e.g. merged) — skip its deduction
      // Deduct only what's on hand: a stock shortfall (often from a duplicate/merged
      // item) must not block the release. The MRF record still reflects the released
      // quantity — reconcile the stock separately in Inventory if it went short.
      const deduct = Math.min(Number(m.qty), Math.max(0, Number(item.quantity)));
      if (deduct > 0) {
        await applyStockChange(
          tx,
          { stockItemId: m.stockItemId, kind: "ISSUE", qty: deduct, reason: `MRF #${mrf.formNo} released to ${deptLabel(mrf.dept)}` },
          user.name,
        );
      }
    }
    await tx.quotation.update({
      where: { id: quotationId },
      data: { classification: { ...cls, workflow: { ...wf, materialRequests } } as unknown as Prisma.InputJsonObject },
    });
  });
  revalidatePath("/orders");
  revalidatePath(`/orders/${quotationId}`);
  revalidatePath("/inventory");
  await logActivity(user, {
    action: "mrf.released", category: "order",
    summary: `Released MRF #${mrf.formNo} materials to ${deptLabel(mrf.dept)} — ${await orderRefLabel(quotationId)}`,
    entity: "order", entityId: quotationId, href: `/orders/${quotationId}`,
  });
}

/**
 * Admin correction: SET the exact released quantity of each purchase line (does
 * not add), then recompute the MRF status. Used to fix records where the release
 * was mis-recorded. Does NOT touch inventory — the original release already
 * deducted the actual amounts; adjust stock separately if needed.
 */
export async function setMrfReleasedQuantities(
  quotationId: string,
  requestId: string,
  released: { description: string; qty: number }[],
): Promise<void> {
  const user = await getCurrentUser();
  if (!user) throw new Error("Unauthorized");
  if (!isAdmin(user)) throw new Error("Only an admin can correct released quantities.");
  const { cls, wf } = await loadWorkflow(quotationId);
  const idx = wf.materialRequests.findIndex((m) => m.id === requestId);
  if (idx < 0) throw new Error("Material request not found.");
  const mrf = wf.materialRequests[idx];
  const relByDesc = new Map((released ?? []).map((r) => [r.description.trim().toLowerCase(), Math.max(0, Number(r.qty) || 0)]));
  const items = mrf.items.map((it) => {
    if (it.disposition !== "purchase") return it;
    const q = relByDesc.get(it.description.trim().toLowerCase());
    return q == null ? it : { ...it, issuedQty: String(q) };
  });
  const purchaseLines = items.filter((it) => it.disposition === "purchase");
  const allReleased = purchaseLines.length > 0 && purchaseLines.every((it) => Number(it.issuedQty ?? 0) >= Number(it.qty || 0));
  const status: MaterialRequest["status"] = allReleased ? (mrf.confirmedAt ? "completed" : "issued") : "partial";
  const materialRequests = wf.materialRequests.slice();
  materialRequests[idx] = { ...mrf, items, status };
  await saveWorkflow(quotationId, cls, { ...wf, materialRequests });
  await logActivity(user, {
    action: "mrf.correct", category: "order",
    summary: `Corrected released quantities on MRF #${mrf.formNo} — ${await orderRefLabel(quotationId)}`,
    entity: "order", entityId: quotationId, href: `/orders/${quotationId}`,
  });
}

/**
 * Admin correction: clear a receipt confirmation that was recorded without the
 * requesting department actually pressing "<Dept> Request Received" (e.g. legacy
 * records from an earlier build, or a confirmation stamped from an admin session).
 * Removes confirmedAt / confirmedByName and reverts the status from "completed"
 * back to "issued" (fully released) or "partial", so the requesting department can
 * confirm receipt itself. Does NOT touch inventory.
 */
export async function resetMaterialReceipt(quotationId: string, requestId: string): Promise<void> {
  const user = await getCurrentUser();
  if (!user) throw new Error("Unauthorized");
  if (!isAdmin(user)) throw new Error("Only an admin can reset a receipt confirmation.");
  const { cls, wf } = await loadWorkflow(quotationId);
  const idx = wf.materialRequests.findIndex((m) => m.id === requestId);
  if (idx < 0) throw new Error("Material request not found.");
  const mrf = wf.materialRequests[idx];
  if (!mrf.confirmedAt && !mrf.confirmedByName) throw new Error("This request has no receipt confirmation to reset.");
  // Recompute the pre-confirmation status from what has actually been provided:
  // "issued" when every line's issued/released qty covers what was requested,
  // otherwise "partial".
  const fullyProvided = mrf.items.every((it) => {
    const req = Number(it.qty || 0);
    const provided = Number(it.issuedQty ?? (it.disposition === "purchase" ? 0 : it.qty ?? 0));
    return provided >= req;
  });
  const materialRequests = wf.materialRequests.slice();
  materialRequests[idx] = { ...mrf, status: fullyProvided ? "issued" : "partial", confirmedAt: undefined, confirmedByName: undefined };
  await saveWorkflow(quotationId, cls, { ...wf, materialRequests });
  await logActivity(user, {
    action: "mrf.reset_receipt", category: "order",
    summary: `Reset receipt confirmation on MRF #${mrf.formNo} — ${await orderRefLabel(quotationId)}`,
    entity: "order", entityId: quotationId, href: `/orders/${quotationId}`,
  });
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

  // Available-to-use quantity (on-hand − active reservations) for each stock item
  // the warehouse chose to issue/reserve. What can't be covered from stock —
  // including an item that's completely out of stock — auto-routes to purchasing.
  const stockIds = [...new Set(dispositions.filter((d) => (d.action === "issue" || d.action === "reserve") && d.stockItemId).map((d) => d.stockItemId as string))];
  const availById = new Map<string, number>();
  if (stockIds.length) {
    const [stk, resv] = await Promise.all([
      prisma.stockItem.findMany({ where: { id: { in: stockIds } }, select: { id: true, quantity: true } }),
      prisma.stockReservation.groupBy({ by: ["stockItemId"], where: { active: true, stockItemId: { in: stockIds } }, _sum: { qty: true } }),
    ]);
    const resvBy = new Map(resv.map((r) => [r.stockItemId, Number(r._sum.qty ?? 0)]));
    for (const s of stk) availById.set(s.id, Math.max(0, Number(s.quantity) - (resvBy.get(s.id) ?? 0)));
  }

  // Plan each requested line: how much is issued/reserved from stock now (capped
  // at what's actually available), and how much is short. The shortfall on a
  // partial issue/reserve is escalated to purchasing (previously it was silently
  // dropped); an out-of-stock item moves entirely to purchasing.
  const plans = mrf.items.map((it, i) => {
    const d = dispositions[i];
    const disposition = dispOf(d?.action ?? "issue");
    const req = Number(it.qty || 0);
    if (disposition === "purchase") return { it, disposition, issuedHere: 0, stockItemId: undefined as string | undefined, shortfall: req };
    const got = d?.qty != null && Number(d.qty) > 0 ? Number(d.qty) : 0;
    // Cap at available stock when an item was picked (out of stock → 0 → all purchased).
    const avail = d?.stockItemId ? (availById.get(d.stockItemId) ?? 0) : Number.POSITIVE_INFINITY;
    const wanted = req > 0 ? Math.min(got, req) : got;
    const issuedHere = Math.max(0, Math.min(wanted, avail));
    return { it, disposition, issuedHere, stockItemId: d?.stockItemId || undefined, shortfall: req > 0 ? Math.max(0, req - issuedHere) : 0 };
  });

  // A short issue/reserve line splits into the issued portion (from stock) plus a
  // "purchase" line for the un-issued balance, so the shortfall actually reaches
  // purchasing (matching the "Partly issued · purchasing" status). Fully-issued
  // and full-purchase lines stay a single line.
  const items: MRFItem[] = [];
  for (const p of plans) {
    if (p.disposition === "purchase") {
      items.push({ ...p.it, disposition: "purchase", issuedQty: undefined });
      continue;
    }
    if (p.issuedHere > 0) items.push({ ...p.it, qty: String(p.issuedHere), disposition: p.disposition, issuedQty: String(p.issuedHere) });
    if (p.shortfall > 0) items.push({ ...p.it, qty: String(p.shortfall), disposition: "purchase", issuedQty: undefined });
  }

  const issueMatches = plans.filter((p) => p.disposition === "issue" && p.stockItemId && p.issuedHere > 0).map((p) => ({ stockItemId: p.stockItemId as string, qty: p.issuedHere }));
  const reserveMatches = plans.filter((p) => p.disposition === "reserve" && p.stockItemId && p.issuedHere > 0).map((p) => ({ stockItemId: p.stockItemId as string, qty: p.issuedHere }));
  const purchaseItems = items.filter((it) => it.disposition === "purchase");

  const anyStock = items.some((it) => it.disposition === "issue" || it.disposition === "reserve");
  const anyPurchase = purchaseItems.length > 0;
  if (!anyStock && !anyPurchase) throw new Error("Nothing to process.");
  // Some issued from stock + something going to purchasing → partial; only
  // purchasing → purchasing; everything issued in full → issued.
  const status: MaterialRequest["status"] =
    anyPurchase ? (anyStock ? "partial" : "purchasing") : "issued";
  const orderRef = quote.quoteNumber || "order";

  await prisma.$transaction(async (tx) => {
    for (const m of issueMatches) {
      await applyStockChange(tx, { stockItemId: m.stockItemId, kind: "ISSUE", qty: m.qty, reason: `MRF #${mrf.formNo}` }, user.name);
      // In-house duct hardware pulled from Fans stock → book the Fans-sale/dept-purchase transfer.
      const si = await tx.stockItem.findUnique({ where: { id: m.stockItemId }, select: { name: true, unitCost: true } });
      if (si) await recordDeptStockTransfer(tx, { quotationId, toDept: mrf.dept, stockItemId: m.stockItemId, name: si.name, unitCost: Number(si.unitCost), qty: m.qty, byName: user.name });
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

/** MRF status from the current line dispositions once every line is handled. */
function mrfFinalStatus(items: MRFItem[]): MaterialRequest["status"] {
  const anyStock = items.some((it) => it.disposition === "issue" || it.disposition === "reserve");
  const anyPurchase = items.some((it) => it.disposition === "purchase");
  return anyPurchase ? (anyStock ? "partial" : "purchasing") : "issued";
}

/**
 * Finalise a partly-handled MRF once no line is left pending: set the final
 * status and create the linked purchase request for the accumulated purchase
 * lines (only if one doesn't already exist). Called from the incremental
 * per-line actions inside their transaction.
 */
async function finalizeMrfIfDone(
  tx: Prisma.TransactionClient,
  quotationId: string,
  mrf: MaterialRequest,
  idx: number,
  cls: Record<string, unknown>,
  wf: OrderWorkflow,
  newItems: MRFItem[],
  user: { id: string; name: string },
): Promise<void> {
  const pendingRemain = newItems.some((it) => !it.disposition);
  const status: MaterialRequest["status"] = pendingRemain ? "partial" : mrfFinalStatus(newItems);
  const materialRequests = wf.materialRequests.slice();
  materialRequests[idx] = { ...mrf, items: newItems, status, handledAt: new Date().toISOString(), handledByName: user.name };
  await tx.quotation.update({
    where: { id: quotationId },
    data: { classification: { ...cls, workflow: { ...wf, materialRequests } } as unknown as Prisma.InputJsonObject },
  });
  // Surface purchase lines to Purchasing as soon as ANY line is marked "purchase"
  // — don't wait for every line to be handled, or a single stranded pending line
  // would keep the whole request out of the Purchasing tab. Create the linked
  // request on first purchase line, then keep it in sync with the accumulating
  // purchase lines while it's still awaiting approval (never touch it once it has
  // advanced / been turned into a PO).
  const purchaseItems = newItems.filter((it) => it.disposition === "purchase");
  if (purchaseItems.length > 0) {
    const itemLines = purchaseItems.map(mrfItemLine) as Prisma.InputJsonValue;
    const existing = await tx.purchaseRequest.findFirst({ where: { mrfId: mrf.id }, select: { id: true, status: true } });
    if (!existing) {
      await tx.purchaseRequest.create({
        data: {
          quotationId,
          mrfId: mrf.id,
          dept: mrf.dept,
          items: itemLines,
          note: mrf.note ?? null,
          createdById: user.id,
          createdByName: user.name,
          status: "PENDING_APPROVAL",
        },
      });
    } else if (existing.status === "PENDING_APPROVAL") {
      await tx.purchaseRequest.update({ where: { id: existing.id }, data: { items: itemLines } });
    }
  }
}

async function requireWarehouse(): Promise<{ id: string; name: string }> {
  const user = await getCurrentUser();
  if (!user) throw new Error("Unauthorized");
  if (!(isAdmin(user) || userHasWorkflowRole(await getWorkflowRoles(), user.id, "warehouse" as WorkflowRoleKey))) {
    throw new Error("Only the Warehouse or an admin can issue materials.");
  }
  return { id: user.id, name: user.name };
}

/**
 * Issue ONE material-request line from stock, incrementally. Deducts the
 * requested quantity (capped at what's actually available) from the chosen stock
 * item and marks that line issued; any shortfall / out-of-stock balance splits
 * off as a "purchase" line. Other lines stay pending until they're handled too;
 * the linked purchase request is created once the last line is handled.
 */
export async function issueMrfLineFromStock(
  quotationId: string,
  requestId: string,
  lineIndex: number,
  stockItemId: string,
  qty?: number,
): Promise<{ issued: number; toPurchase: number }> {
  const user = await requireWarehouse();
  if (!stockItemId) throw new Error("Pick a stock item.");
  const { cls, wf } = await loadWorkflow(quotationId);
  const idx = wf.materialRequests.findIndex((m) => m.id === requestId);
  if (idx < 0) throw new Error("Material request not found.");
  const mrf = wf.materialRequests[idx];
  if (mrf.status === "cancelled" || mrf.status === "completed") throw new Error("This material request is already closed.");
  const target = mrf.items[lineIndex];
  if (!target) throw new Error("Line not found — refresh and try again.");
  if (target.disposition) throw new Error("This line has already been handled — refresh and try again.");
  const req = Number(target.qty || 0);

  const result = await prisma.$transaction(async (tx) => {
    const item = await tx.stockItem.findUnique({ where: { id: stockItemId }, select: { id: true, quantity: true, name: true, unitCost: true } });
    if (!item) throw new Error("Stock item not found.");
    const agg = await tx.stockReservation.aggregate({ where: { stockItemId, active: true }, _sum: { qty: true } });
    const avail = Math.max(0, Number(item.quantity) - Number(agg._sum.qty ?? 0));
    const want = qty != null && qty > 0 ? Math.min(qty, req || qty) : req;
    const issued = Math.max(0, Math.min(want, avail));
    if (issued > 0) {
      await applyStockChange(tx, { stockItemId, kind: "ISSUE", qty: issued, reason: `MRF #${mrf.formNo}` }, user.name);
      // In-house duct hardware pulled from Fans stock → book the Fans-sale/dept-purchase transfer.
      await recordDeptStockTransfer(tx, { quotationId, toDept: mrf.dept, stockItemId, name: item.name, unitCost: Number(item.unitCost), qty: issued, byName: user.name });
    }
    const shortfall = req > 0 ? Math.max(0, req - issued) : 0;
    const replacement: MRFItem[] = [];
    if (issued > 0) replacement.push({ ...target, qty: String(issued), disposition: "issue", issuedQty: String(issued) });
    if (shortfall > 0) replacement.push({ ...target, qty: String(shortfall), disposition: "purchase", issuedQty: undefined });
    if (replacement.length === 0) replacement.push({ ...target, disposition: "purchase", issuedQty: undefined });
    const newItems = [...mrf.items.slice(0, lineIndex), ...replacement, ...mrf.items.slice(lineIndex + 1)];
    await finalizeMrfIfDone(tx, quotationId, mrf, idx, cls, wf, newItems, user);
    return { issued, toPurchase: shortfall };
  });

  revalidatePath("/orders");
  revalidatePath(`/orders/${quotationId}`);
  revalidatePath("/inventory");
  revalidatePath("/purchasing");
  return result;
}

/** Send ONE pending material-request line straight to purchasing (no stock). */
export async function sendMrfLineToPurchasing(quotationId: string, requestId: string, lineIndex: number): Promise<void> {
  const user = await requireWarehouse();
  const { cls, wf } = await loadWorkflow(quotationId);
  const idx = wf.materialRequests.findIndex((m) => m.id === requestId);
  if (idx < 0) throw new Error("Material request not found.");
  const mrf = wf.materialRequests[idx];
  if (mrf.status === "cancelled" || mrf.status === "completed") throw new Error("This material request is already closed.");
  const target = mrf.items[lineIndex];
  if (!target) throw new Error("Line not found — refresh and try again.");
  if (target.disposition) throw new Error("This line has already been handled — refresh and try again.");

  await prisma.$transaction(async (tx) => {
    const newItems = [...mrf.items.slice(0, lineIndex), { ...target, disposition: "purchase" as MRFLineDisposition, issuedQty: undefined }, ...mrf.items.slice(lineIndex + 1)];
    await finalizeMrfIfDone(tx, quotationId, mrf, idx, cls, wf, newItems, user);
  });

  revalidatePath("/orders");
  revalidatePath(`/orders/${quotationId}`);
  revalidatePath("/inventory");
  revalidatePath("/purchasing");
}

/** Parse a requisition item line "5 pc · ANGLE BAR 2.0 X 25 X 25 (remark)". */
function parseReqItemLine(label: string): { qty: number; unit: string; desc: string } {
  const noRemark = label.replace(/\s*\([^)]*\)\s*$/, "").trim();
  const dot = noRemark.indexOf("·");
  if (dot >= 0) {
    const head = noRemark.slice(0, dot).trim();
    const m = head.match(/^([\d.]+)\s*(.*)$/);
    return { qty: m ? Number(m[1]) || 0 : 0, unit: (m ? m[2] : head).trim(), desc: noRemark.slice(dot + 1).trim() };
  }
  return { qty: 0, unit: "", desc: noRemark };
}

/**
 * Fulfil ONE department-requisition line from stock instead of purchasing it.
 * Deducts the line quantity (capped at what's available) from the chosen stock
 * item and records the issued amount as an "Issued X from stock" line (kept for
 * the record, never purchased); anything short stays on the requisition to be
 * purchased. When every line has been issued, the requisition is completed (no
 * purchase needed). Only before a purchase order exists.
 */
export async function issueRequisitionLineFromStock(
  purchaseRequestId: string,
  lineIndex: number,
  stockItemId: string,
  qty?: number,
): Promise<{ issued: number; remaining: number }> {
  const user = await requireWarehouse();
  if (!stockItemId) throw new Error("Pick a stock item.");
  const pr = await prisma.purchaseRequest.findUnique({ where: { id: purchaseRequestId } });
  if (!pr) throw new Error("Requisition not found.");
  if (pr.po) throw new Error("A purchase order already exists — this can't be fulfilled from stock.");
  // The Plant Manager must approve the requisition before the warehouse may
  // release any item from stock ("ask permission first").
  if (pr.status !== "APPROVED") {
    throw new Error("The Plant Manager must approve this requisition before it can be released from stock.");
  }
  const items = Array.isArray(pr.items) ? (pr.items as string[]).slice() : [];
  const target = items[lineIndex];
  if (target == null) throw new Error("Line not found — refresh and try again.");
  if (isIssuedFromStockLine(target)) throw new Error("This line has already been issued from stock.");
  if (isToPurchaseLine(target)) throw new Error("This line is already marked for purchasing.");
  const parsed = parseReqItemLine(target);
  const req = qty != null && qty > 0 ? qty : parsed.qty;
  if (!(req > 0)) throw new Error("Couldn't read the quantity for this line.");

  const result = await prisma.$transaction(async (tx) => {
    const item = await tx.stockItem.findUnique({ where: { id: stockItemId }, select: { quantity: true, name: true, unitCost: true } });
    if (!item) throw new Error("Stock item not found.");
    const agg = await tx.stockReservation.aggregate({ where: { stockItemId, active: true }, _sum: { qty: true } });
    const avail = Math.max(0, Number(item.quantity) - Number(agg._sum.qty ?? 0));
    const issued = Math.max(0, Math.min(req, avail));
    if (issued <= 0) throw new Error("Out of stock — leave it on the requisition to be purchased.");
    await applyStockChange(tx, { stockItemId, kind: "ISSUE", qty: issued, reason: `Requisition · ${requisitionDeptLabel(pr.dept)}` }, user.name);
    // In-house duct hardware pulled from Fans stock → book the Fans-sale/dept-purchase transfer.
    await recordDeptStockTransfer(tx, { quotationId: pr.quotationId, toDept: pr.dept ?? "", stockItemId, name: item.name, unitCost: Number(item.unitCost), qty: issued, byName: user.name });
    const shortfall = parsed.qty > 0 ? Math.max(0, parsed.qty - issued) : 0;
    // Keep an "Issued X from stock" record line (never purchased); anything short
    // stays as its own purchase line so the Purchaser only buys the remainder.
    const replacement = [issuedFromStockLine(issued, parsed.unit, parsed.desc)];
    if (shortfall > 0) replacement.push(`${parsed.unit ? `${shortfall} ${parsed.unit}` : shortfall} · ${parsed.desc}`);
    const newItems = [...items.slice(0, lineIndex), ...replacement, ...items.slice(lineIndex + 1)];
    const remainingToBuy = newItems.filter((s) => !isIssuedFromStockLine(s));
    const data: Prisma.PurchaseRequestUpdateInput = { items: newItems as Prisma.InputJsonValue };
    if (remainingToBuy.length === 0) data.status = "COMPLETED";
    await tx.purchaseRequest.update({ where: { id: purchaseRequestId }, data });
    return { issued, remaining: remainingToBuy.length };
  });

  revalidatePath("/requisitions");
  revalidatePath("/purchasing");
  revalidatePath("/inventory");
  if (pr.quotationId) revalidatePath(`/orders/${pr.quotationId}`);
  return result;
}

/**
 * Mark ONE requisition line as explicitly sent to purchasing (the MRF's "To
 * purchasing" action). The line is still bought — it just gets a "To purchase"
 * badge so it reads as handled. Warehouse / admin only, before a PO exists.
 */
export async function sendRequisitionLineToPurchasing(
  purchaseRequestId: string,
  lineIndex: number,
): Promise<void> {
  await requireWarehouse();
  const pr = await prisma.purchaseRequest.findUnique({ where: { id: purchaseRequestId } });
  if (!pr) throw new Error("Requisition not found.");
  if (pr.po) throw new Error("A purchase order already exists.");
  // Warehouse triage (issue-from-stock or send-to-purchasing) only after the
  // Plant Manager has approved the requisition.
  if (pr.status !== "APPROVED") {
    throw new Error("The Plant Manager must approve this requisition first.");
  }
  const items = Array.isArray(pr.items) ? (pr.items as string[]).slice() : [];
  const target = items[lineIndex];
  if (target == null) throw new Error("Line not found — refresh and try again.");
  if (isIssuedFromStockLine(target)) throw new Error("This line has already been issued from stock.");
  if (isToPurchaseLine(target)) return; // already marked
  items[lineIndex] = toPurchaseLine(target);
  await prisma.purchaseRequest.update({ where: { id: purchaseRequestId }, data: { items: items as Prisma.InputJsonValue } });
  revalidatePath("/requisitions");
  revalidatePath("/purchasing");
  if (pr.quotationId) revalidatePath(`/orders/${pr.quotationId}`);
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

  const pr = await prisma.purchaseRequest.findUnique({ where: { id: purchaseRequestId } });
  if (!pr) throw new Error("Purchase request not found");

  const isDept = isDeptRequisition(pr);
  // Department / material requisitions: the Plant Manager approves the MRF
  // (approve), then the Approver approves the raised PO (approve_po).
  const stepRole = effectiveStepRole(step, isDept);
  if (!(isAdmin(user) || userHasWorkflowRole(await getWorkflowRoles(), user.id, stepRole))) {
    throw new Error(`Only ${workflowRoleLabel(stepRole)} or an admin can do this.`);
  }

  if (!purchaseStepsFrom(pr.status as PRStatus, isDept, isPoApproved(pr.chainLog)).some((s) => s.key === stepKey)) {
    throw new Error("That step isn't available at the current status.");
  }

  // The supplier Purchase Order must be issued before the purchase can be
  // approved by the Approver (approve_po) or the voucher & check readied —
  // everything downstream is drawn against the PO. For an order-linked request
  // the single "approve"/"reject" IS the PO approval, so it also needs the PO;
  // a department MRF's Plant-Manager approve/reject comes before the PO exists.
  // (Replenishment top-ups have no PO panel, so this only gates real POs.)
  const needsPo =
    stepKey === "voucher" ||
    stepKey === "approve_po" ||
    ((stepKey === "approve" || stepKey === "reject") && !isDept);
  if (needsPo && pr.kind !== "replenishment" && !coercePurchaseOrder(pr.po)) {
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
    case "approve_po":
    case "reject_po":
    case "sign":
    case "release_cash":
    case "hand_purchaser":
    case "confirm_cash":
    case "assign_tasks":
    case "logistics_confirm":
    case "deliver":
    case "warehouse_approve": {
      const log = (pr.chainLog && typeof pr.chainLog === "object" ? pr.chainLog : {}) as Record<string, unknown>;
      data.chainLog = { ...log, [stepKey]: { byName: user.name, at: now.toISOString() } } as Prisma.InputJsonValue;
      if (note && (stepKey === "approve_po" || stepKey === "reject_po")) data.decisionNote = note;
      break;
    }
    case "buy":
      data.purchasedByName = user.name;
      data.purchasedAt = now;
      break;
    case "check":
      data.checkedByName = user.name;
      data.checkedAt = now;
      // A bought-in order requisition (Office requisition linked to an order) goes
      // straight to the client — it never passes warehouse receiving into stock.
      // Checking the purchased item therefore completes it: skip Deliver to
      // Warehouseman → Warehouseman Received → Plant Manager → Receive & Add Stock.
      if (pr.kind === "department" && pr.dept === OFFICE_DEPT_KEY && pr.quotationId) {
        data.status = "COMPLETED";
        data.receivedByName = user.name;
        data.receivedAt = now;
      }
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
  await logActivity(user, {
    action: `purchase.${stepKey}`,
    category: "purchase",
    summary: `${step.label} — ${pr.quotationId ? await orderRefLabel(pr.quotationId) : "purchase request"}`,
    entity: "purchase",
    entityId: purchaseRequestId,
    href: pr.quotationId ? `/orders/${pr.quotationId}` : "/purchasing",
  });
  if (pr.quotationId) revalidatePath(`/orders/${pr.quotationId}`);
  revalidatePath("/purchasing");
}

/** Roles that can flag items for return to the supplier (any inspection point). */
const RETURN_RAISE_ROLES: WorkflowRoleKey[] = ["purchaser", "warehouse", "plant_manager"];

async function userHasAnyRole(userId: string, roles: WorkflowRoleKey[]): Promise<boolean> {
  const assignments = await getWorkflowRoles();
  return roles.some((r) => userHasWorkflowRole(assignments, userId, r));
}

/**
 * Flag one or more purchased items as disapproved and send them back to the
 * supplier for replacement. Recorded against the request (the anchor, for a
 * combined PO) with who/designation/when; the item is tracked until the
 * replacement is received. The main chain keeps its status — the return rides
 * alongside and gates the final "receive into stock" step.
 */
export async function returnPurchaseItems(
  purchaseRequestId: string,
  input: { items: string; reason: string },
): Promise<void> {
  const user = await getCurrentUser();
  if (!user) throw new Error("Unauthorized");
  const admin = isAdmin(user);
  if (!(admin || (await userHasAnyRole(user.id, RETURN_RAISE_ROLES)))) {
    throw new Error("Only the Purchaser, Warehouse, Plant Manager or an admin can return items to the supplier.");
  }
  const items = input.items.trim();
  const reason = input.reason.trim();
  if (!items) throw new Error("Describe which item(s) are being returned.");
  if (!reason) throw new Error("Give the reason for the return.");

  const pr = await prisma.purchaseRequest.findUnique({ where: { id: purchaseRequestId } });
  if (!pr) throw new Error("Purchase request not found");
  if (!canRaiseReturnAt(pr.status as PRStatus)) {
    throw new Error("Items can only be returned once they've been purchased and are under inspection.");
  }

  // The designation the actor is raising the return in (their inspecting role).
  const assignments = await getWorkflowRoles();
  const role = RETURN_RAISE_ROLES.find((r) => userHasWorkflowRole(assignments, user.id, r));
  const raisedRole = role ? workflowRoleLabel(role) : admin ? "Admin" : "";

  const list = coercePurchaseReturns(pr.returns);
  const now = new Date().toISOString();
  list.push({
    id: randomUUID(),
    items,
    reason,
    raisedByName: user.name,
    raisedRole,
    raisedAt: now,
    stage: "sent",
    stamps: { sent: { byName: user.name, role: raisedRole, at: now } },
  });
  await prisma.purchaseRequest.update({ where: { id: purchaseRequestId }, data: { returns: list as unknown as Prisma.InputJsonValue } });
  if (pr.quotationId) revalidatePath(`/orders/${pr.quotationId}`);
  revalidatePath("/purchasing");
  revalidatePath("/requisitions");
}

/**
 * Advance a supplier return to its next lifecycle stage:
 *   sent → replaced → checked → in_transit → received → approved.
 * Each stage is gated to the role that owns it (Purchaser, Logistics, Warehouse,
 * Plant Manager — admins may do any); the client passes the exact next stage so a
 * step can't be skipped. Proof the item was replaced (uploaded to
 * /api/purchase-uploads) is mandatory to reach "Warehouse received". The final
 * "approved" stage marks the return fully resolved so the PO can be received.
 */
export async function advancePurchaseReturn(
  purchaseRequestId: string,
  returnId: string,
  toStage: ReturnStage,
  opts?: { note?: string; proof?: { path: string; name: string; uploadedAt?: string }[] },
): Promise<void> {
  const user = await getCurrentUser();
  if (!user) throw new Error("Unauthorized");
  const admin = isAdmin(user);

  const pr = await prisma.purchaseRequest.findUnique({ where: { id: purchaseRequestId } });
  if (!pr) throw new Error("Purchase request not found");

  const list = coercePurchaseReturns(pr.returns);
  const entry = list.find((r) => r.id === returnId);
  if (!entry) throw new Error("Return not found.");
  if (isReturnComplete(entry.stage)) throw new Error("This return is already approved and complete.");

  // Only the immediate next stage may be set — no skipping.
  const next = nextReturnStage(entry.stage);
  if (!next) throw new Error("This return has no further stage.");
  if (toStage !== next.key) throw new Error("That isn't the next step for this return.");

  // Gate to the role that owns the target stage.
  const needRole = next.role;
  if (!needRole) throw new Error("That step can't be advanced.");
  const assignments = await getWorkflowRoles();
  if (!(admin || userHasWorkflowRole(assignments, user.id, needRole))) {
    throw new Error(`Only the ${workflowRoleLabel(needRole)} or an admin can mark "${next.label}".`);
  }
  const stampRole = userHasWorkflowRole(assignments, user.id, needRole) ? workflowRoleLabel(needRole) : "Admin";

  // Proof is mandatory to reach "Warehouse received".
  const proofDocs = (opts?.proof ?? [])
    .filter((d) => d && typeof d.path === "string" && typeof d.name === "string")
    .map((d) => ({ path: d.path, name: d.name, uploadedAt: d.uploadedAt ?? new Date().toISOString() }));
  if (next.requiresProof && proofDocs.length === 0 && !(entry.proof && entry.proof.length > 0)) {
    throw new Error("Attach proof that the item was replaced before marking it received.");
  }

  const now = new Date().toISOString();
  entry.stage = next.key;
  entry.stamps = { ...entry.stamps, [next.key]: { byName: user.name, role: stampRole, at: now } };
  if (proofDocs.length) entry.proof = [...(entry.proof ?? []), ...proofDocs];
  const note = opts?.note?.trim();
  if (next.key === "approved") {
    entry.resolvedByName = user.name;
    entry.resolvedRole = stampRole;
    entry.resolvedAt = now;
    if (note) entry.resolutionNote = note;
  }

  await prisma.purchaseRequest.update({ where: { id: purchaseRequestId }, data: { returns: list as unknown as Prisma.InputJsonValue } });
  await logActivity(user, {
    action: "order.purchase.return.advance",
    category: "order",
    summary: `Supplier return — ${next.label}${pr.quotationId ? ` — ${await orderRefLabel(pr.quotationId)}` : ""}`,
    entity: "order",
    entityId: pr.quotationId ?? purchaseRequestId,
    href: pr.quotationId ? `/orders/${pr.quotationId}` : "/purchasing",
  });
  if (pr.quotationId) revalidatePath(`/orders/${pr.quotationId}`);
  revalidatePath("/purchasing");
  revalidatePath("/requisitions");
  revalidatePath("/my-dashboard");
  revalidatePath("/management");
}

// --- Voucher reconciliation -------------------------------------------------

/**
 * Record the per-line actual spend + receipts against the issued voucher. The
 * purchaser enters the actual amount paid for each PO line and attaches the
 * receipts (uploaded to /api/purchase-uploads); the system tallies each line
 * and the total against the PO automatically. VAT mode ("inclusive" |
 * "exclusive") decides whether 12% VAT is added on top of the PO amounts.
 */
export async function recordReconciliation(
  purchaseRequestId: string,
  input: {
    vatMode: "inclusive" | "exclusive";
    lines: { description: string; qty?: string; poAmount: number; actualAmount: number }[];
    receipts?: { path: string; name: string; uploadedAt?: string }[];
    note?: string;
    aiVerified?: boolean;
  },
): Promise<void> {
  const user = await getCurrentUser();
  if (!user) throw new Error("Unauthorized");
  const admin = isAdmin(user);
  const assignments = await getWorkflowRoles();
  // The purchaser/accounting record it; the payment approver may also edit
  // figures when authorising a discrepancy.
  const recRole = (["purchaser", "accounting", "payment_approver"] as WorkflowRoleKey[]).find((r) => userHasWorkflowRole(assignments, user.id, r));
  if (!(admin || recRole)) {
    throw new Error("Only the Purchaser, Accounting, the Approver or an admin can reconcile a voucher.");
  }
  const lines = (input.lines ?? [])
    .map((l) => ({
      description: String(l.description ?? ""),
      qty: String(l.qty ?? ""),
      poAmount: Number(l.poAmount) || 0,
      actualAmount: Number(l.actualAmount) || 0,
    }));
  if (lines.length === 0) throw new Error("Nothing to reconcile — the PO has no lines.");

  const pr = await prisma.purchaseRequest.findUnique({ where: { id: purchaseRequestId } });
  if (!pr) throw new Error("Purchase request not found");
  if (!canReconcileAt(pr.status as PRStatus)) throw new Error("A voucher can only be reconciled once the materials have been purchased.");

  const cur = coerceReconciliation(pr.reconciliation);
  const receipts = (input.receipts ?? [])
    .filter((d) => d && typeof d.path === "string" && typeof d.name === "string")
    .map((d) => ({ path: d.path, name: d.name, uploadedAt: d.uploadedAt ?? new Date().toISOString() }));

  const next = {
    ...cur,
    vatMode: input.vatMode === "exclusive" ? "exclusive" : "inclusive",
    lines,
    receipts: receipts.length ? receipts : cur.receipts,
    recordedByName: user.name,
    recordedRole: recRole ? workflowRoleLabel(recRole) : "Admin",
    recordedAt: new Date().toISOString(),
    // Only the AI receipt-read path may claim the figures came from the uploaded
    // receipt; a manual record is figures-vs-PO only, never receipt-verified.
    aiVerified: input.aiVerified === true,
    note: input.note?.trim() || undefined,
  };
  await prisma.purchaseRequest.update({ where: { id: purchaseRequestId }, data: { reconciliation: next as unknown as Prisma.InputJsonValue } });
  if (pr.quotationId) revalidatePath(`/orders/${pr.quotationId}`);
  revalidatePath("/purchasing");
  revalidatePath("/requisitions");
}

/** Remove one uploaded reconciliation receipt by its storage path. Admin-only. */
export async function removeReconciliationReceipt(purchaseRequestId: string, path: string): Promise<void> {
  await assertUploadAdmin();
  const pr = await prisma.purchaseRequest.findUnique({ where: { id: purchaseRequestId } });
  if (!pr) throw new Error("Purchase request not found");
  const cur = coerceReconciliation(pr.reconciliation);
  const next = { ...cur, receipts: (cur.receipts ?? []).filter((d) => d.path !== path) };
  await prisma.purchaseRequest.update({ where: { id: purchaseRequestId }, data: { reconciliation: next as unknown as Prisma.InputJsonValue } });
  if (pr.quotationId) revalidatePath(`/orders/${pr.quotationId}`);
  revalidatePath("/purchasing");
  revalidatePath("/requisitions");
}

/** Append a receipt to a recorded reconciliation. Admin-only. */
export async function addReconciliationReceipt(purchaseRequestId: string, doc: { path: string; name: string; uploadedAt?: string }): Promise<void> {
  await assertUploadAdmin();
  if (!doc || typeof doc.path !== "string" || typeof doc.name !== "string") throw new Error("Invalid file.");
  const pr = await prisma.purchaseRequest.findUnique({ where: { id: purchaseRequestId } });
  if (!pr) throw new Error("Purchase request not found");
  const cur = coerceReconciliation(pr.reconciliation);
  const clean = { path: doc.path, name: doc.name, uploadedAt: doc.uploadedAt ?? new Date().toISOString() };
  const next = { ...cur, receipts: [...(cur.receipts ?? []), clean] };
  await prisma.purchaseRequest.update({ where: { id: purchaseRequestId }, data: { reconciliation: next as unknown as Prisma.InputJsonValue } });
  if (pr.quotationId) revalidatePath(`/orders/${pr.quotationId}`);
  revalidatePath("/purchasing");
  revalidatePath("/requisitions");
}

/** Replace one reconciliation receipt (by path) with a newly-uploaded one. Admin-only. */
export async function replaceReconciliationReceipt(purchaseRequestId: string, oldPath: string, doc: { path: string; name: string; uploadedAt?: string }): Promise<void> {
  await assertUploadAdmin();
  if (!doc || typeof doc.path !== "string" || typeof doc.name !== "string") throw new Error("Invalid file.");
  const pr = await prisma.purchaseRequest.findUnique({ where: { id: purchaseRequestId } });
  if (!pr) throw new Error("Purchase request not found");
  const cur = coerceReconciliation(pr.reconciliation);
  const clean = { path: doc.path, name: doc.name, uploadedAt: doc.uploadedAt ?? new Date().toISOString() };
  const receipts = (cur.receipts ?? []).map((d) => (d.path === oldPath ? clean : d));
  const next = { ...cur, receipts };
  await prisma.purchaseRequest.update({ where: { id: purchaseRequestId }, data: { reconciliation: next as unknown as Prisma.InputJsonValue } });
  if (pr.quotationId) revalidatePath(`/orders/${pr.quotationId}`);
  revalidatePath("/purchasing");
  revalidatePath("/requisitions");
}

/** Remove a resolved supplier-return's replacement proof. Admin-only. */
export async function removePurchaseReturnProof(purchaseRequestId: string, returnId: string, path: string): Promise<void> {
  await assertUploadAdmin();
  const pr = await prisma.purchaseRequest.findUnique({ where: { id: purchaseRequestId } });
  if (!pr) throw new Error("Purchase request not found");
  const list = coercePurchaseReturns(pr.returns);
  const entry = list.find((r) => r.id === returnId);
  if (!entry) throw new Error("Return not found.");
  entry.proof = (entry.proof ?? []).filter((d) => d.path !== path);
  await prisma.purchaseRequest.update({ where: { id: purchaseRequestId }, data: { returns: list as unknown as Prisma.InputJsonValue } });
  if (pr.quotationId) revalidatePath(`/orders/${pr.quotationId}`);
  revalidatePath("/purchasing");
  revalidatePath("/requisitions");
}

/** Remove a commission voucher document (unsigned "voucher" or "signed"). Admin-only. */
export async function removeCommissionVoucher(quotationId: string, which: "voucher" | "signed"): Promise<void> {
  await assertUploadAdmin();
  const { cls, wf } = await loadWorkflow(quotationId);
  if (!wf.commission) throw new Error("No commission record.");
  const commission = { ...(wf.commission as Record<string, unknown>) };
  delete commission[which === "voucher" ? "voucherDoc" : "signedVoucherDoc"];
  await saveWorkflow(quotationId, cls, { ...wf, commission });
  revalidatePath(`/orders/${quotationId}`);
}

/** Remove the proof attached to a multi-batch delivery payment. Admin-only. */
export async function removeMultiBatchProof(quotationId: string, paymentId: string): Promise<void> {
  await assertUploadAdmin();
  const quote = await prisma.quotation.findUnique({ where: { id: quotationId }, select: { classification: true } });
  if (!quote) throw new Error("Order not found");
  const cls = (quote.classification as Record<string, unknown>) ?? {};
  const sale = saleFromClassification(cls);
  if (!sale) throw new Error("No sale record.");
  const payments = (sale.payments ?? []).map((p: SalePayment) => (p.id === paymentId ? { ...p, proof: null } : p));
  await prisma.quotation.update({
    where: { id: quotationId },
    data: { classification: { ...cls, sale: { ...sale, payments } } as unknown as Prisma.InputJsonObject },
  });
  revalidatePath(`/orders/${quotationId}`);
  revalidatePath(`/quotations/${quotationId}`);
}

/**
 * Accounting escalates a discrepancy (a reconciliation that doesn't balance) to
 * the admin / payment approver for authorisation.
 */
export async function escalateReconciliation(purchaseRequestId: string, note?: string): Promise<void> {
  const user = await getCurrentUser();
  if (!user) throw new Error("Unauthorized");
  const admin = isAdmin(user);
  const assignments = await getWorkflowRoles();
  const role = (["accounting", "purchaser"] as WorkflowRoleKey[]).find((r) => userHasWorkflowRole(assignments, user.id, r));
  if (!(admin || role)) throw new Error("Only Accounting, the Purchaser or an admin can escalate a discrepancy.");
  const pr = await prisma.purchaseRequest.findUnique({ where: { id: purchaseRequestId } });
  if (!pr) throw new Error("Purchase request not found");
  const cur = coerceReconciliation(pr.reconciliation);
  if (!isReconciled(cur)) throw new Error("Record the actual spend first.");
  const next = {
    ...cur,
    escalation: { byName: user.name, role: role ? workflowRoleLabel(role) : "Admin", at: new Date().toISOString(), note: note?.trim() || undefined },
  };
  await prisma.purchaseRequest.update({ where: { id: purchaseRequestId }, data: { reconciliation: next as unknown as Prisma.InputJsonValue } });
  if (pr.quotationId) revalidatePath(`/orders/${pr.quotationId}`);
  revalidatePath("/purchasing");
  revalidatePath("/requisitions");
}

/**
 * The payment approver (or an admin) authorises a discrepancy — the approver has
 * the authority to approve it as-is (or edit the figures first via
 * recordReconciliation, then approve).
 */
export async function approveReconciliation(purchaseRequestId: string, note?: string): Promise<void> {
  const user = await getCurrentUser();
  if (!user) throw new Error("Unauthorized");
  const admin = isAdmin(user);
  const assignments = await getWorkflowRoles();
  const isApprover = userHasWorkflowRole(assignments, user.id, "payment_approver");
  if (!(admin || isApprover)) throw new Error("Only the Payment Approver or an admin can approve a discrepancy.");
  const pr = await prisma.purchaseRequest.findUnique({ where: { id: purchaseRequestId } });
  if (!pr) throw new Error("Purchase request not found");
  const cur = coerceReconciliation(pr.reconciliation);
  if (!isReconciled(cur)) throw new Error("Record the actual spend first.");
  const next = {
    ...cur,
    approval: { byName: user.name, role: isApprover ? workflowRoleLabel("payment_approver") : "Admin", at: new Date().toISOString(), note: note?.trim() || undefined },
  };
  await prisma.purchaseRequest.update({ where: { id: purchaseRequestId }, data: { reconciliation: next as unknown as Prisma.InputJsonValue } });
  if (pr.quotationId) revalidatePath(`/orders/${pr.quotationId}`);
  revalidatePath("/purchasing");
  revalidatePath("/requisitions");
}

/** Confirm the reconciliation is settled — change returned / overspend reimbursed. */
export async function settleReconciliation(purchaseRequestId: string, note?: string): Promise<void> {
  const user = await getCurrentUser();
  if (!user) throw new Error("Unauthorized");
  const admin = isAdmin(user);
  if (!(admin || (await userHasAnyRole(user.id, ["accounting", "purchaser"])))) {
    throw new Error("Only Accounting, the Purchaser or an admin can settle a reconciliation.");
  }
  const pr = await prisma.purchaseRequest.findUnique({ where: { id: purchaseRequestId } });
  if (!pr) throw new Error("Purchase request not found");
  const cur = coerceReconciliation(pr.reconciliation);
  if (!isReconciled(cur)) throw new Error("Record the actual spend first.");
  const assignments = await getWorkflowRoles();
  const settleRole = (["accounting", "purchaser"] as WorkflowRoleKey[]).find((r) => userHasWorkflowRole(assignments, user.id, r));
  const next = {
    ...cur,
    settled: { byName: user.name, role: settleRole ? workflowRoleLabel(settleRole) : admin ? "Admin" : "", at: new Date().toISOString(), note: note?.trim() || undefined },
  };
  await prisma.purchaseRequest.update({ where: { id: purchaseRequestId }, data: { reconciliation: next as unknown as Prisma.InputJsonValue } });
  if (pr.quotationId) revalidatePath(`/orders/${pr.quotationId}`);
  revalidatePath("/purchasing");
  revalidatePath("/requisitions");
}

/**
 * Admin-only override: roll a purchase request back to an earlier stage in the
 * chain. Sign-offs recorded after the target stage are cleared (the stamp
 * columns and the chainLog entries), so the chain can be walked forward again.
 */
export async function adminRollbackPurchase(purchaseRequestId: string, toStatus: string): Promise<void> {
  const user = await getCurrentUser();
  if (!user || !isAdmin(user)) throw new Error("Only an admin can roll back the workflow.");
  const target = toStatus as PRStatus;
  if (!PR_MAIN_ORDER.includes(target)) throw new Error("Choose a valid earlier stage.");

  const pr = await prisma.purchaseRequest.findUnique({ where: { id: purchaseRequestId } });
  if (!pr) throw new Error("Purchase request not found");
  if (!priorPurchaseStatuses(pr.status as PRStatus).includes(target)) {
    throw new Error("Choose an earlier stage to roll back to.");
  }
  const tgtIdx = prMainIndex(target);

  const data: Prisma.PurchaseRequestUpdateInput = { status: target };
  const log = (pr.chainLog && typeof pr.chainLog === "object" ? { ...(pr.chainLog as Record<string, unknown>) } : {}) as Record<string, unknown>;
  // Undo every transition that lands at (or after) the target — clear its stamp.
  for (const step of PURCHASE_STEPS) {
    if (step.key === "reject" || step.key === "reject_po") continue;
    if (prMainIndex(step.from) < tgtIdx) continue;
    switch (step.key) {
      case "approve": data.decidedById = null; data.decidedByName = null; data.decidedAt = null; data.decisionNote = null; break;
      case "voucher": data.voucherByName = null; data.voucherAt = null; data.voucherRef = null; break;
      case "buy": data.purchasedByName = null; data.purchasedAt = null; break;
      case "check": data.checkedByName = null; data.checkedAt = null; break;
      case "plant": data.plantApprovedByName = null; data.plantApprovedAt = null; break;
      case "receive": data.receivedByName = null; data.receivedAt = null; break;
      default: delete log[step.key]; break; // sign / release_cash / hand_purchaser / … (chainLog)
    }
  }
  data.chainLog = log as Prisma.InputJsonValue;
  await prisma.purchaseRequest.update({ where: { id: purchaseRequestId }, data });
  if (pr.quotationId) revalidatePath(`/orders/${pr.quotationId}`);
  revalidatePath("/purchasing");
  revalidatePath("/requisitions");
}

/**
 * When the AI receipt-read limit is reached, Accounting/the Purchaser informs
 * the admin/approver so they can allow more reads (or the figures go in by hand).
 */
export async function escalateReconcileAiRead(purchaseRequestId: string, note?: string): Promise<void> {
  const user = await getCurrentUser();
  if (!user) throw new Error("Unauthorized");
  const admin = isAdmin(user);
  const assignments = await getWorkflowRoles();
  const role = (["accounting", "purchaser"] as WorkflowRoleKey[]).find((r) => userHasWorkflowRole(assignments, user.id, r));
  if (!(admin || role)) throw new Error("Only Accounting, the Purchaser or an admin can do this.");
  const pr = await prisma.purchaseRequest.findUnique({ where: { id: purchaseRequestId } });
  if (!pr) throw new Error("Purchase request not found");
  const cur = coerceReconciliation(pr.reconciliation);
  const next = {
    ...cur,
    aiReadEscalation: { byName: user.name, role: role ? workflowRoleLabel(role) : "Admin", at: new Date().toISOString(), note: note?.trim() || undefined },
  };
  await prisma.purchaseRequest.update({ where: { id: purchaseRequestId }, data: { reconciliation: next as unknown as Prisma.InputJsonValue } });
  if (pr.quotationId) revalidatePath(`/orders/${pr.quotationId}`);
  revalidatePath("/purchasing");
  revalidatePath("/requisitions");
}

/**
 * The admin/approver bypasses the AI receipt-read limit — resets the count so
 * another set of AI reads is allowed (and clears the escalation notice).
 */
export async function resetReconcileAiRead(purchaseRequestId: string): Promise<void> {
  const user = await getCurrentUser();
  if (!user) throw new Error("Unauthorized");
  const admin = isAdmin(user);
  const isApprover = userHasWorkflowRole(await getWorkflowRoles(), user.id, "payment_approver");
  if (!(admin || isApprover)) throw new Error("Only the Payment Approver or an admin can bypass the AI-read limit.");
  const pr = await prisma.purchaseRequest.findUnique({ where: { id: purchaseRequestId } });
  if (!pr) throw new Error("Purchase request not found");
  const cur = coerceReconciliation(pr.reconciliation);
  const next = { ...cur, aiReadCount: 0, aiReadEscalation: undefined };
  await prisma.purchaseRequest.update({ where: { id: purchaseRequestId }, data: { reconciliation: next as unknown as Prisma.InputJsonValue } });
  if (pr.quotationId) revalidatePath(`/orders/${pr.quotationId}`);
  revalidatePath("/purchasing");
  revalidatePath("/requisitions");
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

/** Delete a purchase request / PO (single or the whole combined PO). Admin only. */
export async function deletePurchaseRequest(purchaseRequestId: string): Promise<void> {
  const user = await getCurrentUser();
  if (!user) throw new Error("Unauthorized");
  if (!isAdmin(user)) throw new Error("Only an admin can delete a purchase order.");
  const pr = await prisma.purchaseRequest.findUnique({ where: { id: purchaseRequestId } });
  if (!pr) throw new Error("Purchase request not found");
  const ids = poMemberIds(pr.po);
  const targetIds = ids.length ? ids : [pr.id];
  const members = await prisma.purchaseRequest.findMany({ where: { id: { in: targetIds } } });
  await prisma.purchaseRequest.deleteMany({ where: { id: { in: targetIds } } });
  for (const qid of [...new Set(members.map((m) => m.quotationId).filter((q): q is string => !!q))]) {
    revalidatePath(`/orders/${qid}`);
  }
  revalidatePath("/purchasing");
}

/**
 * Admin: replace a purchase request's item lines (and note). Works on any
 * status/tab. Note: this edits the request lines only — a Purchase Order that
 * was already issued keeps its own priced lines (edit those in the PO editor).
 */
export async function adminEditPurchaseRequestItems(purchaseRequestId: string, items: string[], note?: string): Promise<void> {
  const user = await getCurrentUser();
  if (!user) throw new Error("Unauthorized");
  if (!isAdmin(user)) throw new Error("Only an admin can edit a request.");
  const pr = await prisma.purchaseRequest.findUnique({ where: { id: purchaseRequestId } });
  if (!pr) throw new Error("Purchase request not found");
  const clean = (items ?? []).map((s) => s.trim()).filter(Boolean);
  if (clean.length === 0) throw new Error("List at least one item.");
  await prisma.purchaseRequest.update({
    where: { id: purchaseRequestId },
    data: { items: clean as Prisma.InputJsonValue, ...(note !== undefined ? { note: note.trim() || null } : {}) },
  });
  if (pr.quotationId) revalidatePath(`/orders/${pr.quotationId}`);
  revalidatePath("/purchasing");
  revalidatePath("/requisitions");
}

/** Admin: add a replenishment (stock top-up) request from the Purchasing workspace. */
export async function adminCreateReplenishment(stockItemId: string, qty: number, note?: string): Promise<void> {
  const user = await getCurrentUser();
  if (!user) throw new Error("Unauthorized");
  if (!isAdmin(user)) throw new Error("Only an admin can add a replenishment.");
  const item = await prisma.stockItem.findUnique({ where: { id: stockItemId } });
  if (!item) throw new Error("Pick a stock item.");
  if (!(qty > 0)) throw new Error("Enter a quantity greater than zero.");
  await prisma.purchaseRequest.create({
    data: {
      quotationId: null,
      kind: "replenishment",
      stockItemId: item.id,
      dept: null,
      items: [`${item.name} — ${qty} ${item.unit}`.trim()],
      note: note?.trim() || null,
      createdById: user.id,
      createdByName: user.name,
      status: "PENDING_APPROVAL",
    },
  });
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
  ewtMode: z.enum(["percent", "amount"]).default("percent"),
  ewtAmount: z.number().min(0).default(0),
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
  // Once the purchase order is approved, only an admin may edit it.
  if (isPoApproved(pr.chainLog) && !isAdmin(user)) {
    throw new Error("This purchase order is approved — only an admin can edit it.");
  }
  // A material/department requisition needs the Plant Manager's approval (step 16)
  // before the Purchaser prepares the purchase order (step 17).
  if (pr.status === "PENDING_APPROVAL" && isDeptRequisition(pr)) {
    throw new Error("The Plant Manager must approve this material request before a purchase order can be created.");
  }

  const lines = d.lines.filter((l) => l.description.trim() !== "");
  if (lines.length === 0) throw new Error("Add at least one line to the purchase order.");

  const existing = coercePurchaseOrder(pr.po);
  const po: PurchaseOrder = {
    poNumber: existing?.poNumber ?? (await nextPoNo()),
    date: d.date || new Date().toISOString(),
    supplier: d.supplier,
    lines,
    ewtPct: d.ewtPct,
    ewtMode: d.ewtMode,
    ewtAmount: d.ewtAmount,
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

/**
 * Split a requisition whose items span more than one supplier: move the selected
 * lines into a NEW sibling requisition (same order, department, note & approval
 * state) so it gets its own Purchase Order from the other supplier. The original
 * keeps the remaining lines (and its existing PO, if any). Each requisition then
 * runs the normal one-PO chain independently. Purchaser/admin only.
 */
export async function splitPurchaseRequest(purchaseRequestId: string, moveItems: string[]): Promise<void> {
  const user = await getCurrentUser();
  if (!user) throw new Error("Unauthorized");
  if (!(isAdmin(user) || userHasWorkflowRole(await getWorkflowRoles(), user.id, "purchaser" as WorkflowRoleKey))) {
    throw new Error("Only the Purchaser or an admin can split a requisition.");
  }
  const pr = await prisma.purchaseRequest.findUnique({ where: { id: purchaseRequestId } });
  if (!pr) throw new Error("Purchase request not found");
  // Only while still in approval / PO preparation — once the voucher / cash /
  // purchase steps have run, the chain is committed and can't be re-split.
  if (pr.status !== "PENDING_APPROVAL" && pr.status !== "APPROVED") {
    throw new Error("This requisition has progressed past PO preparation — it can no longer be split.");
  }
  if (poBatchId(pr.po)) throw new Error("This requisition is part of a combined PO and can't be split.");

  const items = Array.isArray(pr.items) ? (pr.items as string[]) : [];
  const move = moveItems.map((s) => s.trim()).filter(Boolean);
  if (move.length === 0) throw new Error("Select at least one line to split off.");

  // Remove each moved line from the original by first match (so duplicate lines
  // split one at a time), verifying every selected line still exists.
  const remaining = [...items];
  for (const m of move) {
    const idx = remaining.findIndex((it) => it === m);
    if (idx < 0) throw new Error("A selected line isn't on this requisition anymore — refresh and try again.");
    remaining.splice(idx, 1);
  }
  if (remaining.length === 0) {
    throw new Error("Keep at least one line on the original requisition — to change every line's supplier, edit the PO instead.");
  }

  // Never move a line that's already on the original's Purchase Order — that would
  // orphan the PO. Those lines must stay; split only the other-supplier lines.
  const existingPo = coercePurchaseOrder(pr.po);
  if (existingPo) {
    const norm = (s: string) => s.trim().toLowerCase();
    const poDescs = new Set(existingPo.lines.map((l) => norm(l.description)));
    if (move.some((m) => poDescs.has(norm(poLineFromPRItem(m).description)))) {
      throw new Error("A selected line is already on this requisition's Purchase Order — split only the lines meant for the other supplier.");
    }
  }

  await prisma.$transaction(async (tx) => {
    await tx.purchaseRequest.create({
      data: {
        kind: pr.kind,
        dept: pr.dept,
        quotationId: pr.quotationId,
        mrfId: pr.mrfId,
        stockItemId: pr.stockItemId,
        items: move as Prisma.InputJsonValue,
        note: pr.note ? `${pr.note} (split)` : "Split from a multi-supplier requisition",
        createdById: pr.createdById,
        createdByName: pr.createdByName,
        status: pr.status, // same approval level; starts with no PO of its own
      },
    });
    await tx.purchaseRequest.update({
      where: { id: purchaseRequestId },
      data: { items: remaining as Prisma.InputJsonValue },
    });
  });

  await logActivity(user, {
    action: "purchase.split",
    category: "purchase",
    summary: `Split requisition — moved ${move.length} line${move.length > 1 ? "s" : ""} to a new supplier PO`,
    entity: "purchase",
    entityId: purchaseRequestId,
    href: pr.quotationId ? `/orders/${pr.quotationId}` : "/purchasing",
  });
  revalidatePath("/purchasing");
  revalidatePath("/requisitions");
  if (pr.quotationId) revalidatePath(`/orders/${pr.quotationId}`);
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
    // Material/department requisitions need the Plant Manager's approval first.
    if (isDeptRequisition(pr)) throw new Error("A material requisition must be approved by the Plant Manager before its purchase order can be prepared.");
  }

  const poNumber = await nextPoNo();
  const now = new Date().toISOString();
  const po = {
    poNumber,
    date: d.date || now,
    supplier: d.supplier,
    lines,
    ewtPct: d.ewtPct,
    ewtMode: d.ewtMode,
    ewtAmount: d.ewtAmount,
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
  // Once the purchase order is approved, only an admin may edit it.
  if (isPoApproved(anchor.chainLog) && !isAdmin(user)) {
    throw new Error("This purchase order is approved — only an admin can edit it.");
  }
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
    ewtMode: d.ewtMode,
    ewtAmount: d.ewtAmount,
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
  const anchor = await prisma.purchaseRequest.findUnique({ where: { id: anchorPurchaseRequestId } });
  if (!anchor) throw new Error("Purchase request not found");
  // Department / material requisitions are approved/rejected by the Plant Manager (step 16).
  const stepRole = effectiveStepRole(step, isDeptRequisition(anchor));
  if (!(isAdmin(user) || userHasWorkflowRole(await getWorkflowRoles(), user.id, stepRole))) {
    throw new Error(`Only ${workflowRoleLabel(stepRole)} or an admin can do this.`);
  }
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
    case "sign":
    case "release_cash":
    case "hand_purchaser":
    case "confirm_cash":
    case "assign_tasks":
    case "logistics_confirm":
    case "deliver":
    case "warehouse_approve": {
      const log = (anchor.chainLog && typeof anchor.chainLog === "object" ? anchor.chainLog : {}) as Record<string, unknown>;
      data.chainLog = { ...log, [stepKey]: { byName: user.name, at: now.toISOString() } } as Prisma.InputJsonValue;
      break;
    }
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
  if (members.some((m) => m.status !== "PLANT_APPROVED")) throw new Error("This purchase isn't ready to receive (awaiting Plant Manager's final approval).");
  // Good items are received now; disapproved items stay open as supplier returns
  // and are tracked until their replacement arrives.

  const clean = (matches ?? []).filter((m) => m.stockItemId && Number(m.qty) > 0);
  await prisma.$transaction(async (tx) => {
    for (const m of clean) {
      await applyStockChange(tx, { stockItemId: m.stockItemId, kind: "RECEIPT", qty: Number(m.qty), reason: "Purchase received (combined PO)" }, user.name);
    }
    for (const id of ids) {
      await tx.purchaseRequest.update({ where: { id }, data: { status: "COMPLETED", receivedByName: user.name, receivedAt: new Date() } });
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

// --- Multiple-batch delivery (separate from the single-batch Phase 5 flow) ---

const mbCreateSchema = z.object({
  drNumber: z.string().optional(),
  lines: z.array(z.object({ description: z.string(), qty: z.coerce.number() })),
});
const mbStepSchema = z.object({
  note: z.string().optional(),
  payment: z.coerce.number().optional(),
  paymentNote: z.string().optional(),
  // Proof of the collected payment (uploaded via /api/sale-uploads).
  paymentProof: z.object({ path: z.string(), name: z.string(), uploadedAt: z.string() }).nullish(),
});

/** Sales (the order's preparer) or an admin. */
async function canManageMultiDelivery(userId: string, preparedById: string | null): Promise<boolean> {
  const user = await getCurrentUser();
  if (!user || user.id !== userId) return false;
  return isAdmin(user) || userId === preparedById;
}
function orderedMap(items: { qty: number; descriptionSnapshot: string }[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const it of items) {
    const k = it.descriptionSnapshot.trim().toLowerCase();
    m.set(k, (m.get(k) ?? 0) + it.qty);
  }
  return m;
}

/** Switch the order to multiple-batch delivery (only at production_finished, before
 *  the single-batch flow has started). Sales or admin. */
/** Engineer / Payment Approver / admin may enable the batch-delivery option. */
async function canEnableBatchDelivery(user: { id: string; role: string } | null): Promise<boolean> {
  if (!user) return false;
  if (isAdmin(user as Parameters<typeof isAdmin>[0])) return true;
  if (user.role === "ENGINEER") return true;
  const roles = await getWorkflowRoles();
  return userHasWorkflowRole(roles, user.id, "payment_approver" as WorkflowRoleKey);
}

/**
 * Turn the "Deliver in multiple batches?" option on/off for an order. Restricted
 * to Engineers, the Payment Approver and admins. Enabling it makes the entry
 * panel appear (once production has started); the actual single→multi switch is
 * still a deliberate action. Can't be turned off after the order is already
 * being delivered in batches.
 */
export async function setBatchDeliveryEnabled(quotationId: string, enabled: boolean): Promise<void> {
  const user = await getCurrentUser();
  if (!user) throw new Error("Unauthorized");
  if (!(await canEnableBatchDelivery(user))) {
    throw new Error("Only an Engineer, the Payment Approver or an admin can enable batch delivery.");
  }
  const { cls, wf } = await loadWorkflow(quotationId);
  if (!enabled) {
    // Turning off also returns the order to the single-delivery flow. Block it
    // only when batches have actually been opened (cancel those first).
    if (wf.deliveryBatches.some((b) => !b.cancelled)) {
      throw new Error("Cancel the open delivery batches first before turning off batch delivery.");
    }
    await saveWorkflow(quotationId, cls, { ...wf, batchDeliveryEnabled: false, deliveryMode: undefined });
    return;
  }
  await saveWorkflow(quotationId, cls, { ...wf, batchDeliveryEnabled: true });
}

/**
 * Mark an order as "Office pick up" (client collects at the office) instead of a
 * delivery. Set by the order's salesperson or an admin. Step 1: this only
 * persists the flag so it can be shown as a tag — it does not yet change the
 * Phase 5 delivery steps (that wiring is a separate, owner-approved change).
 */
export async function setOfficePickup(quotationId: string, enabled: boolean): Promise<void> {
  const user = await getCurrentUser();
  if (!user) throw new Error("Unauthorized");
  const { quote, cls, wf } = await loadWorkflow(quotationId);
  if (!(await canManageMultiDelivery(user.id, quote.preparedById))) {
    throw new Error("Only the order's salesperson or an admin can set office pick up.");
  }
  // Office pickup is a from-stock fulfilment (no production) — only allow it on
  // orders whose goods are all in stock.
  if (enabled) {
    const items = await prisma.quotationItem.findMany({
      where: { quotationId },
      select: { qty: true, descriptionSnapshot: true, specsSnapshot: true },
    });
    if (!isStockOnlyOrder(items)) {
      throw new Error("Office pick up is only available for from-stock orders.");
    }
  }
  // Source of truth is `fulfillmentMode`; `officePickup` is derived on read.
  await saveWorkflow(quotationId, cls, { ...wf, fulfillmentMode: enabled ? "office_pickup" : "delivery" });
}

/**
 * Set the order's fulfilment/handover mode (delivery / office pick up / plant pick
 * up) — the 3-way selector on the Phase 2 card. Availability depends on the order's
 * contents: office pick up = from-stock only; plant pick up = goods at the plant
 * (produced or from-stock, never bought-in-only). An admin can change it any time; a
 * non-admin (salesperson) can only change it before the order leaves Phase 2.
 */
export async function setFulfillmentMode(quotationId: string, mode: FulfillmentMode): Promise<void> {
  const user = await getCurrentUser();
  if (!user) throw new Error("Unauthorized");
  if (mode !== "delivery" && mode !== "office_pickup" && mode !== "plant_pickup") {
    throw new Error("Unknown fulfilment mode.");
  }
  const { quote, cls, wf } = await loadWorkflow(quotationId);
  if (!(await canManageMultiDelivery(user.id, quote.preparedById))) {
    throw new Error("Only the order's salesperson or an admin can set the fulfilment mode.");
  }
  if (!isAdmin(user) && stageIndex(wf.stage) > stageIndex("released")) {
    throw new Error("Only an admin can change the fulfilment mode once the order has left Phase 2.");
  }
  if (mode !== "delivery") {
    const items = await prisma.quotationItem.findMany({
      where: { quotationId },
      select: { qty: true, descriptionSnapshot: true, specsSnapshot: true },
    });
    if (mode === "office_pickup" && !isStockOnlyOrder(items)) {
      throw new Error("Office pick up is only available for from-stock orders.");
    }
    if (mode === "plant_pickup" && isBoughtInOnlyOrder(items)) {
      throw new Error("Plant pick up isn't available for bought-in orders.");
    }
  }
  await saveWorkflow(quotationId, cls, { ...wf, fulfillmentMode: mode });
}

export async function setMultiDelivery(quotationId: string): Promise<void> {
  const user = await getCurrentUser();
  if (!user) throw new Error("Unauthorized");
  const { quote, cls, wf } = await loadWorkflow(quotationId);
  if (!((await canManageMultiDelivery(user.id, quote.preparedById)) || (await canEnableBatchDelivery(user)))) {
    throw new Error("Only Sales, an Engineer, the Payment Approver or an admin can choose multiple-batch delivery.");
  }
  // Batch delivery must be enabled first (Engineer / Payment Approver / admin).
  if (!wf.batchDeliveryEnabled) {
    throw new Error("Enable batch delivery first before switching this order to multiple batches.");
  }
  // Available from when production starts (producing) up until just before the
  // order is actually delivered — so it can still be switched to batches after
  // the single-delivery flow (final payment / QA / delivery docs) has begun. Any
  // collected payment carries over; the batch flow drives the order to close from
  // whatever stage it's at. Blocked once the order is delivered/closed.
  if (!(stageIndex(wf.stage) >= stageIndex("producing") && stageIndex(wf.stage) < stageIndex("delivered"))) {
    throw new Error("Multiple-batch delivery can be chosen from when production starts until just before the order is delivered.");
  }
  await saveWorkflow(quotationId, cls, { ...wf, deliveryMode: "multi" });
}

/**
 * Pick up in multiple batches — a single toggle (client collects in several
 * batches). Works for office pick up and plant pick up. Turning it on enables
 * batch mode and switches the order to multi. An admin can turn it on and off any
 * time; a non-admin (the salesperson) can turn it ON but not OFF — once on, only an
 * admin can turn it off.
 */
export async function setMultiBatchPickup(quotationId: string, enabled: boolean): Promise<void> {
  const user = await getCurrentUser();
  if (!user) throw new Error("Unauthorized");
  const { quote, cls, wf } = await loadWorkflow(quotationId);
  if (wf.fulfillmentMode === "delivery") throw new Error("A pick-up mode must be on to use multi-batch pick up.");
  if (enabled) {
    if (!(await canManageMultiDelivery(user.id, quote.preparedById))) {
      throw new Error("Only the order's salesperson or an admin can turn on multi-batch pick up.");
    }
    // Available from when the goods are released up until just before the order is
    // picked up / delivered.
    if (!(stageIndex(wf.stage) >= stageIndex("producing") && stageIndex(wf.stage) < stageIndex("delivered"))) {
      throw new Error("Multi-batch pick up can be chosen once the order reaches fulfilment, until just before it is picked up.");
    }
    await saveWorkflow(quotationId, cls, { ...wf, batchDeliveryEnabled: true, deliveryMode: "multi" });
    return;
  }
  // Turning off is admin-only, and only when no batch has been opened.
  if (!isAdmin(user)) throw new Error("Only an admin can turn off multi-batch pick up.");
  if (wf.deliveryBatches.some((b) => !b.cancelled)) {
    throw new Error("Cancel the open pick-up batches first before turning off multi-batch pick up.");
  }
  await saveWorkflow(quotationId, cls, { ...wf, deliveryMode: undefined, batchDeliveryEnabled: false });
}

/** Open a delivery batch from finished items (any items / partial quantities). */
export async function createMultiBatch(quotationId: string, input: z.infer<typeof mbCreateSchema>): Promise<void> {
  const user = await getCurrentUser();
  if (!user) throw new Error("Unauthorized");
  const quote = await prisma.quotation.findUnique({
    where: { id: quotationId },
    select: { classification: true, preparedById: true, items: { select: { qty: true, descriptionSnapshot: true } } },
  });
  if (!quote) throw new Error("Order not found");
  if (!(await canManageMultiDelivery(user.id, quote.preparedById))) throw new Error("Only Sales or an admin can open a delivery batch.");
  const d = mbCreateSchema.parse(input);
  const wf = readOrderWorkflow(quote.classification);
  const cls = (quote.classification as Record<string, unknown>) ?? {};
  if (wf.deliveryMode !== "multi") throw new Error("This order isn't in multiple-batch delivery mode.");

  const lines = d.lines
    .map((l) => ({ description: l.description.trim(), qty: Number.isFinite(l.qty) ? Math.max(0, Math.floor(l.qty)) : 0 }))
    .filter((l) => l.description && l.qty > 0);
  if (lines.length === 0) throw new Error("Add at least one item to the delivery batch.");

  const ordered = orderedMap(quote.items);
  const batched = mbBatchedByDescription(wf.deliveryBatches);
  for (const l of lines) {
    const k = l.description.toLowerCase();
    const ord = ordered.get(k);
    if (ord != null) {
      const available = ord - (batched.get(k) ?? 0);
      if (l.qty > available) throw new Error(`Only ${available} of "${l.description}" left to batch.`);
    }
  }

  const batch: MultiDeliveryBatch = {
    id: randomUUID(),
    createdAt: new Date().toISOString(),
    createdByName: user.name,
    drNumber: (d.drNumber ?? "").trim(),
    lines,
    steps: {},
  };
  await saveWorkflow(quotationId, cls, { ...wf, deliveryBatches: [...wf.deliveryBatches, batch] });
}

/** Advance a delivery batch by completing its next step (role-gated). */
/** Logistics (or an admin) attaches a proof-of-delivery file to a delivery batch. */
export async function saveMultiBatchPod(quotationId: string, batchId: string, doc: SaleDoc): Promise<void> {
  const user = await getCurrentUser();
  if (!user) throw new Error("Unauthorized");
  const roles = await getWorkflowRoles();
  const { quote, cls, wf } = await loadWorkflow(quotationId);
  // Who attaches the proof: Sales for office pickup, the Warehouseman for plant
  // pickup, Logistics for a delivery.
  const mode = wf.fulfillmentMode;
  const pickup = mode !== "delivery";
  const salesPickup = mode === "office_pickup" && (user.role === "SALES" || quote.preparedById === user.id);
  const warehousePlant = mode === "plant_pickup" && userHasWorkflowRole(roles, user.id, "warehouse" as WorkflowRoleKey);
  if (!(isAdmin(user) || salesPickup || warehousePlant || userHasWorkflowRole(roles, user.id, "logistics" as WorkflowRoleKey))) {
    throw new Error(pickup ? "Only the pick-up handler or an admin can attach the proof of pick up." : "Only Logistics or an admin can attach the proof of delivery.");
  }
  const batch = wf.deliveryBatches.find((b) => b.id === batchId);
  if (!batch || batch.cancelled) throw new Error("Delivery batch not found.");
  const entry: SaleDoc = { path: String(doc.path), name: String(doc.name || "file"), uploadedAt: doc.uploadedAt || new Date().toISOString() };
  const pod = [...(batch.pod ?? []), entry];
  const deliveryBatches = wf.deliveryBatches.map((b) => (b.id === batchId ? { ...b, pod } : b));
  await saveWorkflow(quotationId, cls, { ...wf, deliveryBatches });
}

/**
 * Remove a proof-of-delivery file from a delivery batch. Logistics may edit its
 * attachments up to the point of delivery; afterwards only an admin can.
 */
export async function removeMultiBatchPod(quotationId: string, batchId: string, path: string): Promise<void> {
  const user = await getCurrentUser();
  if (!user) throw new Error("Unauthorized");
  const roles = await getWorkflowRoles();
  const { quote, cls, wf } = await loadWorkflow(quotationId);
  const mode = wf.fulfillmentMode;
  const pickup = mode !== "delivery";
  const salesPickup = mode === "office_pickup" && (user.role === "SALES" || quote.preparedById === user.id);
  const warehousePlant = mode === "plant_pickup" && userHasWorkflowRole(roles, user.id, "warehouse" as WorkflowRoleKey);
  const isLogistics = userHasWorkflowRole(roles, user.id, "logistics" as WorkflowRoleKey);
  if (!(isAdmin(user) || salesPickup || warehousePlant || isLogistics)) throw new Error(pickup ? "Only an admin or the pick-up handler can remove the proof of pick up." : "Only an admin or Logistics can remove the proof of delivery.");
  const batch = wf.deliveryBatches.find((b) => b.id === batchId);
  if (!batch) throw new Error("Delivery batch not found.");
  if (batch.steps[MB_DELIVERED_STEP] && !isAdmin(user)) {
    throw new Error("Only an admin can edit the proof of delivery after the batch is delivered.");
  }
  const pod = (batch.pod ?? []).filter((d) => d.path !== path);
  const deliveryBatches = wf.deliveryBatches.map((b) => (b.id === batchId ? { ...b, pod } : b));
  await saveWorkflow(quotationId, cls, { ...wf, deliveryBatches });
}

/** Valid per-batch closing-document keys (Sales Invoice / OR-CR-AF / DR / 2307). */
const MB_DOC_KEYS = new Set(["sales_invoice", "or_cr_af", "delivery_receipt", "bir_2307", "delivery_form", "vat_zero_cert"]);

/** Accounting (or an admin / the Sales preparer) attaches a closing document to a batch. */
export async function saveMultiBatchDoc(quotationId: string, batchId: string, key: string, doc: SaleDoc): Promise<void> {
  const user = await getCurrentUser();
  if (!user) throw new Error("Unauthorized");
  if (!MB_DOC_KEYS.has(key)) throw new Error("Unknown document.");
  const roles = await getWorkflowRoles();
  const quote = await prisma.quotation.findUnique({ where: { id: quotationId }, select: { preparedById: true } });
  // Plant pick up: the Warehouseman makes the batch's delivery form / documents.
  const ok = isAdmin(user) || quote?.preparedById === user.id
    || userHasWorkflowRole(roles, user.id, "accounting" as WorkflowRoleKey)
    || userHasWorkflowRole(roles, user.id, "warehouse" as WorkflowRoleKey);
  if (!ok) throw new Error("Only Accounting, the Warehouseman, Sales or an admin can attach delivery documents.");
  const { cls, wf } = await loadWorkflow(quotationId);
  const batch = wf.deliveryBatches.find((b) => b.id === batchId);
  if (!batch || batch.cancelled) throw new Error("Delivery batch not found.");
  const entry: SaleDoc = { path: String(doc.path), name: String(doc.name || "file"), uploadedAt: doc.uploadedAt || new Date().toISOString() };
  const docs = { ...(batch.docs ?? {}), [key]: [...(batch.docs?.[key] ?? []), entry] };
  const deliveryBatches = wf.deliveryBatches.map((b) => (b.id === batchId ? { ...b, docs } : b));
  await saveWorkflow(quotationId, cls, { ...wf, deliveryBatches });
  revalidatePath(`/quotations/${quotationId}`);
}

/** Remove a closing document from a batch (Accounting / admin). */
export async function removeMultiBatchDoc(quotationId: string, batchId: string, key: string, path: string): Promise<void> {
  const user = await getCurrentUser();
  if (!user) throw new Error("Unauthorized");
  const roles = await getWorkflowRoles();
  if (!(isAdmin(user) || userHasWorkflowRole(roles, user.id, "accounting" as WorkflowRoleKey))) {
    throw new Error("Only Accounting or an admin can remove delivery documents.");
  }
  const { cls, wf } = await loadWorkflow(quotationId);
  const batch = wf.deliveryBatches.find((b) => b.id === batchId);
  if (!batch) throw new Error("Delivery batch not found.");
  const docs = { ...(batch.docs ?? {}), [key]: (batch.docs?.[key] ?? []).filter((d) => d.path !== path) };
  const deliveryBatches = wf.deliveryBatches.map((b) => (b.id === batchId ? { ...b, docs } : b));
  await saveWorkflow(quotationId, cls, { ...wf, deliveryBatches });
  revalidatePath(`/quotations/${quotationId}`);
}

export async function advanceMultiBatch(quotationId: string, batchId: string, stepKey: string, input: z.infer<typeof mbStepSchema>): Promise<void> {
  const user = await getCurrentUser();
  if (!user) throw new Error("Unauthorized");
  const quote = await prisma.quotation.findUnique({
    where: { id: quotationId },
    select: { classification: true, preparedById: true, vatMode: true, items: { select: { qty: true, descriptionSnapshot: true } } },
  });
  if (!quote) throw new Error("Order not found");
  const wf = readOrderWorkflow(quote.classification);
  const cls = (quote.classification as Record<string, unknown>) ?? {};

  const batch = wf.deliveryBatches.find((b) => b.id === batchId);
  if (!batch || batch.cancelled) throw new Error("Delivery batch not found.");
  // Each batch runs the step variant for the order's fulfilment mode (delivery /
  // office pick up / plant pick up).
  const stepDef = mbStepDef(stepKey, wf.fulfillmentMode);
  if (!stepDef) throw new Error("Unknown step.");
  const { next } = mbProgress(batch, wf.fulfillmentMode);
  if (!next || next.key !== stepKey) throw new Error("That step isn't the next one for this batch.");

  // Logistics must attach the proof of delivery before the batch can be delivered.
  if (stepKey === MB_DELIVERED_STEP && !(batch.pod && batch.pod.length > 0)) {
    throw new Error("Attach the proof of delivery before marking the batch delivered.");
  }
  // Accounting must attach this batch's own closing documents (Sales Invoice /
  // OR-CR-AF / Delivery Receipt / BIR 2307) before approving its delivery
  // documents. VAT-exclusive deals don't require the Sales Invoice or BIR 2307.
  if (stepKey === "delivery_docs") {
    const vatInclusive = quote.vatMode !== "EXCLUSIVE";
    const zeroRated = quote.vatMode === "ZERO_RATED";
    // Plant pick up: the delivery form is required; the Accounting closing docs
    // (SI / OR / DR) only for VAT-inclusive. Zero-rated also needs the VAT cert.
    const required = wf.fulfillmentMode === "plant_pickup"
      ? plantDocTypes(vatInclusive, zeroRated)
      : afterPaymentDocTypes(vatInclusive, zeroRated);
    const missing = required.filter((t) => (batch.docs?.[t.key]?.length ?? 0) === 0);
    if (missing.length) throw new Error(`Attach this batch's ${missing.map((t) => t.label).join(", ")} first.`);
  }

  const roles = await getWorkflowRoles();
  const allowed =
    isAdmin(user) ||
    (stepDef.role === "sales" ? quote.preparedById === user.id : userHasWorkflowRole(roles, user.id, stepDef.role as WorkflowRoleKey));
  if (!allowed) {
    const who = stepDef.role === "sales" ? "Sales" : workflowRoleLabel(stepDef.role);
    throw new Error(`Only ${who} or an admin can do this step.`);
  }
  const d = mbStepSchema.parse(input);

  // The "Payment checked" step records the batch's partial payment.
  let saleUpdate: Record<string, unknown> | null = null;
  let paymentFields: { paymentAmount: number; paymentId: string } | null = null;
  if (stepDef.collectsPayment) {
    const amount = Number.isFinite(d.payment) ? Math.max(0, d.payment as number) : 0;
    if (amount > 0) {
      const sale = saleFromClassification(cls);
      if (!sale) throw new Error("Record the sale before collecting a payment.");
      const paymentId = randomUUID();
      const payment: SalePayment = { id: paymentId, kind: "progress", amount, date: new Date().toISOString(), note: (d.paymentNote ?? "").trim() || undefined, proof: d.paymentProof ?? null };
      saleUpdate = { ...sale, payments: [...sale.payments, payment] };
      paymentFields = { paymentAmount: amount, paymentId };
    }
  }

  const mbStamp: MBStamp = { byName: user.name, at: new Date().toISOString(), ...((d.note ?? "").trim() ? { note: (d.note ?? "").trim() } : {}) };
  const updated: MultiDeliveryBatch = { ...batch, steps: { ...batch.steps, [stepKey]: mbStamp }, ...(paymentFields ?? {}) };
  const deliveryBatches = wf.deliveryBatches.map((b) => (b.id === batchId ? updated : b));

  // Close the order once every item is delivered AND every batch is filed.
  let advance: Record<string, unknown> = {};
  let closedNow = false;
  if (stepKey === MB_DELIVERED_STEP || stepKey === MB_FINAL_STEP) {
    const ordered = orderedMap(quote.items);
    const deliveredNow = mbDeliveredByDescription(deliveryBatches);
    const allDelivered = ordered.size > 0 && [...ordered.entries()].every(([k, ord]) => (deliveredNow.get(k) ?? 0) >= ord);
    const active = deliveryBatches.filter((b) => !b.cancelled);
    const allFiled = active.length > 0 && active.every((b) => isMbFiled(b));
    if (allDelivered && allFiled && stageIndex(wf.stage) < stageIndex("closed")) {
      advance = { stage: "closed" as OrderStage, approvals: stamp(wf, "documents_filed", user) };
      closedNow = true;
    } else if (allDelivered && stageIndex(wf.stage) < stageIndex("delivered")) {
      advance = { stage: "delivered" as OrderStage, approvals: stamp(wf, "delivered", user) };
    }
  }

  await prisma.quotation.update({
    where: { id: quotationId },
    data: {
      classification: {
        ...cls,
        workflow: { ...wf, deliveryBatches, ...advance },
        ...(saleUpdate ? { sale: saleUpdate } : {}),
      } as unknown as Prisma.InputJsonObject,
    },
  });
  // Multi-batch order just closed — create the sales commission (like the single-batch close).
  if (closedNow) await ensureCommissionRow(quotationId);
  revalidatePath("/orders");
  revalidatePath("/commissions");
  revalidatePath(`/orders/${quotationId}`);
  revalidatePath(`/quotations/${quotationId}`);
}

/** Cancel a delivery batch (releases its items). Creator, Sales or admin. */
export async function cancelMultiBatch(quotationId: string, batchId: string): Promise<void> {
  const user = await getCurrentUser();
  if (!user) throw new Error("Unauthorized");
  const { quote, cls, wf } = await loadWorkflow(quotationId);
  const batch = wf.deliveryBatches.find((b) => b.id === batchId);
  if (!batch) throw new Error("Delivery batch not found.");
  if (!(isAdmin(user) || batch.createdByName === user.name || quote.preparedById === user.id)) {
    throw new Error("Only the batch's creator, Sales or an admin can cancel it.");
  }
  let saleUpdate: Record<string, unknown> | null = null;
  if (batch.paymentId) {
    const sale = saleFromClassification(cls);
    if (sale) saleUpdate = { ...sale, payments: sale.payments.filter((p) => p.id !== batch.paymentId) };
  }
  const deliveryBatches = wf.deliveryBatches.map((b) => (b.id === batchId ? { ...b, cancelled: true, cancelledAt: new Date().toISOString() } : b));
  await prisma.quotation.update({
    where: { id: quotationId },
    data: {
      classification: {
        ...cls,
        workflow: { ...wf, deliveryBatches },
        ...(saleUpdate ? { sale: saleUpdate } : {}),
      } as unknown as Prisma.InputJsonObject,
    },
  });
  revalidatePath("/orders");
  revalidatePath(`/orders/${quotationId}`);
  revalidatePath(`/quotations/${quotationId}`);
}

const recordPaymentSchema = z.object({
  amount: z.coerce.number(),
  note: z.string().optional(),
  date: z.string().optional(), // collection date from a validated slip (or admin manual)
  proof: z.object({ path: z.string(), name: z.string(), uploadedAt: z.string() }).nullish(),
});

/**
 * Record a payment against the order's outstanding balance, independent of any
 * delivery batch — used to collect the remaining balance when a partially-paid
 * order has already been (fully) delivered (accounts receivable). Sales (the
 * order's preparer), Accounting or an admin.
 */
export async function recordOrderPayment(quotationId: string, input: z.infer<typeof recordPaymentSchema>): Promise<void> {
  const user = await getCurrentUser();
  if (!user) throw new Error("Unauthorized");
  const quote = await prisma.quotation.findUnique({ where: { id: quotationId }, select: { classification: true, preparedById: true } });
  if (!quote) throw new Error("Order not found");
  const roles = await getWorkflowRoles();
  const allowed = isAdmin(user)
    || quote.preparedById === user.id
    || user.role === "ENGINEER"
    || userHasWorkflowRole(roles, user.id, "accounting")
    || userHasWorkflowRole(roles, user.id, "payment_approver");
  if (!allowed) throw new Error("Only Sales, Accounting, the Payment Approver, an Engineer or an admin can record a payment.");
  const d = recordPaymentSchema.parse(input);
  const amount = Number.isFinite(d.amount) ? Math.max(0, d.amount) : 0;
  if (amount <= 0) throw new Error("Enter a payment amount greater than zero.");
  const cls = (quote.classification as Record<string, unknown>) ?? {};
  const sale = saleFromClassification(cls);
  if (!sale) throw new Error("Record the sale before collecting a payment.");
  const basePayment: SalePayment = {
    id: randomUUID(),
    kind: "progress",
    amount,
    date: (d.date ?? "").trim() || new Date().toISOString(),
    note: (d.note ?? "").trim() || undefined,
    proof: d.proof ?? null,
  };
  // Deposit-slip rule: a non-machine-validated / non-computer-generated proof may
  // only be recorded by an admin; a validated slip's date + amount are
  // authoritative (the payment follows the slip). Throws for a blocked non-admin.
  const canOverride = isAdmin(user) || userHasWorkflowRole(roles, user.id, "accounting");
  const [payment] = applyPaymentSlipRules(cls, [basePayment], { canOverride });
  await prisma.quotation.update({
    where: { id: quotationId },
    data: { classification: { ...cls, sale: { ...sale, payments: [...sale.payments, payment] } } as unknown as Prisma.InputJsonObject },
  });
  revalidatePath("/orders");
  revalidatePath(`/orders/${quotationId}`);
  revalidatePath(`/quotations/${quotationId}`);
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
  if (!isSales) throw new Error("Only a Sales team member or an admin can do this.");
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

/**
 * Quality & transfer phase (after final payment is confirmed, before delivery
 * documents). Four sequential sign-offs:
 *   final_pay_cleared → [Technical Head / Quality Inspector: quality testing] → qa_tested
 *   qa_tested         → [Plant Manager: quality & quantity check] → qa_plant_checked
 *   qa_plant_checked  → [Logistics: transfer items to office] → qa_transferred
 *   qa_transferred    → [Sales: 2nd quality & quantity check] → qa_sales_checked
 */
/**
 * The Office-side actors for a bought-in / from-stock order's Phase 5 quality steps
 * (admin is checked separately by the caller). These orders skip the production QC
 * departments, so Logistics / Engineer / Sales / Payment Approver handle them.
 */
function boughtInQaActor(user: { id: string; role: string }, roles: Awaited<ReturnType<typeof getWorkflowRoles>>, preparedById: string): boolean {
  return user.role === "ENGINEER"
    || user.role === "SALES"
    || user.id === preparedById
    || userHasWorkflowRole(roles, user.id, "logistics" as WorkflowRoleKey)
    || userHasWorkflowRole(roles, user.id, "payment_approver" as WorkflowRoleKey);
}

// A bought-in or from-stock order skips production, so its Phase 5 quality steps
// are run by the Office-side actors above rather than the production QC roles.
async function isNoProductionOrder(quotationId: string): Promise<boolean> {
  const items = await prisma.quotationItem.findMany({
    where: { quotationId },
    select: { qty: true, descriptionSnapshot: true, specsSnapshot: true },
  });
  return isBoughtInOnlyOrder(items) || isStockOnlyOrder(items);
}

const BOUGHT_IN_QA_ERR = "Only Logistics, the Engineer, Sales, the Payment Approver or an admin can do this.";

export async function qaTest(quotationId: string): Promise<void> {
  const user = await getCurrentUser();
  if (!user) throw new Error("Unauthorized");
  const roles = await getWorkflowRoles();
  const { quote, cls, wf } = await loadWorkflow(quotationId);
  const noProd = await isNoProductionOrder(quotationId);
  // Office pickup: the 2nd Quality Inspector performs the quality test.
  const pickup = wf.officePickup === true;
  // Plant pick up: the Technical Head / Quality Inspector tests, regardless of sourcing.
  const plant = wf.fulfillmentMode === "plant_pickup";
  const techOrQi = userHasWorkflowRole(roles, user.id, "technical_head" as WorkflowRoleKey)
    || userHasWorkflowRole(roles, user.id, "quality_inspector" as WorkflowRoleKey);
  const ok = isAdmin(user) || (plant
    ? techOrQi
    : noProd
      ? boughtInQaActor(user, roles, quote.preparedById ?? "")
        || (pickup && userHasWorkflowRole(roles, user.id, "quality_inspector_2" as WorkflowRoleKey))
      : techOrQi);
  if (!ok) throw new Error(noProd && !plant ? BOUGHT_IN_QA_ERR : "Only the Technical Head, a Quality Inspector or an admin can do this.");
  if (wf.stage !== "final_pay_cleared") throw new Error("The order isn't ready for quality testing.");
  await saveWorkflow(quotationId, cls, { ...wf, stage: "qa_tested", approvals: stamp(wf, "qa_tested", user) });
}

export async function qaPlantCheck(quotationId: string): Promise<void> {
  const user = await getCurrentUser();
  if (!user) throw new Error("Unauthorized");
  const roles = await getWorkflowRoles();
  const { quote, cls, wf } = await loadWorkflow(quotationId);
  const noProd = await isNoProductionOrder(quotationId);
  // Plant pick up: the Plant Manager approves quality & quantity, regardless of sourcing.
  const plant = wf.fulfillmentMode === "plant_pickup";
  const ok = isAdmin(user) || (noProd && !plant
    ? boughtInQaActor(user, roles, quote.preparedById ?? "")
    : userHasWorkflowRole(roles, user.id, "plant_manager" as WorkflowRoleKey));
  if (!ok) throw new Error(noProd && !plant ? BOUGHT_IN_QA_ERR : "Only the Plant Manager or an admin can do this.");
  if (wf.stage !== "qa_tested") throw new Error("The order hasn't passed quality testing yet.");
  await saveWorkflow(quotationId, cls, { ...wf, stage: "qa_plant_checked", approvals: stamp(wf, "qa_plant_checked", user) });
}

export async function qaTransfer(quotationId: string): Promise<void> {
  const user = await getCurrentUser();
  if (!user) throw new Error("Unauthorized");
  const roles = await getWorkflowRoles();
  const { cls, wf } = await loadWorkflow(quotationId);
  if (wf.stage !== "qa_plant_checked") throw new Error("The order hasn't passed the Plant Manager check yet.");
  // Plant pick up: this step is the Warehouseman "making the delivery form" — they
  // attach the delivery form here. No transfer to office.
  if (wf.fulfillmentMode === "plant_pickup") {
    if (!(isAdmin(user) || userHasWorkflowRole(roles, user.id, "warehouse" as WorkflowRoleKey)))
      throw new Error("Only the Warehouseman or an admin can make the delivery form.");
    const form = saleFromClassification(cls)?.docs?.delivery_form ?? [];
    if (form.length === 0) throw new Error("Attach the delivery form first.");
  } else if (!(isAdmin(user) || userHasWorkflowRole(roles, user.id, "logistics" as WorkflowRoleKey))) {
    throw new Error("Only Logistics or an admin can do this.");
  }
  await saveWorkflow(quotationId, cls, { ...wf, stage: "qa_transferred", approvals: stamp(wf, "qa_transferred", user) });
}

export async function qaSalesCheck(quotationId: string): Promise<void> {
  const user = await getCurrentUser();
  if (!user) throw new Error("Unauthorized");
  const { quote, cls, wf } = await loadWorkflow(quotationId);
  if (wf.stage !== "qa_transferred") throw new Error("The order isn't ready for this step yet.");
  // Plant pick up: this step is the Plant Manager approving the delivery.
  if (wf.fulfillmentMode === "plant_pickup") {
    if (!(isAdmin(user) || userHasWorkflowRole(await getWorkflowRoles(), user.id, "plant_manager" as WorkflowRoleKey)))
      throw new Error("Only the Plant Manager or an admin can approve the delivery.");
  } else {
    const isSales =
      isAdmin(user) ||
      quote.preparedById === user.id ||
      user.role === "SALES" ||
      user.role === "ENGINEER" ||
      userHasWorkflowRole(await getWorkflowRoles(), user.id, "quality_inspector_2" as WorkflowRoleKey);
    if (!isSales) throw new Error("Only a Sales team member, a 2nd Quality Inspector or an admin can do this.");
  }
  await saveWorkflow(quotationId, cls, { ...wf, stage: "qa_sales_checked", approvals: stamp(wf, "qa_sales_checked", user) });
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
  // Office pickup skips the plant-QC → transfer → Sales-2nd-QC steps, so its
  // delivery documents are prepared straight after the quality test (qa_tested).
  const pickupReady = wf.officePickup === true && wf.stage === "qa_tested";
  if (wf.stage !== "qa_sales_checked" && !pickupReady) throw new Error("The order isn't ready for delivery documents.");
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
  const roles = await getWorkflowRoles();
  const { cls, wf } = await loadWorkflow(quotationId);
  // Plant pick up: the Warehouseman uploads the delivery form + proof of pick up,
  // straight after the Plant Manager approves the delivery (qa_sales_checked).
  const plant = wf.fulfillmentMode === "plant_pickup";
  if (plant) {
    if (!(isAdmin(user) || userHasWorkflowRole(roles, user.id, "warehouse" as WorkflowRoleKey)))
      throw new Error("Only the Warehouseman or an admin can do this.");
    if (wf.stage !== "qa_sales_checked") throw new Error("The delivery hasn't been approved yet.");
  } else {
    if (!(isAdmin(user) || userHasWorkflowRole(roles, user.id, "logistics" as WorkflowRoleKey)))
      throw new Error("Only Logistics or an admin can do this.");
    if (wf.stage !== "delivery_docs_ready") throw new Error("Delivery documents aren't ready yet.");
  }
  // The proof must be attached before marking delivered / picked up.
  const podDocs = saleFromClassification(cls)?.docs?.pod ?? [];
  if (podDocs.length === 0) throw new Error(plant ? "Attach the proof of pick up first." : "Attach the proof of delivery before marking delivered.");
  const documents = { ...wf.documents, pod: pod.trim() || undefined };
  await saveWorkflow(quotationId, cls, { ...wf, stage: "delivered", documents, approvals: stamp(wf, "delivered", user) });
}

const CLOSE_DOC_KEYS = new Set([
  "sales_invoice", "or_cr_af", "delivery_receipt", "bir_2307",
  // Unsigned client documents attached when preparing the delivery documents.
  "unsigned_si", "unsigned_or_cr_af", "unsigned_dr",
  // Proof-of-delivery files uploaded by Logistics.
  "pod",
  // Plant pick up: the delivery form made by the Warehouseman.
  "delivery_form",
  // Zero-rated: the Certificate of VAT Exempt/Zero Rated.
  "vat_zero_cert",
  // Proof of final payment (for the approver's review, then archived).
  "final_payment",
]);

/** Load a quote for editing its sale documents; gate to Accounting/Sales/admin. */
async function loadForCloseDoc(quotationId: string, key: string) {
  const user = await getCurrentUser();
  if (!user) throw new Error("Unauthorized");
  if (!CLOSE_DOC_KEYS.has(key)) throw new Error("Unknown document.");
  const quote = await prisma.quotation.findUnique({
    where: { id: quotationId },
    select: { id: true, classification: true, preparedById: true },
  });
  if (!quote) throw new Error("Order not found");
  const roles = await getWorkflowRoles();
  const ok = isAdmin(user)
    || quote.preparedById === user.id
    || userHasWorkflowRole(roles, user.id, "accounting" as WorkflowRoleKey)
    // Logistics attaches/removes the proof of delivery (the "pod" slot only) —
    // they own the delivery step but aren't Accounting/Sales. For office pickup,
    // Sales uploads the proof of pick up into the same slot.
    || (key === "pod" && (userHasWorkflowRole(roles, user.id, "logistics" as WorkflowRoleKey) || user.role === "SALES"))
    // Plant pick up: the Warehouseman attaches the delivery form and the proof of
    // pick up.
    || ((key === "pod" || key === "delivery_form") && userHasWorkflowRole(roles, user.id, "warehouse" as WorkflowRoleKey));
  if (!ok) throw new Error("Only Accounting, Sales or an admin can attach closing documents.");
  const cls = (quote.classification as Record<string, unknown>) ?? {};
  const sale = saleFromClassification(cls) ?? { arrangement: "downpayment_full" as const, payments: [] };
  return { user, cls, sale };
}

/** Attach a closing document (Sales Invoice / OR-CR-AF / Delivery Receipt / BIR 2307). */
export async function saveCloseDoc(quotationId: string, key: string, doc: { path: string; name: string; uploadedAt?: string }): Promise<void> {
  const { cls, sale } = await loadForCloseDoc(quotationId, key);
  const docs = { ...(sale.docs ?? {}) };
  const entry: SaleDoc = { path: doc.path, name: doc.name, uploadedAt: doc.uploadedAt || new Date().toISOString() };
  docs[key] = [...(docs[key] ?? []), entry];
  await prisma.quotation.update({
    where: { id: quotationId },
    data: { classification: { ...cls, sale: { ...sale, docs } } as unknown as Prisma.InputJsonObject },
  });
  revalidatePath(`/orders/${quotationId}`);
  revalidatePath(`/quotations/${quotationId}`);
}

/** Remove a closing document. */
export async function removeCloseDoc(quotationId: string, key: string, path: string): Promise<void> {
  await assertUploadAdmin();
  const { cls, sale } = await loadForCloseDoc(quotationId, key);
  const docs = { ...(sale.docs ?? {}) };
  docs[key] = (docs[key] ?? []).filter((d) => d.path !== path);
  await prisma.quotation.update({
    where: { id: quotationId },
    data: { classification: { ...cls, sale: { ...sale, docs } } as unknown as Prisma.InputJsonObject },
  });
  revalidatePath(`/orders/${quotationId}`);
  revalidatePath(`/quotations/${quotationId}`);
}

/** Sales approves the proof of delivery — marks the delivery successful (step 1). */
export async function approveDelivery(quotationId: string): Promise<void> {
  const user = await getCurrentUser();
  if (!user) throw new Error("Unauthorized");
  const { quote, cls, wf } = await loadWorkflow(quotationId);
  const isSales = isAdmin(user) || quote.preparedById === user.id || user.role === "SALES" || user.role === "ENGINEER";
  if (!isSales) throw new Error("Only a Sales team member or an admin can do this.");
  if (wf.stage !== "delivered") throw new Error("The order hasn't been delivered yet.");
  await saveWorkflow(quotationId, cls, { ...wf, stage: "delivery_confirmed", approvals: stamp(wf, "delivery_confirmed", user) });
}

/**
 * Office pickup: Sales uploads the proof of pick up and approves it in one step —
 * marking the pickup successful. Combines the normal flow's Logistics "mark
 * delivered" and Sales "approve POD" into a single Sales action (delivery_docs_ready
 * → delivery_confirmed). Only for office-pickup orders.
 */
export async function approvePickupDelivery(quotationId: string): Promise<void> {
  const user = await getCurrentUser();
  if (!user) throw new Error("Unauthorized");
  const { quote, cls, wf } = await loadWorkflow(quotationId);
  if (!wf.officePickup) throw new Error("This isn't an office-pickup order.");
  const isSales = isAdmin(user) || quote.preparedById === user.id || user.role === "SALES" || user.role === "ENGINEER";
  if (!isSales) throw new Error("Only a Sales team member or an admin can do this.");
  if (wf.stage !== "delivery_docs_ready") throw new Error("The delivery documents aren't ready yet.");
  // The proof of pick up must be attached before it can be approved.
  const podDocs = saleFromClassification(cls)?.docs?.pod ?? [];
  if (podDocs.length === 0) throw new Error("Upload the proof of pick up before approving.");
  const approvals = stamp({ approvals: stamp(wf, "delivered", user) }, "delivery_confirmed", user);
  await saveWorkflow(quotationId, cls, { ...wf, stage: "delivery_confirmed", approvals });
}

/** Logistics surrenders the client-signed documents to accounting (step 2). */
export async function surrenderDeliveryDocs(quotationId: string): Promise<void> {
  const user = await getCurrentUser();
  if (!user) throw new Error("Unauthorized");
  const { quote, cls, wf } = await loadWorkflow(quotationId);
  // Office pickup: Sales surrenders the client-signed documents (not Logistics).
  if (wf.officePickup === true) {
    const isSales = isAdmin(user) || quote.preparedById === user.id || user.role === "SALES" || user.role === "ENGINEER";
    if (!isSales) throw new Error("Only a Sales team member or an admin can do this.");
  } else if (!(isAdmin(user) || userHasWorkflowRole(await getWorkflowRoles(), user.id, "logistics" as WorkflowRoleKey))) {
    throw new Error("Only Logistics or an admin can do this.");
  }
  if (wf.stage !== "delivery_confirmed") throw new Error("The delivery hasn't been confirmed by Sales yet.");
  await saveWorkflow(quotationId, cls, { ...wf, stage: "docs_surrendered", approvals: stamp(wf, "docs_surrendered", user) });
}

/** Accounting confirms it received the client-signed documents from Logistics. */
export async function confirmDocsReceived(quotationId: string): Promise<void> {
  const user = await getCurrentUser();
  if (!user) throw new Error("Unauthorized");
  if (!(isAdmin(user) || userHasWorkflowRole(await getWorkflowRoles(), user.id, "accounting" as WorkflowRoleKey)))
    throw new Error("Only Accounting or an admin can do this.");
  const { cls, wf } = await loadWorkflow(quotationId);
  // Plant pick up skips the surrender step — confirm receipt straight after the
  // POD is approved (delivery_confirmed).
  const plant = wf.fulfillmentMode === "plant_pickup";
  const okStage = plant ? wf.stage === "delivery_confirmed" : wf.stage === "docs_surrendered";
  if (!okStage) throw new Error(plant ? "The proof of pick up hasn't been approved yet." : "Logistics hasn't surrendered the documents yet.");
  await saveWorkflow(quotationId, cls, { ...wf, stage: "docs_received", approvals: stamp(wf, "docs_received", user) });
}

/** Accounting files the signed documents and closes the order (steps 3-4). */
export async function fileDocuments(quotationId: string): Promise<void> {
  const user = await getCurrentUser();
  if (!user) throw new Error("Unauthorized");
  if (!(isAdmin(user) || userHasWorkflowRole(await getWorkflowRoles(), user.id, "accounting" as WorkflowRoleKey)))
    throw new Error("Only Accounting or an admin can do this.");
  const { cls, wf } = await loadWorkflow(quotationId);
  if (wf.stage !== "docs_received" && wf.stage !== "closed")
    throw new Error("Accounting hasn't confirmed receipt of the documents yet.");
  // First close (from docs_received) requires the closing documents present
  // (Sales Invoice / OR-CR-AF / Delivery Receipt, plus BIR 2307 for VAT-inclusive —
  // 2307 may lag). Re-filing an already-closed order is idempotent.
  if (wf.stage === "docs_received") {
    const vq = await prisma.quotation.findUnique({ where: { id: quotationId }, select: { vatMode: true } });
    const vatInclusive = vq?.vatMode !== "EXCLUSIVE";
    const zeroRated = vq?.vatMode === "ZERO_RATED";
    const docs = saleFromClassification(cls)?.docs;
    // Plant pick up: the Warehouseman's delivery form is required; the Accounting
    // closing docs (SI / OR / DR) are required only for VAT-inclusive orders. A
    // zero-rated order also requires the Certificate of VAT Exempt/Zero Rated.
    const closeState = wf.fulfillmentMode === "plant_pickup"
      ? plantCloseState(docs, vatInclusive, zeroRated)
      : closeDocsState(docs, vatInclusive, zeroRated);
    if (!closeState.appear) throw new Error("Upload all required closing documents before filing.");
    await saveWorkflow(quotationId, cls, { ...wf, stage: "closed", approvals: stamp(wf, "documents_filed", user) });
  }

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

/**
 * Sales-commission fulfillment after the order closes:
 *   1. [Admin / Payment Approver] approve the amount
 *   2. [Accounting] upload the commission voucher
 *   3. [Admin / Payment Approver] approve the voucher
 *   4. [Admin / Payment Approver] release the budget
 *   5. [Accounting] mark the commission received (DB Commission marked paid)
 *   6. [Accounting] file the voucher signed by the sales executive
 */
async function commissionActor(role: "approver" | "accounting") {
  const user = await getCurrentUser();
  if (!user) throw new Error("Unauthorized");
  const roles = await getWorkflowRoles();
  const ok = role === "approver"
    ? isAdmin(user) || userHasWorkflowRole(roles, user.id, "payment_approver" as WorkflowRoleKey)
    : isAdmin(user) || userHasWorkflowRole(roles, user.id, "accounting" as WorkflowRoleKey);
  if (!ok) throw new Error(role === "approver" ? "Only an admin or the Payment Approver can do this." : "Only Accounting or an admin can do this.");
  return user;
}

/** 1. Approve the commission amount. */
export async function approveCommission(quotationId: string): Promise<void> {
  const user = await commissionActor("approver");
  const { cls, wf } = await loadWorkflow(quotationId);
  if (wf.stage !== "closed") throw new Error("The order isn't closed yet.");
  const commission = { ...(wf.commission ?? {}), approvedByName: user.name, approvedAt: new Date().toISOString() };
  await saveWorkflow(quotationId, cls, { ...wf, commission });
}

/** 2. Accounting uploads the commission voucher. */
export async function uploadCommissionVoucher(quotationId: string, doc: { path: string; name: string; uploadedAt?: string }): Promise<void> {
  const user = await commissionActor("accounting");
  const { cls, wf } = await loadWorkflow(quotationId);
  if (!wf.commission?.approvedAt) throw new Error("The commission amount hasn't been approved yet.");
  const commission = {
    ...wf.commission,
    voucherDoc: { path: doc.path, name: doc.name, uploadedAt: doc.uploadedAt || new Date().toISOString() },
    voucherByName: user.name,
    voucherAt: new Date().toISOString(),
  };
  await saveWorkflow(quotationId, cls, { ...wf, commission });
}

/** 3. Approve the commission voucher. */
export async function approveCommissionVoucher(quotationId: string): Promise<void> {
  const user = await commissionActor("approver");
  const { cls, wf } = await loadWorkflow(quotationId);
  if (!wf.commission?.voucherAt) throw new Error("The commission voucher hasn't been uploaded yet.");
  const commission = { ...wf.commission, voucherApprovedByName: user.name, voucherApprovedAt: new Date().toISOString() };
  await saveWorkflow(quotationId, cls, { ...wf, commission });
}

/** 4. Release the commission budget. */
export async function releaseCommissionBudget(quotationId: string): Promise<void> {
  const user = await commissionActor("approver");
  const { cls, wf } = await loadWorkflow(quotationId);
  if (!wf.commission?.voucherApprovedAt) throw new Error("The commission voucher hasn't been approved yet.");
  const commission = { ...wf.commission, budgetReleasedByName: user.name, budgetReleasedAt: new Date().toISOString() };
  await saveWorkflow(quotationId, cls, { ...wf, commission });
}

/** 5. Accounting records that Sales received the commission (DB row marked paid). */
export async function receiveCommission(quotationId: string): Promise<void> {
  const user = await commissionActor("accounting");
  const { cls, wf } = await loadWorkflow(quotationId);
  if (!wf.commission?.budgetReleasedAt) throw new Error("The commission budget hasn't been released yet.");
  const commission = { ...wf.commission, receivedByName: user.name, receivedAt: new Date().toISOString() };
  await saveWorkflow(quotationId, cls, { ...wf, commission });
  try {
    await prisma.commission.update({ where: { quotationId }, data: { paid: true, paidAt: new Date(), paidByName: user.name } });
  } catch {
    /* commission row not present — order-side sign-off still recorded */
  }
  revalidatePath("/commissions");
}

/** 6. Accounting files the voucher signed by the sales executive. */
export async function fileSignedCommissionVoucher(quotationId: string, doc: { path: string; name: string; uploadedAt?: string }): Promise<void> {
  const user = await commissionActor("accounting");
  const { cls, wf } = await loadWorkflow(quotationId);
  if (!wf.commission?.receivedAt) throw new Error("The commission hasn't been received yet.");
  const commission = {
    ...wf.commission,
    signedVoucherDoc: { path: doc.path, name: doc.name, uploadedAt: doc.uploadedAt || new Date().toISOString() },
    filedByName: user.name,
    filedAt: new Date().toISOString(),
  };
  await saveWorkflow(quotationId, cls, { ...wf, commission });
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
  if (pr.status !== "PLANT_APPROVED") throw new Error("This purchase isn't ready to receive (awaiting Plant Manager's final approval).");
  // Good items can be received into stock now; any disapproved item stays open
  // as a supplier return and is tracked separately until its replacement lands.

  const clean = (matches ?? []).filter((m) => m.stockItemId && Number(m.qty) > 0);

  await prisma.$transaction(async (tx) => {
    for (const m of clean) {
      await applyStockChange(tx, { stockItemId: m.stockItemId, kind: "RECEIPT", qty: Number(m.qty), reason: "Purchase received" }, user.name);
    }
    await tx.purchaseRequest.update({
      where: { id: purchaseRequestId },
      data: { status: "COMPLETED", receivedByName: user.name, receivedAt: new Date() },
    });
  });
  if (pr.quotationId) revalidatePath(`/orders/${pr.quotationId}`);
  revalidatePath("/purchasing");
  revalidatePath("/inventory");
}
