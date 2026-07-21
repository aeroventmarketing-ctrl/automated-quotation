"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getCurrentUser, isAdmin } from "@/lib/auth";
import { findContactOwner } from "@/lib/client-ownership";
import { setInquiryDocs } from "@/lib/inquiry-docs-store";
import type { InquirySource } from "@prisma/client";

const inquiryDocSchema = z.object({ path: z.string(), name: z.string(), uploadedAt: z.string() });

/** Save the pre-quotation documents (Inquiry Form, RFQ/BOQ) attached to an inquiry. */
export async function saveInquiryDocs(inquiryId: string, docs: Record<string, z.infer<typeof inquiryDocSchema>[]>): Promise<void> {
  const user = await getCurrentUser();
  if (!user) throw new Error("Unauthorized");
  const inq = await prisma.inquiry.findUnique({ where: { id: inquiryId }, select: { createdById: true } });
  if (!inq) throw new Error("Inquiry not found");
  if (inq.createdById !== user.id && !isAdmin(user)) throw new Error("Only the inquiry's owner or an admin can attach documents.");
  const clean = z.record(z.array(inquiryDocSchema)).parse(docs);
  await setInquiryDocs(inquiryId, clean);
  revalidatePath(`/inquiries/${inquiryId}`);
}

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
  // Line items are optional at creation — they can be added later in the
  // inquiry workspace (e.g. via the RFQ AI import).
  items: z.array(itemSchema).default([]),
});

export async function createInquiry(input: z.infer<typeof createSchema>) {
  const user = await getCurrentUser();
  if (!user) throw new Error("Unauthorized");
  const data = createSchema.parse(input);

  // First-contact authority: a client is identified by the company name plus at
  // least one of (contact person, number, email). Whoever made first contact
  // owns the right to assist them.
  const contactDetails = data.customerId
    ? await prisma.customer.findUnique({
        where: { id: data.customerId },
        select: { company: true, contactName: true, phone: true, email: true },
      })
    : { company: data.company, contactName: data.contactName, phone: data.phone, email: data.email };
  const owner = contactDetails ? await findContactOwner(contactDetails) : null;

  // Block a different salesperson from logging an inquiry against a matching
  // client. Admins are exempt (they arbitrate disputes).
  if (owner && owner.ownerId !== user.id && !isAdmin(user)) {
    throw new Error(
      `${owner.contactName} at ${owner.company} is already handled by ${owner.ownerName}, who made first contact on ${formatOwnerDate(owner.at)}. Only ${owner.ownerName} or an admin can log inquiries for this contact.`,
    );
  }

  let customerId = data.customerId;
  if (!customerId) {
    if (!data.company?.trim()) throw new Error("Customer company is required");
    if (!data.contactName?.trim()) throw new Error("Contact name is required");
    if (!data.email?.trim() && !data.phone?.trim())
      throw new Error("A contact number or an email address is required");
    if (owner) {
      // The typed company + contact already exists — attach this inquiry to the
      // existing customer instead of creating a duplicate record.
      customerId = owner.customerId;
    } else {
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
