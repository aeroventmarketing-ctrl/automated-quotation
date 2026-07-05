"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { getCurrentUser, isAdmin } from "@/lib/auth";

/** Distinct salespeople (inquiry creators) across a set of customers. */
async function salespeopleFor(customerIds: string[]): Promise<Map<string, string>> {
  const inquiries = await prisma.inquiry.findMany({
    where: { customerId: { in: customerIds } },
    select: { createdBy: { select: { id: true, name: true } } },
  });
  const m = new Map<string, string>();
  for (const i of inquiries) m.set(i.createdBy.id, i.createdBy.name);
  return m;
}

/** Admin: delete a client record along with its inquiries and quotations. */
export async function deleteCustomer(customerId: string) {
  const user = await getCurrentUser();
  if (!isAdmin(user)) throw new Error("Admin access required");

  const inquiries = await prisma.inquiry.findMany({ where: { customerId }, select: { id: true } });
  const inquiryIds = inquiries.map((i) => i.id);

  // Quotation→Inquiry and Quotation→Customer are Restrict, so clear quotations
  // first (their items cascade), then inquiries (items/attachments cascade),
  // then the customer.
  await prisma.$transaction([
    ...(inquiryIds.length ? [prisma.quotation.deleteMany({ where: { inquiryId: { in: inquiryIds } } })] : []),
    prisma.inquiry.deleteMany({ where: { customerId } }),
    prisma.customer.delete({ where: { id: customerId } }),
  ]);

  revalidatePath("/admin/duplicates");
  revalidatePath("/dashboard");
}

/**
 * Admin: merge duplicate clients into one. All inquiries from the duplicates
 * are re-pointed to the kept record, then the emptied duplicates are removed.
 * Only allowed when every record involved belongs to the SAME sales person
 * (or has no inquiries at all), so client ownership is never crossed.
 */
export async function mergeCustomers(keepId: string, duplicateIds: string[]) {
  const user = await getCurrentUser();
  if (!isAdmin(user)) throw new Error("Admin access required");

  const dups = duplicateIds.filter((id) => id && id !== keepId);
  if (dups.length === 0) throw new Error("Pick at least one other record to merge in.");

  const all = [keepId, ...dups];
  const exist = await prisma.customer.findMany({ where: { id: { in: all } }, select: { id: true } });
  if (exist.length !== all.length) throw new Error("One of the selected records no longer exists.");

  // Guard: refuse to merge across different sales personnel.
  const sales = await salespeopleFor(all);
  if (sales.size > 1) {
    throw new Error(
      `Cannot merge — these records belong to different sales personnel (${[...sales.values()].join(", ")}). Only same-owner duplicates can be merged.`,
    );
  }

  await prisma.$transaction([
    prisma.inquiry.updateMany({ where: { customerId: { in: dups } }, data: { customerId: keepId } }),
    prisma.customer.deleteMany({ where: { id: { in: dups } } }),
  ]);

  revalidatePath("/admin/duplicates");
  revalidatePath("/dashboard");
  revalidatePath(`/customers/${keepId}`);
}
