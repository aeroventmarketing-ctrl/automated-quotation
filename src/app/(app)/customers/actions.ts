"use server";

import { randomUUID } from "crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
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
 * Start a new quotation for a client from the profile. Quotations attach to an
 * inquiry, so the newest inquiry is reused (or a fresh one is created if the
 * client has none). A blank DRAFT quote is created on the default Fans and
 * Blowers template and the builder is opened so products can be added.
 */
export async function addQuotation(customerId: string) {
  const user = await getCurrentUser();
  if (!user) throw new Error("Unauthorized");

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
