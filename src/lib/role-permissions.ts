/**
 * Per-role permissions matrix — restrictions and approved tasks toggled by an
 * admin. Stored in the AppSetting key/value table (no migration) as
 *   { [workflowRoleKey]: { [capabilityKey]: boolean } }
 * Only values the admin sets are stored; anything unset falls back to a default.
 *
 * Enforcement: capabilities flagged `enforced` change app behaviour immediately.
 * `restrict_client_data` drives the shop-floor client-visibility masking (client
 * identity + purchase amounts). The remaining capabilities are recorded policy —
 * a central place to define and review each role's tasks.
 */
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";

export const ROLE_PERMISSIONS_KEY = "role_permissions";

export type RolePermissions = Record<string, Record<string, boolean>>;

export interface RoleCapability {
  key: string;
  label: string;
  enforced?: boolean; // toggling it changes app behaviour now
}
export interface CapabilityGroup {
  group: string;
  kind: "restriction" | "task";
  items: RoleCapability[];
}

/** The full catalogue of restrictions + tasks shown in the matrix. */
export const CAPABILITY_GROUPS: CapabilityGroup[] = [
  {
    group: "Client-data restrictions",
    kind: "restriction",
    items: [{ key: "restrict_client_data", label: "Hide client identity & purchase amounts", enforced: true }],
  },
  {
    group: "Sales & quotations",
    kind: "task",
    items: [
      { key: "create_inquiry", label: "Create inquiries" },
      { key: "create_quotation", label: "Create / edit quotations" },
      { key: "approve_quotation", label: "Approve quotations" },
      { key: "record_sale", label: "Record sale (attach PO / confirm)" },
      { key: "edit_pricing", label: "Edit pricing" },
      { key: "view_quotations", label: "View quotations" },
    ],
  },
  {
    group: "Orders & production",
    kind: "task",
    items: [
      { key: "view_orders", label: "View orders" },
      { key: "create_job_orders", label: "Create / edit job orders" },
      { key: "approve_job_orders", label: "Approve job orders" },
      { key: "start_production", label: "Start production" },
      { key: "finish_production", label: "Finish production" },
    ],
  },
  {
    group: "Quality control",
    kind: "task",
    items: [
      { key: "quality_check_1", label: "1st quality check" },
      { key: "quality_check_2", label: "2nd quality check" },
      { key: "plant_qc", label: "Plant QC pass" },
    ],
  },
  {
    group: "Warehouse & inventory",
    kind: "task",
    items: [
      { key: "manage_inventory", label: "Receive / issue / adjust stock" },
      { key: "reserve_stock", label: "Reserve stock" },
      { key: "transfer_stock", label: "Send stock transfer" },
      { key: "confirm_transfer_prodhead", label: "Confirm transfer — production head" },
      { key: "confirm_transfer_purchaser", label: "Confirm transfer — purchaser" },
      { key: "receive_into_stock", label: "Receive delivery into stock" },
    ],
  },
  {
    group: "Purchasing & supply chain",
    kind: "task",
    items: [
      { key: "raise_requisition", label: "Raise material requisition" },
      { key: "approve_requisition", label: "Approve requisition (MRF)" },
      { key: "issue_po", label: "Issue purchase order" },
      { key: "approve_po", label: "Approve purchase order" },
      { key: "assign_logistics", label: "Assign logistics / tasks" },
      { key: "confirm_delivery", label: "Confirm delivery received" },
    ],
  },
  {
    group: "Finance & approvals",
    kind: "task",
    items: [
      { key: "prepare_voucher", label: "Prepare voucher (accounting)" },
      { key: "approve_payment", label: "Approve payment / voucher" },
      { key: "sign_check", label: "Sign check & voucher" },
      { key: "release_cash", label: "Release cash" },
      { key: "approve_cash_request", label: "Approve cash request" },
      { key: "manage_commissions", label: "Manage commissions" },
      { key: "manage_payroll", label: "Manage departmental payroll" },
      { key: "view_pnl", label: "View departmental P&L" },
    ],
  },
  {
    group: "Delivery & documents",
    kind: "task",
    items: [
      { key: "mark_documents_checked", label: "Mark documents checked" },
      { key: "file_closing_documents", label: "File closing documents" },
      { key: "deliver_order", label: "Deliver to client" },
    ],
  },
  {
    group: "Schedules",
    kind: "task",
    items: [
      { key: "add_schedule", label: "Add schedule" },
      { key: "approve_schedule", label: "Approve schedule" },
    ],
  },
  {
    group: "Administration",
    kind: "task",
    items: [
      { key: "manage_users", label: "Manage users" },
      { key: "manage_roles", label: "Manage roles & permissions" },
      { key: "manage_settings", label: "Manage settings" },
      { key: "manage_suppliers", label: "Manage suppliers" },
      { key: "manage_products", label: "Manage products" },
    ],
  },
];

export const ALL_CAPABILITY_KEYS = new Set(CAPABILITY_GROUPS.flatMap((g) => g.items.map((i) => i.key)));

/**
 * Default capability matrix per role, from the ERP workflow and our discussions.
 * These are the boxes ticked until an admin edits a role. Every signed-in user
 * may add a schedule, so `add_schedule` is on for all. `restrict_client_data` is
 * on for the six shop-floor roles.
 */
export const DEFAULT_ROLE_CAPS: Record<string, string[]> = {
  accounting: ["view_orders", "view_quotations", "record_sale", "prepare_voucher", "manage_commissions", "add_schedule"],
  payment_approver: ["view_orders", "view_quotations", "approve_payment", "sign_check", "release_cash", "approve_cash_request", "approve_po", "manage_payroll", "view_pnl", "approve_schedule", "add_schedule"],
  technical_head: ["view_orders", "create_job_orders", "approve_job_orders", "add_schedule"],
  quality_inspector: ["restrict_client_data", "view_orders", "quality_check_1", "add_schedule"],
  quality_inspector_2: ["view_orders", "quality_check_2", "add_schedule"],
  prod_head_fans: ["restrict_client_data", "view_orders", "create_job_orders", "approve_job_orders", "start_production", "finish_production", "raise_requisition", "confirm_transfer_prodhead", "add_schedule"],
  prod_head_duct: ["restrict_client_data", "view_orders", "create_job_orders", "approve_job_orders", "start_production", "finish_production", "raise_requisition", "confirm_transfer_prodhead", "add_schedule"],
  prod_head_accessories: ["restrict_client_data", "view_orders", "create_job_orders", "approve_job_orders", "start_production", "finish_production", "raise_requisition", "confirm_transfer_prodhead", "add_schedule"],
  prod_head_motor: ["view_orders", "create_job_orders", "approve_job_orders", "start_production", "finish_production", "raise_requisition", "confirm_transfer_prodhead", "add_schedule"],
  warehouse: ["restrict_client_data", "manage_inventory", "reserve_stock", "transfer_stock", "receive_into_stock", "add_schedule"],
  purchaser: ["view_orders", "issue_po", "confirm_transfer_purchaser", "raise_requisition", "manage_products", "confirm_delivery", "add_schedule"],
  logistics: ["view_orders", "assign_logistics", "confirm_delivery", "deliver_order", "add_schedule"],
  plant_manager: ["restrict_client_data", "view_orders", "approve_requisition", "approve_job_orders", "plant_qc", "receive_into_stock", "manage_inventory", "add_schedule"],
};

export async function getRolePermissions(): Promise<RolePermissions> {
  const row = await prisma.appSetting.findUnique({ where: { key: ROLE_PERMISSIONS_KEY } }).catch(() => null);
  const v = row?.value;
  if (!v || typeof v !== "object") return {};
  const out: RolePermissions = {};
  for (const [role, caps] of Object.entries(v as Record<string, unknown>)) {
    if (!caps || typeof caps !== "object") continue;
    const m: Record<string, boolean> = {};
    for (const [k, val] of Object.entries(caps as Record<string, unknown>)) if (ALL_CAPABILITY_KEYS.has(k)) m[k] = val === true;
    out[role] = m;
  }
  return out;
}

/** Replace one role's capability map (only known keys kept). */
export async function setRolePermissionsForRole(role: string, caps: Record<string, boolean>): Promise<void> {
  const current = await getRolePermissions();
  const clean: Record<string, boolean> = {};
  for (const [k, v] of Object.entries(caps)) if (ALL_CAPABILITY_KEYS.has(k)) clean[k] = v === true;
  current[role] = clean;
  await prisma.appSetting.upsert({
    where: { key: ROLE_PERMISSIONS_KEY },
    create: { key: ROLE_PERMISSIONS_KEY, value: current as unknown as Prisma.InputJsonValue },
    update: { value: current as unknown as Prisma.InputJsonValue },
  });
}

/** Whether a capability is on for a role — the stored value, else its default. */
export function roleHasCapability(perms: RolePermissions, role: string, cap: string): boolean {
  const stored = perms[role]?.[cap];
  if (typeof stored === "boolean") return stored;
  return (DEFAULT_ROLE_CAPS[role] ?? []).includes(cap);
}
