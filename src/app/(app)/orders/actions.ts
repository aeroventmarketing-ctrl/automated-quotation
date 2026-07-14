"use server";

import { randomUUID } from "crypto";
import { revalidatePath } from "next/cache";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getCurrentUser, isAdmin } from "@/lib/auth";
import {
  getWorkflowRoles,
  userHasWorkflowRole,
  workflowRoleLabel,
  type WorkflowRoleKey,
} from "@/lib/workflow-roles";
import {
  ORDER_STEPS,
  readOrderWorkflow,
  PRODUCTION_DEPTS,
  deptRole,
  deptLabel,
  allJobOrdersFinished,
  type OrderStepKey,
  type ProductionDeptKey,
  type JobOrder,
  type MaterialRequest,
} from "@/lib/order-workflow";
import { purchaseStep } from "@/lib/purchasing";

const DEPT_KEY_SET = new Set(PRODUCTION_DEPTS.map((d) => d.key));

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
    select: { id: true, classification: true },
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
 * A department's Head of Production advances its job order: issued → in_production
 * → finished. When every issued job order is finished, the order moves to
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
  if (wf.stage !== "in_production") throw new Error("This job order isn't in production.");
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
  if (allJobOrdersFinished(nextWf)) nextWf.stage = "production_finished";

  await saveWorkflow(quotationId, cls, nextWf);
}

/**
 * A production department's head raises a Material Request Form against the order
 * (during production). The warehouse then issues or escalates it.
 */
export async function raiseMaterialRequest(
  quotationId: string,
  dept: string,
  items: string[],
  note: string,
): Promise<void> {
  const user = await getCurrentUser();
  if (!user) throw new Error("Unauthorized");
  if (!DEPT_KEY_SET.has(dept as ProductionDeptKey)) throw new Error("Unknown department");
  const deptKey = dept as ProductionDeptKey;

  if (!(isAdmin(user) || userHasWorkflowRole(await getWorkflowRoles(), user.id, deptRole(deptKey) as WorkflowRoleKey))) {
    throw new Error(`Only the ${deptLabel(deptKey)} head or an admin can raise its material request.`);
  }

  const cleanItems = items.map((s) => s.trim()).filter(Boolean);
  if (cleanItems.length === 0) throw new Error("List at least one material.");

  const { cls, wf } = await loadWorkflow(quotationId);
  if (!wf.jobOrders[deptKey]) throw new Error("This department has no job order on this order.");

  const req: MaterialRequest = {
    id: randomUUID(),
    dept: deptKey,
    items: cleanItems,
    note: note.trim() || undefined,
    status: "requested",
    raisedAt: new Date().toISOString(),
    raisedByName: user.name,
  };
  await saveWorkflow(quotationId, cls, { ...wf, materialRequests: [...wf.materialRequests, req] });
}

/**
 * The warehouse handles a material request: "issue" (in stock) or "purchase"
 * (escalate to the purchasing chain).
 */
export async function handleMaterialRequest(
  quotationId: string,
  requestId: string,
  decision: "issue" | "purchase",
): Promise<void> {
  const user = await getCurrentUser();
  if (!user) throw new Error("Unauthorized");
  if (!(isAdmin(user) || userHasWorkflowRole(await getWorkflowRoles(), user.id, "warehouse" as WorkflowRoleKey))) {
    throw new Error("Only the Warehouse or an admin can handle material requests.");
  }

  const { cls, wf } = await loadWorkflow(quotationId);
  const idx = wf.materialRequests.findIndex((m) => m.id === requestId);
  if (idx < 0) throw new Error("Material request not found.");
  if (wf.materialRequests[idx].status !== "requested") throw new Error("This request has already been handled.");

  const mrf = wf.materialRequests[idx];
  const updated: MaterialRequest = {
    ...mrf,
    status: decision === "issue" ? "issued" : "purchasing",
    handledAt: new Date().toISOString(),
    handledByName: user.name,
  };
  const materialRequests = wf.materialRequests.slice();
  materialRequests[idx] = updated;
  await saveWorkflow(quotationId, cls, { ...wf, materialRequests });

  // Escalation → create a real PurchaseRequest that walks the purchasing chain.
  if (decision === "purchase") {
    await prisma.purchaseRequest.create({
      data: {
        quotationId,
        mrfId: mrf.id,
        dept: mrf.dept,
        items: mrf.items as Prisma.InputJsonValue,
        note: mrf.note ?? null,
        createdById: user.id,
        createdByName: user.name,
        status: "PENDING_APPROVAL",
      },
    });
  }
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
  revalidatePath(`/orders/${pr.quotationId}`);
}
