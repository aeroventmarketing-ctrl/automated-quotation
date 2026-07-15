"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getCurrentUser, isAdmin } from "@/lib/auth";
import { savePaymentTerm, deletePaymentTerm, type PaymentTerm } from "@/lib/payment-terms";

async function assertAdmin() {
  const user = await getCurrentUser();
  if (!user || !isAdmin(user)) throw new Error("Only an admin can manage payment terms.");
}

const termSchema = z.object({
  id: z.string().optional(),
  text: z.string().trim().min(1, "Payment term is required"),
});

export async function savePaymentTermAction(input: z.infer<typeof termSchema>): Promise<PaymentTerm[]> {
  await assertAdmin();
  const d = termSchema.parse(input);
  const list = await savePaymentTerm(d);
  revalidatePath("/admin/payment-terms");
  return list;
}

export async function deletePaymentTermAction(id: string): Promise<PaymentTerm[]> {
  await assertAdmin();
  const list = await deletePaymentTerm(id);
  revalidatePath("/admin/payment-terms");
  return list;
}
