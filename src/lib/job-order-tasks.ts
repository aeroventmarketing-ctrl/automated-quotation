/**
 * Job-order tasks for My Dashboard's "Pending Your Action" — the Engineer's and
 * the admin's (whose My Dashboard is the Production Dashboard).
 *
 * The owner: *"In Phase 2 of Orders Tab, notify Engineer Role and Admin Role, if
 * they must create a job order, approve job order or issue job order."* Each
 * department's job order goes through those three steps on the order page:
 *
 *   create  — the paid quotation has items for the department, but it has no
 *             job order document yet (Auto-fill, or "Add … job order") — even
 *             when the department was already issued to production; only once
 *             its production is finished is there nothing to create;
 *   approve — a job order is there but not approved yet (its ✓ Approve);
 *   issue   — the department hasn't been issued to production yet
 *             ("Issue job order").
 *
 * A department shows its EARLIEST outstanding step — one task per department, so
 * a department reads "Approve Accessories job order" until it is approved, then
 * "Issue Accessories job order". Only in Phase 2 while job orders can still be
 * issued (released → producing); a department already issued to production with
 * every job order approved has nothing left here.
 *
 * Pure: reads the order's workflow and which departments its quotation needs.
 * Read-only — nothing about who may create, approve or issue changes.
 */
import type { OrderWorkflow } from "@/lib/order-workflow";
import type { JobOrderDept } from "@/lib/job-order-autogen";

export type JobOrderStep = "create" | "approve" | "issue";

export interface JobOrderTask {
  dept: JobOrderDept;
  step: JobOrderStep;
  /** "Create Fans & Blower job order", "Approve Accessories job order", … */
  action: string;
  /** When it became due (ISO), for "pending since"; undefined when unknown. */
  since?: string;
}

/** The Phase 2 stages in which job orders are still created, approved and issued. */
export const JOB_ORDER_STAGES = new Set(["released", "in_production", "jo_received", "producing"]);

const DEPTS: { key: JobOrderDept; label: string; field: "fansJobOrders" | "ductJobOrders" | "accessoriesJobOrders" | "motorJobOrders" }[] = [
  { key: "fans", label: "Fans & Blower", field: "fansJobOrders" },
  { key: "duct", label: "Duct", field: "ductJobOrders" },
  { key: "accessories", label: "Accessories", field: "accessoriesJobOrders" },
  { key: "motor", label: "Motor Controller", field: "motorJobOrders" },
];

const STEP_VERB: Record<JobOrderStep, string> = { create: "Create", approve: "Approve", issue: "Issue" };

type JoDoc = { approvedByName?: string; approvedAt?: string };

export function jobOrderTasks(
  wf: Pick<OrderWorkflow, "stage" | "jobOrders" | "approvals" | "fansJobOrders" | "ductJobOrders" | "accessoriesJobOrders" | "motorJobOrders">,
  needed: Record<JobOrderDept, boolean>,
): JobOrderTask[] {
  if (!JOB_ORDER_STAGES.has(wf.stage)) return [];
  const cleared = wf.approvals?.payment_cleared?.at || undefined;
  const out: JobOrderTask[] = [];
  for (const d of DEPTS) {
    const docs = ((wf[d.field] ?? []) as JoDoc[]).filter(Boolean);
    const issued = !!wf.jobOrders?.[d.key];
    if (!needed[d.key] && docs.length === 0) continue; // the order doesn't touch this department
    let step: JobOrderStep | null = null;
    let since: string | undefined = cleared;
    if (docs.length === 0) {
      // No job-order document yet — create one, even if the department was
      // already issued to production from its panel (issuing doesn't wait for a
      // document). Only a department whose production is finished is past it.
      // This was `!issued`, which hid Create Fans & Blower / Motor Controller on
      // orders whose departments had been issued first — the owner's "Create
      // duct job order is showing but create motor controller … and create fans
      // and blowers job order is not".
      if (wf.jobOrders?.[d.key]?.status !== "finished") step = "create";
    } else if (docs.some((x) => !(x.approvedByName ?? "").trim())) {
      step = "approve";
    } else if (!issued) {
      step = "issue";
      since = docs.map((x) => x.approvedAt ?? "").filter(Boolean).sort().at(-1) || cleared;
    }
    if (step) out.push({ dept: d.key, step, action: `${STEP_VERB[step]} ${d.label} job order`, since });
  }
  return out;
}

// --- Telling the department head their job order is here -------------------------

/** Each department's head (workflow role), as PRODUCTION_DEPTS names them. */
const HEAD_ROLE: Record<JobOrderDept, string> = {
  fans: "prod_head_fans",
  duct: "prod_head_duct",
  accessories: "prod_head_accessories",
  motor: "prod_head_motor",
};

export interface IssuedJobOrderNotice {
  dept: JobOrderDept;
  /** The head who is told — a workflow role key. */
  role: string;
  /** "Fans & Blower job order issued — awaiting Plant Manager to receive", … */
  action: string;
  /** When it was issued (ISO). */
  since?: string;
}

/**
 * The owner: *"Once issue job order button is pressed. Notify in pending my
 * action of the corresponding head that the job order is issued"* — *"just
 * notify the department head that there is a job order"*, on the dashboard and
 * the alarm, at the first release and for every later top-up.
 *
 * One notice per department whose job order is ISSUED and not yet started — it
 * clears when the head presses Start production. Its wording says where the
 * order is: still waiting for the Plant Manager to receive the job orders, or
 * received and ready to start. Read-only: nothing about who acts changes.
 */
export function issuedJobOrderNotices(wf: Pick<OrderWorkflow, "stage" | "jobOrders">): IssuedJobOrderNotice[] {
  if (!JOB_ORDER_STAGES.has(wf.stage)) return [];
  const out: IssuedJobOrderNotice[] = [];
  for (const d of DEPTS) {
    const jo = wf.jobOrders?.[d.key];
    if (jo?.status !== "issued") continue;
    const tail =
      wf.stage === "in_production" ? " — awaiting Plant Manager to receive" : wf.stage === "jo_received" ? " — start production" : "";
    out.push({ dept: d.key, role: HEAD_ROLE[d.key], action: `${d.label} job order issued${tail}`, since: jo.issuedAt || undefined });
  }
  return out;
}
