"use server";

import { revalidatePath } from "next/cache";
import type { InquirySource } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getCurrentUser, isAdmin } from "@/lib/auth";
import { getInboundQueue, updateInboundItem } from "@/lib/inbound-rfq";

async function assertSales() {
  const user = await getCurrentUser();
  if (!user || !(isAdmin(user) || user.role === "SALES" || user.role === "ENGINEER")) {
    throw new Error("You don't have access to the RFQ queue.");
  }
  return user;
}

/**
 * Turn a queued inbound RFQ into an Inquiry: match the sender's email to an
 * existing client (or create one), create the inquiry (source Email) carrying the
 * message + attachment links, and mark the queue item accepted.
 */
export async function createInquiryFromInbound(itemId: string): Promise<{ inquiryId: string }> {
  const user = await assertSales();
  const item = (await getInboundQueue()).find((i) => i.id === itemId);
  if (!item) throw new Error("That inbound message is no longer in the queue.");
  if (item.status !== "pending") throw new Error("That message has already been handled.");

  // Match the sender to an existing client by email, else create a new one.
  const email = item.fromEmail.trim();
  const existing = email
    ? await prisma.customer.findFirst({ where: { email: { equals: email, mode: "insensitive" } }, select: { id: true } })
    : null;
  let customerId = existing?.id;
  if (!customerId) {
    const created = await prisma.customer.create({
      data: {
        company: item.fromName?.trim() || email || "New inbound client",
        contactName: item.fromName?.trim() || null,
        email: email || null,
      },
    });
    customerId = created.id;
  }

  const attachmentNote = item.attachments.length
    ? `\n\nAttachments (from the client's email):\n${item.attachments.map((a) => `- ${a.name}: ${a.url}`).join("\n")}`
    : "";
  const notes = `${item.text?.trim() ?? ""}${attachmentNote}`.trim() || null;

  const inquiry = await prisma.inquiry.create({
    data: {
      customerId,
      source: "EMAIL" as InquirySource,
      status: "DRAFTING",
      createdById: user.id,
      projectName: item.subject?.trim() || null,
      notes,
    },
    select: { id: true },
  });

  await updateInboundItem(itemId, {
    status: "accepted",
    inquiryId: inquiry.id,
    handledByName: user.name,
    handledAt: new Date().toISOString(),
  });

  revalidatePath("/inbound-rfq");
  revalidatePath("/inquiries");
  return { inquiryId: inquiry.id };
}

/** Dismiss a queued inbound message (not an RFQ / spam). */
export async function dismissInboundItem(itemId: string): Promise<void> {
  const user = await assertSales();
  const item = (await getInboundQueue()).find((i) => i.id === itemId);
  if (!item) return;
  if (item.status !== "pending") return;
  await updateInboundItem(itemId, { status: "dismissed", handledByName: user.name, handledAt: new Date().toISOString() });
  revalidatePath("/inbound-rfq");
}
