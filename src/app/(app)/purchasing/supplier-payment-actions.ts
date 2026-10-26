"use server";

import { revalidatePath } from "next/cache";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db";
import { getCurrentUser, isAdmin } from "@/lib/auth";
import { getWorkflowRoles, userHasWorkflowRole, type WorkflowRoleKey } from "@/lib/workflow-roles";
import { coerceSupplierPayments, type SupplierPayment, type SupplierPaymentProof } from "@/lib/supplier-payments";

/**
 * Record / remove a payment made to a supplier against a PO — see
 * `lib/supplier-payments`. The Purchaser, Accounting, the Payment Approver or an
 * admin. A record only: no step, status or gate moves.
 *
 * Raw SQL, because the column is deliberately not in the Prisma model (see
 * migration 0061). Before that migration is applied the write fails, and the
 * user is told to apply it rather than shown a database error.
 */
const MIGRATION_HINT = "Supplier payments aren't set up yet — apply migration 0061_supplier_payments in Supabase, then try again.";

async function allowed(): Promise<{ name: string } | { error: string }> {
  const user = await getCurrentUser();
  if (!user) return { error: "Unauthorized." };
  if (isAdmin(user)) return { name: user.name };
  const roles = await getWorkflowRoles();
  const ok = (["purchaser", "accounting", "payment_approver"] as WorkflowRoleKey[]).some((r) => userHasWorkflowRole(roles, user.id, r));
  return ok ? { name: user.name } : { error: "Only the Purchaser, Accounting, the Payment Approver or an admin can record supplier payments." };
}

async function revalidateFor(prId: string) {
  revalidatePath("/purchasing");
  const pr = await prisma.purchaseRequest.findUnique({ where: { id: prId }, select: { quotationId: true } }).catch(() => null);
  if (pr?.quotationId) revalidatePath(`/orders/${pr.quotationId}`);
}

export async function addSupplierPayment(
  prId: string,
  input: { amount: number; date: string; note?: string; proof?: SupplierPaymentProof | null },
): Promise<{ ok?: true; error?: string }> {
  const who = await allowed();
  if ("error" in who) return { error: who.error };
  const amount = Math.round(Number(input.amount) * 100) / 100;
  if (!(amount > 0)) return { error: "Enter the amount paid." };
  const date = String(input.date ?? "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { error: "Enter the date it was paid." };
  const proof = input.proof && typeof input.proof.path === "string" && input.proof.path.startsWith(`purchases/${prId}/`)
    ? { path: input.proof.path, name: input.proof.name || "proof", uploadedAt: input.proof.uploadedAt || new Date().toISOString() }
    : null;
  const entry: SupplierPayment = {
    id: randomUUID(), amount, date, ...(input.note?.trim() ? { note: input.note.trim().slice(0, 500) } : {}),
    proof, byName: who.name, at: new Date().toISOString(),
  };
  try {
    // Appended in one statement, so two people recording at once both land.
    const n = await prisma.$executeRaw`
      update "PurchaseRequest"
         set "supplierPayments" = coalesce("supplierPayments", '[]'::jsonb) || jsonb_build_array(${JSON.stringify(entry)}::jsonb)
       where "id" = ${prId}
    `;
    if (n === 0) return { error: "Purchase order not found." };
  } catch {
    return { error: MIGRATION_HINT };
  }
  await revalidateFor(prId);
  return { ok: true };
}

export async function removeSupplierPayment(prId: string, paymentId: string): Promise<{ ok?: true; error?: string }> {
  const who = await allowed();
  if ("error" in who) return { error: who.error };
  try {
    const n = await prisma.$executeRaw`
      update "PurchaseRequest"
         set "supplierPayments" = coalesce((
           select jsonb_agg(e) from jsonb_array_elements(coalesce("supplierPayments", '[]'::jsonb)) e
            where e->>'id' <> ${paymentId}
         ), '[]'::jsonb)
       where "id" = ${prId}
    `;
    if (n === 0) return { error: "Purchase order not found." };
  } catch {
    return { error: MIGRATION_HINT };
  }
  await revalidateFor(prId);
  return { ok: true };
}
