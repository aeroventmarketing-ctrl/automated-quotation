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
  type OrderConversation,
} from "@/lib/order-workflow";
import { purchaseStep, isCancellable, PURCHASE_STEPS, PR_MAIN_ORDER, prMainIndex, priorPurchaseStatuses, type PRStatus } from "@/lib/purchasing";
import { coercePurchaseReturns, canRaiseReturnAt } from "@/lib/purchase-returns";
import { coerceReconciliation, canReconcileAt, isReconciled } from "@/lib/purchase-reconcile";
import { saleFromClassification, docCheckMissing, closeDocsState, type SaleDoc } from "@/lib/sale";
import { getDocCheckGateEnabled } from "@/lib/doc-check-gate";
import { payableTotal, round2 } from "@/lib/quote";
import { applyStockChange } from "@/lib/inventory";
import { coerceFansJobOrder, joTypeReady, joTypeLabel, type FansJobOrder } from "@/lib/job-order";
import { coerceDuctJobOrder, isReducingDuctType, type DuctJobOrder, type DuctSegment } from "@/lib/duct-job-order";
import { coerceAccessoriesJobOrder, type AccessoriesJobOrder, type AccessoryLine } from "@/lib/accessories-job-order";

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

  // Documents can only be marked checked once the required files are attached
  // (unless an admin has turned the gate off, e.g. for testing).
  if (step === "doc_check" && (await getDocCheckGateEnabled())) {
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

/**
 * Set (or clear) a job order's target completion date. Set by the Technical
 * Head, the Plant Manager, the department head, or an admin. `dueAt` is a
 * YYYY-MM-DD date string; pass null/"" to clear it.
 */
export async function setJobOrderDue(quotationId: string, dept: string, dueAt: string | null): Promise<void> {
  const user = await getCurrentUser();
  if (!user) throw new Error("Unauthorized");
  if (!DEPT_KEY_SET.has(dept as ProductionDeptKey)) throw new Error("Unknown department");
  const deptKey = dept as ProductionDeptKey;
  const roles = await getWorkflowRoles();
  const allowed =
    isAdmin(user) ||
    userHasWorkflowRole(roles, user.id, "technical_head" as WorkflowRoleKey) ||
    userHasWorkflowRole(roles, user.id, "plant_manager" as WorkflowRoleKey) ||
    userHasWorkflowRole(roles, user.id, deptRole(deptKey) as WorkflowRoleKey);
  if (!allowed) throw new Error("Only the Technical Head, Plant Manager, the department head or an admin can set a deadline.");

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

  const jo: DuctJobOrder = { ...(coerceDuctJobOrder({}) as DuctJobOrder), ...d, segments };
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
      material: l.material || "G.I.",
    }))
    .filter((l) => l.type !== "" || l.dimensions.length > 0);

  let accJoBaseNo = wf.accJoBaseNo;
  let accJoBaseYear = wf.accJoBaseYear;
  if (accJoBaseNo == null) {
    accJoBaseNo = await nextAccJoBaseNo();
    accJoBaseYear = new Date().getFullYear();
  }

  const jo: AccessoriesJobOrder = { ...(coerceAccessoriesJobOrder({}) as AccessoriesJobOrder), ...d, lines };
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
  dept: string,
  items: MRFItem[],
  note: string,
): Promise<void> {
  const user = await getCurrentUser();
  if (!user) throw new Error("Unauthorized");
  if (!DEPT_KEY_SET.has(dept as ProductionDeptKey)) throw new Error("Unknown department");
  const deptKey = dept as ProductionDeptKey;

  const roles = await getWorkflowRoles();
  const allowed =
    isAdmin(user) ||
    userHasWorkflowRole(roles, user.id, "purchaser" as WorkflowRoleKey) ||
    userHasWorkflowRole(roles, user.id, deptRole(deptKey) as WorkflowRoleKey);
  if (!allowed) throw new Error(`Only the ${deptLabel(deptKey)} head, the Purchaser, or an admin can raise this requisition.`);

  const cleanItems: MRFItem[] = (items ?? [])
    .map((it) => ({
      description: (it.description ?? "").trim(),
      qty: (it.qty ?? "").trim(),
      unit: (it.unit ?? "").trim(),
      remark: (it.remark ?? "").trim() || undefined,
    }))
    .filter((it) => it.description !== "");
  if (cleanItems.length === 0) throw new Error("List at least one item.");

  await prisma.purchaseRequest.create({
    data: {
      kind: "department",
      dept: deptKey,
      items: cleanItems.map(mrfItemLine) as Prisma.InputJsonValue,
      note: note.trim() || null,
      createdById: user.id,
      createdByName: user.name,
      status: "PENDING_APPROVAL",
    },
  });

  // Auto-save any newly typed items to the product catalogue (best effort).
  try {
    for (const it of cleanItems) await rememberProduct(it.description, it.unit);
  } catch {
    /* product table not migrated yet — ignore */
  }
  revalidatePath("/requisitions");
  revalidatePath("/purchasing");
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

/** Roles that can flag items for return to the supplier (any inspection point). */
const RETURN_RAISE_ROLES: WorkflowRoleKey[] = ["purchaser", "warehouse", "plant_manager"];
/** Roles that can mark a supplier return resolved (replacement received). */
const RETURN_RESOLVE_ROLES: WorkflowRoleKey[] = ["purchaser", "warehouse"];

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
  list.push({
    id: randomUUID(),
    items,
    reason,
    raisedByName: user.name,
    raisedRole,
    raisedAt: new Date().toISOString(),
  });
  await prisma.purchaseRequest.update({ where: { id: purchaseRequestId }, data: { returns: list as unknown as Prisma.InputJsonValue } });
  if (pr.quotationId) revalidatePath(`/orders/${pr.quotationId}`);
  revalidatePath("/purchasing");
  revalidatePath("/requisitions");
}

/**
 * Mark a supplier return resolved — the replacement has been received/settled.
 * Proof that the item was replaced (uploaded to /api/purchase-uploads) is
 * attached so it stays on the return's record.
 */
export async function resolvePurchaseReturn(
  purchaseRequestId: string,
  returnId: string,
  note?: string,
  proof?: { path: string; name: string; uploadedAt?: string }[],
): Promise<void> {
  const user = await getCurrentUser();
  if (!user) throw new Error("Unauthorized");
  const admin = isAdmin(user);
  if (!(admin || (await userHasAnyRole(user.id, RETURN_RESOLVE_ROLES)))) {
    throw new Error("Only the Purchaser, Warehouse or an admin can resolve a supplier return.");
  }
  const pr = await prisma.purchaseRequest.findUnique({ where: { id: purchaseRequestId } });
  if (!pr) throw new Error("Purchase request not found");
  const assignments = await getWorkflowRoles();
  const role = RETURN_RESOLVE_ROLES.find((r) => userHasWorkflowRole(assignments, user.id, r));
  const resolvedRole = role ? workflowRoleLabel(role) : admin ? "Admin" : "";

  const list = coercePurchaseReturns(pr.returns);
  const entry = list.find((r) => r.id === returnId);
  if (!entry) throw new Error("Return not found.");
  if (entry.resolvedAt) throw new Error("This return is already resolved.");
  entry.resolvedByName = user.name;
  entry.resolvedRole = resolvedRole;
  entry.resolvedAt = new Date().toISOString();
  if (note && note.trim()) entry.resolutionNote = note.trim();
  const proofDocs = (proof ?? [])
    .filter((d) => d && typeof d.path === "string" && typeof d.name === "string")
    .map((d) => ({ path: d.path, name: d.name, uploadedAt: d.uploadedAt ?? new Date().toISOString() }));
  if (proofDocs.length) entry.proof = proofDocs;
  await prisma.purchaseRequest.update({ where: { id: purchaseRequestId }, data: { returns: list as unknown as Prisma.InputJsonValue } });
  if (pr.quotationId) revalidatePath(`/orders/${pr.quotationId}`);
  revalidatePath("/purchasing");
  revalidatePath("/requisitions");
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
    note: input.note?.trim() || undefined,
  };
  await prisma.purchaseRequest.update({ where: { id: purchaseRequestId }, data: { reconciliation: next as unknown as Prisma.InputJsonValue } });
  if (pr.quotationId) revalidatePath(`/orders/${pr.quotationId}`);
  revalidatePath("/purchasing");
  revalidatePath("/requisitions");
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
    if (step.key === "reject") continue;
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
export async function qaTest(quotationId: string): Promise<void> {
  const user = await getCurrentUser();
  if (!user) throw new Error("Unauthorized");
  const roles = await getWorkflowRoles();
  const ok = isAdmin(user)
    || userHasWorkflowRole(roles, user.id, "technical_head" as WorkflowRoleKey)
    || userHasWorkflowRole(roles, user.id, "quality_inspector" as WorkflowRoleKey);
  if (!ok) throw new Error("Only the Technical Head, a Quality Inspector or an admin can do this.");
  const { cls, wf } = await loadWorkflow(quotationId);
  if (wf.stage !== "final_pay_cleared") throw new Error("The order isn't ready for quality testing.");
  await saveWorkflow(quotationId, cls, { ...wf, stage: "qa_tested", approvals: stamp(wf, "qa_tested", user) });
}

export async function qaPlantCheck(quotationId: string): Promise<void> {
  const user = await getCurrentUser();
  if (!user) throw new Error("Unauthorized");
  if (!(isAdmin(user) || userHasWorkflowRole(await getWorkflowRoles(), user.id, "plant_manager" as WorkflowRoleKey)))
    throw new Error("Only the Plant Manager or an admin can do this.");
  const { cls, wf } = await loadWorkflow(quotationId);
  if (wf.stage !== "qa_tested") throw new Error("The order hasn't passed quality testing yet.");
  await saveWorkflow(quotationId, cls, { ...wf, stage: "qa_plant_checked", approvals: stamp(wf, "qa_plant_checked", user) });
}

export async function qaTransfer(quotationId: string): Promise<void> {
  const user = await getCurrentUser();
  if (!user) throw new Error("Unauthorized");
  if (!(isAdmin(user) || userHasWorkflowRole(await getWorkflowRoles(), user.id, "logistics" as WorkflowRoleKey)))
    throw new Error("Only Logistics or an admin can do this.");
  const { cls, wf } = await loadWorkflow(quotationId);
  if (wf.stage !== "qa_plant_checked") throw new Error("The order hasn't passed the Plant Manager check yet.");
  await saveWorkflow(quotationId, cls, { ...wf, stage: "qa_transferred", approvals: stamp(wf, "qa_transferred", user) });
}

export async function qaSalesCheck(quotationId: string): Promise<void> {
  const user = await getCurrentUser();
  if (!user) throw new Error("Unauthorized");
  const { quote, cls, wf } = await loadWorkflow(quotationId);
  const isSales =
    isAdmin(user) ||
    quote.preparedById === user.id ||
    user.role === "SALES" ||
    user.role === "ENGINEER" ||
    userHasWorkflowRole(await getWorkflowRoles(), user.id, "quality_inspector_2" as WorkflowRoleKey);
  if (!isSales) throw new Error("Only a Sales team member, a 2nd Quality Inspector or an admin can do this.");
  if (wf.stage !== "qa_transferred") throw new Error("The items haven't been transferred to the office yet.");
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
  if (wf.stage !== "qa_sales_checked") throw new Error("The order isn't ready for delivery documents.");
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

const CLOSE_DOC_KEYS = new Set([
  "sales_invoice", "or_cr_af", "delivery_receipt", "bir_2307",
  // Unsigned client documents attached when preparing the delivery documents.
  "unsigned_si", "unsigned_or_cr_af", "unsigned_dr",
  // Proof-of-delivery files uploaded by Logistics.
  "pod",
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
  const ok = isAdmin(user)
    || quote.preparedById === user.id
    || userHasWorkflowRole(await getWorkflowRoles(), user.id, "accounting" as WorkflowRoleKey);
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

/** Logistics surrenders the client-signed documents to accounting (step 2). */
export async function surrenderDeliveryDocs(quotationId: string): Promise<void> {
  const user = await getCurrentUser();
  if (!user) throw new Error("Unauthorized");
  if (!(isAdmin(user) || userHasWorkflowRole(await getWorkflowRoles(), user.id, "logistics" as WorkflowRoleKey)))
    throw new Error("Only Logistics or an admin can do this.");
  const { cls, wf } = await loadWorkflow(quotationId);
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
  if (wf.stage !== "docs_surrendered") throw new Error("Logistics hasn't surrendered the documents yet.");
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
    const vatInclusive = vq?.vatMode === "INCLUSIVE";
    const closeState = closeDocsState(saleFromClassification(cls)?.docs, vatInclusive);
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
