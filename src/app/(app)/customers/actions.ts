"use server";

import { randomUUID } from "crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getCurrentUser, isAdmin } from "@/lib/auth";
import { nextQuoteNumber } from "@/lib/quote";
import { config } from "@/lib/config";
import {
  ensureBuiltinTemplates,
  RETAINED_TEMPLATE_LAYOUT_KEYS,
  sortTemplatesByPickerOrder,
} from "@/lib/ensure-templates";
import {
  getAccountsRegistry,
  saveAccountsRegistry,
  currentOwner,
  type AccountData,
  type ConversationEntry,
} from "@/lib/account";
import { getInquiryDocs, setInquiryDocs } from "@/lib/inquiry-docs-store";
import { saleFromClassification, type SaleDoc } from "@/lib/sale";

/**
 * Transfer a client account to another salesperson. Only the current sales
 * in-charge (or an admin) may do this. The move closes the current assignment
 * (stamping its end date) and opens a new one for the target salesperson.
 *
 * If the account was never explicitly assigned, its history is first seeded
 * from the derived initial owner — the salesperson who created the customer's
 * earliest inquiry, starting from that inquiry's date — so the trail is complete.
 */
export async function transferAccount(customerId: string, toUserId: string) {
  const user = await getCurrentUser();
  if (!user) throw new Error("Unauthorized");
  if (!toUserId) throw new Error("Choose a salesperson to transfer to.");

  const accounts = await getAccountsRegistry();
  let data: AccountData | null = accounts[customerId] ?? null;

  if (!data) {
    const first = await prisma.inquiry.findFirst({
      where: { customerId },
      orderBy: { createdAt: "asc" },
      include: { createdBy: true },
    });
    data = first
      ? {
          history: [
            {
              userId: first.createdById,
              name: first.createdBy.name,
              startedAt: first.createdAt.toISOString(),
              endedAt: null,
            },
          ],
        }
      : { history: [] };
  }

  const owner = currentOwner(data);
  // Only the current sales in-charge or an admin may transfer. When there is no
  // current owner yet (no inquiries), only an admin can assign one.
  if (owner) {
    if (owner.userId !== user.id && !isAdmin(user))
      throw new Error("Only the current sales in-charge or an admin can transfer this account.");
    if (owner.userId === toUserId) throw new Error("That salesperson already holds this account.");
  } else if (!isAdmin(user)) {
    throw new Error("Only an admin can assign a sales in-charge for this account.");
  }

  const to = await prisma.user.findUnique({ where: { id: toUserId }, select: { id: true, name: true } });
  if (!to) throw new Error("Salesperson not found.");

  const now = new Date().toISOString();
  if (owner) owner.endedAt = now; // close the outgoing assignment
  data.history.push({ userId: to.id, name: to.name, startedAt: now, endedAt: null });

  accounts[customerId] = data;
  await saveAccountsRegistry(accounts);
  revalidatePath(`/customers/${customerId}`);
}

/**
 * Transfer a single quotation to a different client. Because a quotation reaches
 * a client only through its inquiry, the quote is re-parented onto a fresh inquiry
 * under the target client — carrying over the original inquiry's source, status
 * (so a won order stays won) and project — leaving the source inquiry and its
 * other quotations untouched. The quote's own follow-up conversation thread moves
 * with it. Admin only.
 */
export async function transferQuotation(quotationId: string, targetCustomerId: string) {
  const user = await getCurrentUser();
  if (!user) throw new Error("Unauthorized");
  if (!isAdmin(user)) throw new Error("Only an admin can transfer a quotation.");
  if (!targetCustomerId) throw new Error("Choose a client to transfer to.");

  const quote = await prisma.quotation.findUnique({
    where: { id: quotationId },
    include: { inquiry: true },
  });
  if (!quote) throw new Error("Quotation not found.");

  const sourceCustomerId = quote.inquiry.customerId;
  if (sourceCustomerId === targetCustomerId) throw new Error("The quotation already belongs to this client.");

  const target = await prisma.customer.findUnique({ where: { id: targetCustomerId }, select: { id: true } });
  if (!target) throw new Error("Target client not found.");

  const accounts = await getAccountsRegistry();
  const srcData: AccountData | null = accounts[sourceCustomerId] ?? null;

  await prisma.$transaction(async (tx) => {
    const inquiry = await tx.inquiry.create({
      data: {
        customerId: targetCustomerId,
        source: quote.inquiry.source,
        status: quote.inquiry.status,
        createdById: quote.inquiry.createdById,
        projectName: quote.projectName ?? quote.inquiry.projectName ?? null,
        notes: quote.inquiry.notes ?? null,
      },
    });
    await tx.quotation.update({ where: { id: quotationId }, data: { inquiryId: inquiry.id } });
  });

  // Move this quote's conversation thread to the target client's account log.
  const moving = (srcData?.conversations ?? []).filter((c) => c.quoteNumber === quote.quoteNumber);
  if (srcData && moving.length) {
    srcData.conversations = (srcData.conversations ?? []).filter((c) => c.quoteNumber !== quote.quoteNumber);
    const tgtData: AccountData = accounts[targetCustomerId] ?? { history: [], conversations: [] };
    tgtData.conversations = [...(tgtData.conversations ?? []), ...moving];
    accounts[sourceCustomerId] = srcData;
    accounts[targetCustomerId] = tgtData;
    await saveAccountsRegistry(accounts);
  }

  revalidatePath(`/customers/${sourceCustomerId}`);
  revalidatePath(`/customers/${targetCustomerId}`);
  revalidatePath("/quotations");
  revalidatePath("/inquiries");
  revalidatePath("/orders");
  redirect(`/customers/${targetCustomerId}`);
}

const uploadedDocSchema = z.object({
  path: z.string().min(1),
  name: z.string().min(1),
  uploadedAt: z.string().optional(),
});

/**
 * Resolve the inquiry a new quotation will attach to (reuse the newest, or create
 * one), returning its id so the RFQ/BOQ can be uploaded under the real inquiry
 * path before the quotation is created.
 */
export async function ensureInquiryForQuotation(customerId: string): Promise<string> {
  const user = await getCurrentUser();
  if (!user) throw new Error("Unauthorized");
  const customer = await prisma.customer.findUnique({ where: { id: customerId }, select: { id: true } });
  if (!customer) throw new Error("Customer not found");
  let inquiry = await prisma.inquiry.findFirst({ where: { customerId }, orderBy: { createdAt: "desc" } });
  if (!inquiry) {
    inquiry = await prisma.inquiry.create({
      data: { customerId, source: "OTHER", status: "DRAFTING", createdById: user.id },
    });
  }
  return inquiry.id;
}

/**
 * Start a new quotation for a client from the profile. Quotations attach to an
 * inquiry, so the newest inquiry is reused (or a fresh one is created if the
 * client has none). A blank DRAFT quote is created on the default Fans and
 * Blowers template and the builder is opened so products can be added.
 *
 * Sales must attach the RFQ / BOQ first: the uploaded document is required and
 * is filed against the inquiry's RFQ/BOQ slot (so it flows through to the
 * quotation's Sale & payment documents).
 */
export async function addQuotation(customerId: string, boqRfq: z.infer<typeof uploadedDocSchema>) {
  const user = await getCurrentUser();
  if (!user) throw new Error("Unauthorized");

  const doc = uploadedDocSchema.parse(boqRfq);
  if (!doc.path) throw new Error("Attach the RFQ / BOQ before adding a quotation.");
  const saleDoc: SaleDoc = { path: doc.path, name: doc.name, uploadedAt: doc.uploadedAt ?? new Date().toISOString() };

  const customer = await prisma.customer.findUnique({ where: { id: customerId }, select: { id: true } });
  if (!customer) throw new Error("Customer not found");

  let inquiry = await prisma.inquiry.findFirst({
    where: { customerId },
    orderBy: { createdAt: "desc" },
  });
  if (!inquiry) {
    inquiry = await prisma.inquiry.create({
      data: { customerId, source: "OTHER", status: "DRAFTING", createdById: user.id },
    });
  }

  // File the uploaded RFQ / BOQ against the inquiry (append to its RFQ/BOQ slot).
  const existingDocs = await getInquiryDocs(inquiry.id);
  await setInquiryDocs(inquiry.id, { ...existingDocs, rfq_boq: [...(existingDocs.rfq_boq ?? []), saleDoc] });

  await ensureBuiltinTemplates();
  const templates = await prisma.quotationTemplate.findMany({
    where: { active: true, layoutKey: { in: [...RETAINED_TEMPLATE_LAYOUT_KEYS] } },
  });
  const template = sortTemplatesByPickerOrder(templates)[0];
  if (!template) throw new Error("No quotation template available — seed templates first.");
  const tplConfig = (template.config as Record<string, unknown>) ?? {};
  const terms = typeof tplConfig.terms === "string" ? tplConfig.terms : null;

  const validUntil = new Date();
  validUntil.setDate(validUntil.getDate() + 7);

  const quotation = await prisma.$transaction(async (tx) => {
    const quoteNumber = await nextQuoteNumber(tx, user.salesCode ?? "");
    return tx.quotation.create({
      data: {
        inquiryId: inquiry!.id,
        quoteNumber,
        templateId: template.id,
        status: "DRAFT",
        vatMode: "INCLUSIVE",
        discountPct: 0,
        headerUnits: { capacity: "cfm", pressure: "in-w.g.", motor: "HP" },
        projectName: inquiry!.projectName ?? undefined,
        subtotal: 0,
        vat: 0,
        total: 0,
        currency: config.defaultCurrency,
        validUntil,
        terms,
        preparedById: user.id,
      },
    });
  });

  revalidatePath(`/customers/${customerId}`);
  redirect(`/quotations/${quotation.id}`);
}

/**
 * Admin-only: permanently delete a quotation from a client's history (removes it
 * from both the Order and Quotation history). Its line items cascade with it.
 */
export async function deleteCustomerQuotation(customerId: string, quotationId: string) {
  const user = await getCurrentUser();
  if (!isAdmin(user)) throw new Error("Only an admin can delete a quotation.");
  const quote = await prisma.quotation.findUnique({ where: { id: quotationId }, select: { id: true } });
  if (!quote) throw new Error("Quotation not found.");
  await prisma.quotation.delete({ where: { id: quotationId } });
  revalidatePath(`/customers/${customerId}`);
  revalidatePath("/quotations");
  revalidatePath("/orders");
  revalidatePath("/dashboard");
}

/**
 * Admin-only: remove a confirmed order — clears the sale record on the quotation
 * so it reverts to a plain quotation (the quotation itself is kept). The inquiry
 * returns to SENT.
 */
export async function clearCustomerOrder(customerId: string, quotationId: string) {
  const user = await getCurrentUser();
  if (!isAdmin(user)) throw new Error("Only an admin can remove an order.");
  const quote = await prisma.quotation.findUnique({
    where: { id: quotationId },
    select: { id: true, inquiryId: true, classification: true },
  });
  if (!quote) throw new Error("Quotation not found.");
  const cls = (quote.classification as Record<string, unknown>) ?? {};
  const { ...rest } = cls;
  delete (rest as Record<string, unknown>).sale;
  await prisma.$transaction([
    prisma.quotation.update({
      where: { id: quotationId },
      data: { classification: rest as unknown as Prisma.InputJsonObject },
    }),
    prisma.inquiry.update({ where: { id: quote.inquiryId }, data: { status: "SENT" } }),
  ]);
  revalidatePath(`/customers/${customerId}`);
  revalidatePath("/orders");
  revalidatePath("/dashboard");
}

/**
 * Remove an inquiry from a client's history. Admin only. Refuses when the inquiry
 * still has quotations (those are real records — transfer or delete them first);
 * its items and attachments are removed with it.
 */
export async function deleteInquiry(inquiryId: string) {
  const user = await getCurrentUser();
  if (!user) throw new Error("Unauthorized");
  if (!isAdmin(user)) throw new Error("Only an admin can remove an inquiry.");

  const inquiry = await prisma.inquiry.findUnique({
    where: { id: inquiryId },
    select: { id: true, customerId: true, _count: { select: { quotations: true } } },
  });
  if (!inquiry) throw new Error("Inquiry not found.");
  if (inquiry._count.quotations > 0)
    throw new Error("This inquiry has quotation(s). Move or remove them before deleting the inquiry.");

  await prisma.inquiry.delete({ where: { id: inquiryId } });
  revalidatePath(`/customers/${inquiry.customerId}`);
  revalidatePath("/inquiries");
}

const customerSchema = z.object({
  company: z.string().min(1, "Company is required"),
  contactName: z.string().optional().default(""),
  email: z.string().optional().default(""),
  phone: z.string().optional().default(""),
  address: z.string().optional().default(""),
  notes: z.string().optional().default(""),
});

/** Update a client's details from the profile. Any signed-in user may edit. */
export async function updateCustomer(customerId: string, input: z.infer<typeof customerSchema>) {
  const user = await getCurrentUser();
  if (!user) throw new Error("Unauthorized");
  const d = customerSchema.parse(input);
  await prisma.customer.update({
    where: { id: customerId },
    data: {
      company: d.company.trim(),
      contactName: d.contactName.trim() || null,
      email: d.email.trim() || null,
      phone: d.phone.trim() || null,
      address: d.address.trim() || null,
      notes: d.notes.trim() || null,
    },
  });
  revalidatePath(`/customers/${customerId}`);
  revalidatePath("/quotations");
  revalidatePath("/inquiries");
}

const conversationSchema = z.object({
  date: z.string().min(1),
  channel: z.string().min(1),
  contactPerson: z.string().optional().default(""),
  message: z.string().min(1, "Message is required"),
  quoteNumber: z.string().optional().default(""),
  nextFollowUp: z.string().optional().default(""),
});

/**
 * Log a conversation / follow-up with the client. Any signed-in user can add
 * one; it is stamped with who logged it and when, so follow-up activity per
 * salesperson can be monitored.
 */
export async function addConversation(customerId: string, input: z.infer<typeof conversationSchema>) {
  const user = await getCurrentUser();
  if (!user) throw new Error("Unauthorized");
  const d = conversationSchema.parse(input);

  const accounts = await getAccountsRegistry();
  const data: AccountData = accounts[customerId] ?? { history: [], conversations: [] };
  const entry: ConversationEntry = {
    id: randomUUID(),
    date: d.date,
    channel: d.channel,
    contactPerson: d.contactPerson.trim(),
    message: d.message.trim(),
    quoteNumber: d.quoteNumber.trim() || null,
    nextFollowUp: d.nextFollowUp.trim() || null,
    loggedById: user.id,
    loggedByName: user.name,
    createdAt: new Date().toISOString(),
  };
  data.conversations = [...(data.conversations ?? []), entry];
  accounts[customerId] = data;
  await saveAccountsRegistry(accounts);
  revalidatePath(`/customers/${customerId}`);
}

/**
 * Pause or resume automatic follow-ups for one client. When paused (opt-out on),
 * the scheduler and the Follow-ups list skip this customer entirely. Any signed-in
 * user can change it; the flag rides in the account registry (no schema change).
 */
export async function setFollowUpOptOut(customerId: string, optOut: boolean): Promise<boolean> {
  const user = await getCurrentUser();
  if (!user) throw new Error("Unauthorized");
  const accounts = await getAccountsRegistry();
  const data: AccountData = accounts[customerId] ?? { history: [], conversations: [] };
  data.optOutFollowUp = optOut;
  accounts[customerId] = data;
  await saveAccountsRegistry(accounts);
  revalidatePath(`/customers/${customerId}`);
  revalidatePath("/follow-ups");
  return optOut;
}

/**
 * Admin-only: mark a client as a "terms" client (or clear it). A terms client
 * can confirm a sale — and enable "Save sale" — with only the Purchase Order
 * attached; a regular client must submit all core documents first. The flag
 * rides in the account registry (no schema change).
 */
export async function setCustomerTerms(customerId: string, terms: boolean): Promise<boolean> {
  const user = await getCurrentUser();
  if (!isAdmin(user)) throw new Error("Only an admin can change a client's terms setting.");
  const accounts = await getAccountsRegistry();
  const data: AccountData = accounts[customerId] ?? { history: [], conversations: [] };
  data.terms = terms;
  accounts[customerId] = data;
  await saveAccountsRegistry(accounts);
  revalidatePath(`/customers/${customerId}`);
  return terms;
}

/** Remove a logged conversation. The person who logged it, or an admin, may delete it. */
export async function deleteConversation(customerId: string, conversationId: string) {
  const user = await getCurrentUser();
  if (!user) throw new Error("Unauthorized");
  const accounts = await getAccountsRegistry();
  const data = accounts[customerId];
  if (!data?.conversations?.length) return;
  const target = data.conversations.find((c) => c.id === conversationId);
  if (!target) return;
  if (target.loggedById !== user.id && !isAdmin(user))
    throw new Error("Only the person who logged this, or an admin, can delete it.");
  data.conversations = data.conversations.filter((c) => c.id !== conversationId);
  accounts[customerId] = data;
  await saveAccountsRegistry(accounts);
  revalidatePath(`/customers/${customerId}`);
}
