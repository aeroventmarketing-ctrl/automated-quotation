"use server";

import { revalidatePath } from "next/cache";
import type { InquirySource } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getCurrentUser, isAdmin } from "@/lib/auth";
import { getInboundQueue, updateInboundItem } from "@/lib/inbound-rfq";
import { getSalespeople } from "@/lib/sales-personnel";
import { downloadFromStorage, uploadToStorage } from "@/lib/storage";
import { addInquiryAssignment } from "@/lib/inquiry-notifications";
import { Prisma } from "@prisma/client";

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
 * message + attachment links, and mark the queue item accepted. Optionally assign
 * the inquiry to a chosen salesperson (its owner / `createdById`); when none is
 * given it's owned by whoever converted it.
 */
export async function createInquiryFromInbound(itemId: string, assigneeId?: string): Promise<{ inquiryId: string }> {
  const user = await assertSales();
  const item = (await getInboundQueue()).find((i) => i.id === itemId);
  if (!item) throw new Error("That inbound message is no longer in the queue.");
  if (item.status !== "pending") throw new Error("That message has already been handled.");

  // Resolve the owner: a chosen salesperson (validated against the salesperson
  // list) or, by default, the person converting it.
  let ownerId = user.id;
  let ownerName = user.name;
  const chosen = (assigneeId ?? "").trim();
  if (chosen && chosen !== user.id) {
    const sales = await getSalespeople();
    const match = sales.find((s) => s.id === chosen);
    if (!match) throw new Error("That salesperson isn't available to assign.");
    ownerId = match.id;
    ownerName = match.name;
  }

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

  // Attachments the client uploaded via the web form carry a Storage path — those
  // become proper RFQ/BOQ documents on the inquiry (viewable / printable /
  // downloadable). Attachments that are only external links (e.g. from an email
  // reply) stay as links in the notes.
  const storable = item.attachments.filter((a) => a.path && a.path.startsWith("rfq-uploads/"));
  const external = item.attachments.filter((a) => !storable.includes(a));

  const attachmentNote = external.length
    ? `\n\nAttachments (from the client's email):\n${external.map((a) => `- ${a.name}: ${a.url}`).join("\n")}`
    : "";
  const notes = `${item.text?.trim() ?? ""}${attachmentNote}`.trim() || null;

  const inquiry = await prisma.inquiry.create({
    data: {
      customerId,
      source: "EMAIL" as InquirySource,
      status: "DRAFTING",
      createdById: ownerId,
      projectName: item.subject?.trim() || null,
      notes,
    },
    select: { id: true },
  });

  // Copy each uploaded RFQ file into the inquiry's own storage so the standard
  // inquiry doc viewer (owner-scoped access) can open it, then record them under
  // the "RFQ / BOQ" document slot.
  if (storable.length) {
    const rfqDocs: { path: string; name: string; uploadedAt: string }[] = [];
    for (const [i, a] of storable.entries()) {
      try {
        const { base64, contentType } = await downloadFromStorage(a.path!);
        const ext = a.name.split(".").pop()?.toLowerCase() || "bin";
        const dest = `inquiries/${inquiry.id}/rfq-${Date.now()}-${i}.${ext}`;
        await uploadToStorage(dest, Buffer.from(base64, "base64"), contentType);
        rfqDocs.push({ path: dest, name: a.name, uploadedAt: new Date().toISOString() });
      } catch (e) {
        console.error("rfq attachment copy failed", a.path, e);
      }
    }
    if (rfqDocs.length) {
      await prisma.inquiry.update({
        where: { id: inquiry.id },
        data: { docs: { rfq_boq: rfqDocs } as unknown as Prisma.InputJsonValue },
      });
    }
  }

  await updateInboundItem(itemId, {
    status: "accepted",
    inquiryId: inquiry.id,
    handledByName: user.name,
    assignedToName: ownerId !== user.id ? ownerName : undefined,
    handledAt: new Date().toISOString(),
  });

  // Notify the assigned salesperson (unless they converted it themselves).
  if (ownerId !== user.id) {
    const customer = await prisma.customer.findUnique({ where: { id: customerId }, select: { company: true } }).catch(() => null);
    await addInquiryAssignment(ownerId, {
      inquiryId: inquiry.id,
      customer: customer?.company || item.fromName || email || "New client",
      fromName: user.name,
      at: new Date().toISOString(),
    });
  }

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
