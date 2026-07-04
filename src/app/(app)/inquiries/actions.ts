"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getCurrentUser, isAdmin } from "@/lib/auth";
import { findContactOwner } from "@/lib/client-ownership";
import type { InquirySource } from "@prisma/client";

function formatOwnerDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

const itemSchema = z.object({
  rawText: z.string().min(1),
  qty: z.number().int().positive().default(1),
  parsedJson: z.record(z.unknown()).default({}),
});

const createSchema = z.object({
  // Existing customer OR new customer fields.
  customerId: z.string().optional(),
  company: z.string().optional(),
  contactName: z.string().optional(),
  email: z.string().optional(),
  phone: z.string().optional(),
  source: z.enum(["EMAIL", "PHONE", "WALK_IN", "PHOTO", "OTHER"]).default("OTHER"),
  projectName: z.string().optional(),
  notes: z.string().optional(),
  items: z.array(itemSchema).min(1),
});

export async function createInquiry(input: z.infer<typeof createSchema>) {
  const user = await getCurrentUser();
  if (!user) throw new Error("Unauthorized");
  const data = createSchema.parse(input);

  // First-contact authority: a client is identified by (company + person).
  // Whoever made first contact owns the right to assist them, so block a
  // different salesperson from logging an inquiry against a matching pair.
  // Admins are exempt (they arbitrate disputes).
  const contactDetails = data.customerId
    ? await prisma.customer.findUnique({
        where: { id: data.customerId },
        select: { company: true, contactName: true },
      })
    : { company: data.company, contactName: data.contactName };
  if (contactDetails && !isAdmin(user)) {
    const owner = await findContactOwner(contactDetails);
    if (owner && owner.ownerId !== user.id) {
      throw new Error(
        `${owner.contactName} at ${owner.company} is already handled by ${owner.ownerName}, who made first contact on ${formatOwnerDate(owner.at)}. Only ${owner.ownerName} or an admin can log inquiries for this contact.`,
      );
    }
  }

  let customerId = data.customerId;
  if (!customerId) {
    if (!data.company) throw new Error("Customer company is required");
    const customer = await prisma.customer.create({
      data: {
        company: data.company,
        contactName: data.contactName,
        email: data.email,
        phone: data.phone,
      },
    });
    customerId = customer.id;
  }

  const inquiry = await prisma.inquiry.create({
    data: {
      customerId,
      source: data.source as InquirySource,
      status: "DRAFTING",
      createdById: user.id,
      projectName: data.projectName?.trim() || null,
      notes: data.notes,
      items: {
        create: data.items.map((it) => ({
          rawText: it.rawText,
          qty: it.qty,
          parsedJson: it.parsedJson as object,
          status: "PENDING",
        })),
      },
    },
  });

  revalidatePath("/inquiries");
  revalidatePath("/dashboard");
  redirect(`/inquiries/${inquiry.id}`);
}

export async function addInquiryItems(
  inquiryId: string,
  items: z.infer<typeof itemSchema>[],
) {
  const user = await getCurrentUser();
  if (!user) throw new Error("Unauthorized");
  const parsed = z.array(itemSchema).parse(items);

  await prisma.inquiryItem.createMany({
    data: parsed.map((it) => ({
      inquiryId,
      rawText: it.rawText,
      qty: it.qty,
      parsedJson: it.parsedJson as object,
      status: "PENDING",
    })),
  });
  revalidatePath(`/inquiries/${inquiryId}`);
}

export async function updateInquiryItem(
  itemId: string,
  patch: { rawText?: string; qty?: number; parsedJson?: Record<string, unknown>; status?: string },
) {
  const user = await getCurrentUser();
  if (!user) throw new Error("Unauthorized");
  const item = await prisma.inquiryItem.update({
    where: { id: itemId },
    data: {
      rawText: patch.rawText,
      qty: patch.qty,
      parsedJson: patch.parsedJson as object | undefined,
      status: patch.status as never,
    },
  });
  revalidatePath(`/inquiries/${item.inquiryId}`);
}

export async function deleteInquiryItem(itemId: string) {
  const user = await getCurrentUser();
  if (!user) throw new Error("Unauthorized");
  const item = await prisma.inquiryItem.delete({ where: { id: itemId } });
  revalidatePath(`/inquiries/${item.inquiryId}`);
}

export async function setInquiryStatus(inquiryId: string, status: string) {
  const user = await getCurrentUser();
  if (!user) throw new Error("Unauthorized");
  await prisma.inquiry.update({ where: { id: inquiryId }, data: { status: status as never } });
  revalidatePath(`/inquiries/${inquiryId}`);
  revalidatePath("/dashboard");
}

/** Admin-only: delete an inquiry and everything under it (quotations, items, attachments). */
export async function deleteInquiry(inquiryId: string) {
  const user = await getCurrentUser();
  if (!isAdmin(user)) throw new Error("Admin access required");
  // Quotation→Inquiry is Restrict, so remove quotations first (their items
  // cascade); the inquiry delete then cascades its items and attachments.
  await prisma.$transaction([
    prisma.quotation.deleteMany({ where: { inquiryId } }),
    prisma.inquiry.delete({ where: { id: inquiryId } }),
  ]);
  revalidatePath("/dashboard");
  revalidatePath("/inquiries");
}
