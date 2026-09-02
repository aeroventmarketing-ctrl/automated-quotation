"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { isAdmin } from "@/lib/auth";
import { logActivity } from "@/lib/activity-log";
import { applyStockChange } from "@/lib/inventory";
import { round2 } from "@/lib/quote";
import { getCounterSaleViewer } from "@/lib/counter-sale-access";
import { getSalesPersonnelIds } from "@/lib/sales-personnel";
import {
  counterTotals,
  coerceCounterDocs,
  coerceCounterPayments,
  coerceCounterVatMode,
  counterFileSlots,
  formatCounterSaleNumber,
  isCashMethod,
  PAYMENT_METHODS,
  type CounterSaleVatMode,
} from "@/lib/counter-sale";
import type { SaleDoc, SalePayment } from "@/lib/sale";

async function requireViewer() {
  const { user, allowed } = await getCounterSaleViewer();
  if (!user) throw new Error("Unauthorized");
  if (!allowed) throw new Error("You don't have access to Counter Sales.");
  return user;
}

const num = (v: unknown): number => {
  const n = Number(String(v ?? "").replace(/,/g, "").trim());
  return Number.isFinite(n) ? n : 0;
};

export interface CounterSaleItemInput {
  stockItemId?: string | null;
  description: string;
  unit?: string;
  qty: number;
  unitPrice: number;
}
export interface CounterSaleInput {
  customerId?: string; // existing customer
  newCustomer?: { company: string; contactName?: string; email?: string; phone?: string; address?: string };
  vatMode: CounterSaleVatMode;
  salespersonId?: string | null;
  paymentMethod: string;
  notes?: string;
  items: CounterSaleItemInput[];
}

function cleanItems(items: CounterSaleItemInput[]): { stockItemId: string | null; description: string; unit: string; qty: number; unitPrice: number; lineTotal: number; sortOrder: number }[] {
  return (items ?? [])
    .map((it) => ({
      stockItemId: it.stockItemId || null,
      description: (it.description ?? "").trim(),
      unit: (it.unit ?? "pcs").trim() || "pcs",
      qty: num(it.qty),
      unitPrice: num(it.unitPrice),
    }))
    .filter((it) => it.description !== "" && it.qty > 0)
    .map((it, i) => ({ ...it, lineTotal: Math.round(it.qty * it.unitPrice * 100) / 100, sortOrder: i }));
}

/** Resolve the customer id — reuse an existing one or create a new lightweight record. */
async function resolveCustomer(tx: Prisma.TransactionClient, input: CounterSaleInput): Promise<string> {
  if (input.customerId) {
    const c = await tx.customer.findUnique({ where: { id: input.customerId }, select: { id: true } });
    if (!c) throw new Error("Selected customer not found.");
    return c.id;
  }
  const nc = input.newCustomer;
  if (!nc || !nc.company.trim()) throw new Error("Enter the client's company or name.");
  const created = await tx.customer.create({
    data: {
      company: nc.company.trim(),
      contactName: nc.contactName?.trim() || null,
      email: nc.email?.trim() || null,
      phone: nc.phone?.trim() || null,
      address: nc.address?.trim() || null,
    },
    select: { id: true },
  });
  return created.id;
}

/** Create a draft counter sale and open it. The number is claimed on completion. */
export async function createCounterSale(input: CounterSaleInput): Promise<void> {
  const user = await requireViewer();
  const vatMode: CounterSaleVatMode = coerceCounterVatMode(input.vatMode);
  if (!PAYMENT_METHODS.some((m) => m.key === input.paymentMethod)) throw new Error("Choose a payment method.");
  const items = cleanItems(input.items);
  if (items.length === 0) throw new Error("Add at least one item to sell.");
  const totals = counterTotals(items, vatMode);

  let salespersonName: string | null = null;
  if (input.salespersonId) {
    const sp = await prisma.user.findUnique({ where: { id: input.salespersonId }, select: { name: true } });
    salespersonName = sp?.name ?? null;
  } else if (user.role === "SALES" || (await getSalesPersonnelIds()).includes(user.id)) {
    // Default the credited salesperson to the recording user when they can be
    // credited on sales (a SALES role, or flagged sales personnel).
    input.salespersonId = user.id;
    salespersonName = user.name;
  }

  const id = await prisma.$transaction(async (tx) => {
    const customerId = await resolveCustomer(tx, input);
    const sale = await tx.counterSale.create({
      data: {
        customerId,
        vatMode,
        status: "DRAFT",
        soldById: user.id,
        soldByName: user.name,
        salespersonId: input.salespersonId ?? null,
        salespersonName,
        subtotal: totals.subtotal,
        vat: totals.vat,
        total: totals.total,
        amountPaid: 0,
        paymentMethod: input.paymentMethod,
        notes: input.notes?.trim() || null,
        items: { create: items },
      },
      select: { id: true },
    });
    return sale.id;
  });

  revalidatePath("/counter-sales");
  redirect(`/counter-sales/${id}`);
}

/** Edit a draft sale (customer stays; items / vat / payment / notes). Draft only. */
export async function updateCounterSale(id: string, input: Omit<CounterSaleInput, "customerId" | "newCustomer">): Promise<void> {
  const user = await requireViewer();
  const sale = await prisma.counterSale.findUnique({ where: { id }, select: { status: true } });
  if (!sale) throw new Error("Sale not found.");
  if (sale.status !== "DRAFT") throw new Error("Only a draft sale can be edited.");
  const vatMode: CounterSaleVatMode = coerceCounterVatMode(input.vatMode);
  if (!PAYMENT_METHODS.some((m) => m.key === input.paymentMethod)) throw new Error("Choose a payment method.");
  const items = cleanItems(input.items);
  if (items.length === 0) throw new Error("Add at least one item to sell.");
  const totals = counterTotals(items, vatMode);

  await prisma.$transaction(async (tx) => {
    await tx.counterSaleItem.deleteMany({ where: { saleId: id } });
    await tx.counterSale.update({
      where: { id },
      data: {
        vatMode,
        paymentMethod: input.paymentMethod,
        salespersonId: input.salespersonId ?? null,
        notes: input.notes?.trim() || null,
        subtotal: totals.subtotal,
        vat: totals.vat,
        total: totals.total,
        items: { create: items },
      },
    });
  });
  revalidatePath(`/counter-sales/${id}`);
  revalidatePath("/counter-sales");
}

const COMMISSION_RATE_PCT = 1.5;

/**
 * Create the sales-commission row for a completed counter sale (idempotent —
 * never overwrites an existing one). Only when a salesperson is credited; the
 * rate matches order commissions (1.5%). Guarded so a missing table can't block
 * completing the sale.
 */
async function ensureCounterSaleCommission(saleId: string): Promise<void> {
  try {
    const s = await prisma.counterSale.findUnique({
      where: { id: saleId },
      select: { status: true, salespersonId: true, salespersonName: true, total: true, completedAt: true },
    });
    if (!s || s.status !== "COMPLETED" || !s.salespersonId) return;
    const orderValue = Number(s.total);
    const amount = round2((orderValue * COMMISSION_RATE_PCT) / 100);
    const at = s.completedAt ?? new Date();
    const salesMonth = `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, "0")}`;
    await prisma.commission.upsert({
      where: { counterSaleId_kind: { counterSaleId: saleId, kind: "base" } },
      create: { counterSaleId: saleId, salespersonId: s.salespersonId, salespersonName: s.salespersonName ?? "", orderValue, ratePct: COMMISSION_RATE_PCT, amount, salesMonth },
      update: {},
    });
  } catch {
    // Commission table not set up yet — the sale still completes.
  }
}

/**
 * Claim the next counter-sale sequence within a transaction. When yearly reset is
 * enabled (admin setting) the sequence restarts at 1 the first time a sale is
 * completed in a new year; otherwise it runs continuously.
 */
async function nextCounterSeq(tx: Prisma.TransactionClient, year: number): Promise<number> {
  const KEY = "counter_sale_counter";
  const row = await tx.appSetting.findUnique({ where: { key: KEY } });
  const v = (row?.value ?? {}) as { n?: unknown; year?: unknown; resetYearly?: unknown };
  const resetYearly = v.resetYearly === true;
  const cur = typeof v.n === "number" ? v.n : 0;
  const storedYear = typeof v.year === "number" ? v.year : year;
  // Roll over to 1 when the year changes and yearly reset is on.
  const base = resetYearly && storedYear !== year ? 0 : cur;
  const n = base + 1;
  await tx.appSetting.upsert({
    where: { key: KEY },
    create: { key: KEY, value: { n, year, resetYearly } as Prisma.InputJsonValue },
    update: { value: { n, year, resetYearly } as Prisma.InputJsonValue },
  });
  return n;
}

/**
 * Complete a draft sale: claim the number, deduct the sold quantities from stock
 * and mark it paid. Blocks if any inventory line exceeds on-hand stock unless an
 * admin passes `overrideStock` (which lets the on-hand go negative). Cash is
 * cleared immediately; a non-cash payment starts uncleared.
 */
export async function completeCounterSale(id: string, opts?: { overrideStock?: boolean }): Promise<void> {
  const user = await requireViewer();
  const admin = isAdmin(user);
  const sale = await prisma.counterSale.findUnique({ where: { id }, include: { items: true } });
  if (!sale) throw new Error("Sale not found.");
  if (sale.status !== "DRAFT") throw new Error("This sale is already completed or void.");
  if (sale.items.length === 0) throw new Error("Add at least one item before completing.");

  // Pre-check stock so the message can name the short items and offer override.
  const stockLines = sale.items.filter((i) => i.stockItemId);
  const shortfalls: string[] = [];
  for (const it of stockLines) {
    const item = await prisma.stockItem.findUnique({ where: { id: it.stockItemId! }, select: { name: true, unit: true, quantity: true } });
    if (item && num(it.qty) > Number(item.quantity)) {
      shortfalls.push(`${item.name} (need ${num(it.qty)}, ${Number(item.quantity)} on hand)`);
    }
  }
  const override = !!opts?.overrideStock && admin;
  if (shortfalls.length > 0 && !override) {
    throw new Error(`Not enough stock for: ${shortfalls.join("; ")}. ${admin ? "Use admin override to proceed." : "Ask an admin to override, or adjust the quantities."}`);
  }

  const totals = counterTotals(
    sale.items.map((i) => ({ qty: Number(i.qty), unitPrice: Number(i.unitPrice), lineTotal: Number(i.lineTotal) })),
    sale.vatMode as CounterSaleVatMode,
  );
  const cash = isCashMethod(sale.paymentMethod);
  const now = new Date();

  const saleNumber = await prisma.$transaction(async (tx) => {
    const seq = await nextCounterSeq(tx, now.getFullYear());
    const number = formatCounterSaleNumber(now.getFullYear(), seq);
    for (const it of stockLines) {
      const qty = Number(it.qty);
      if (qty <= 0) continue;
      if (override) {
        // Admin override — allow the on-hand to go negative.
        const item = await tx.stockItem.findUnique({ where: { id: it.stockItemId! } });
        if (!item) continue;
        const balanceAfter = Math.round((Number(item.quantity) - qty) * 1000) / 1000;
        await tx.stockItem.update({ where: { id: item.id }, data: { quantity: balanceAfter } });
        await tx.stockMovement.create({ data: { stockItemId: item.id, kind: "ISSUE", delta: -qty, balanceAfter, reason: `Counter sale ${number}`, byName: user.name } });
      } else {
        await applyStockChange(tx, { stockItemId: it.stockItemId!, kind: "ISSUE", qty, reason: `Counter sale ${number}` }, user.name);
      }
    }
    await tx.counterSale.update({
      where: { id },
      data: {
        saleNumber: number,
        status: "COMPLETED",
        completedAt: now,
        subtotal: totals.subtotal,
        vat: totals.vat,
        total: totals.total,
        amountPaid: totals.total,
        paymentCleared: cash,
        clearedByName: cash ? user.name : null,
        clearedAt: cash ? now : null,
      },
    });
    return number;
  });

  await ensureCounterSaleCommission(id);
  await logActivity(user, {
    action: "counter_sale.complete",
    category: "order",
    summary: `Counter sale ${saleNumber} completed`,
    entity: "counter_sale",
    entityId: id,
    href: `/counter-sales/${id}`,
  });
  revalidatePath(`/counter-sales/${id}`);
  revalidatePath("/counter-sales");
  revalidatePath("/inventory");
  revalidatePath("/commissions");
  revalidatePath("/management");
}

/** Mark a non-cash payment cleared (the money has landed). */
export async function markCounterPaymentCleared(id: string): Promise<void> {
  const user = await requireViewer();
  const sale = await prisma.counterSale.findUnique({ where: { id }, select: { status: true, paymentCleared: true } });
  if (!sale) throw new Error("Sale not found.");
  if (sale.status !== "COMPLETED") throw new Error("Only a completed sale's payment can be cleared.");
  if (sale.paymentCleared) return;
  await prisma.counterSale.update({ where: { id }, data: { paymentCleared: true, clearedByName: user.name, clearedAt: new Date() } });
  revalidatePath(`/counter-sales/${id}`);
  revalidatePath("/counter-sales");
}

/** Set / clear the expected clearing date for a post-dated / non-cash payment. */
export async function setCounterPaymentDue(id: string, dueAt: string | null): Promise<void> {
  await requireViewer();
  const clean = (dueAt ?? "").trim();
  const due = /^\d{4}-\d{2}-\d{2}$/.test(clean) ? new Date(clean) : null;
  await prisma.counterSale.update({ where: { id }, data: { paymentDueAt: due } });
  revalidatePath(`/counter-sales/${id}`);
}

/** Void a sale (admin only). A completed sale returns its stock to inventory. */
export async function voidCounterSale(id: string): Promise<void> {
  const user = await requireViewer();
  if (!isAdmin(user)) throw new Error("Only an admin can void a counter sale.");
  const sale = await prisma.counterSale.findUnique({ where: { id }, include: { items: true } });
  if (!sale) throw new Error("Sale not found.");
  if (sale.status === "VOID") return;
  const wasCompleted = sale.status === "COMPLETED";
  await prisma.$transaction(async (tx) => {
    if (wasCompleted) {
      for (const it of sale.items) {
        if (!it.stockItemId) continue;
        const qty = Number(it.qty);
        if (qty <= 0) continue;
        await applyStockChange(tx, { stockItemId: it.stockItemId, kind: "RECEIPT", qty, reason: `Void counter sale ${sale.saleNumber ?? ""}`.trim() }, user.name);
      }
    }
    await tx.counterSale.update({ where: { id }, data: { status: "VOID", voidedByName: user.name, voidedAt: new Date() } });
    // Drop any commission generated for this sale (unless already paid out).
    await tx.commission.deleteMany({ where: { counterSaleId: id, paid: false } });
  });
  await logActivity(user, {
    action: "counter_sale.void",
    category: "order",
    summary: `Counter sale ${sale.saleNumber ?? "(draft)"} voided`,
    entity: "counter_sale",
    entityId: id,
    href: `/counter-sales/${id}`,
  });
  revalidatePath(`/counter-sales/${id}`);
  revalidatePath("/counter-sales");
  revalidatePath("/inventory");
}

/** Record an uploaded document against a slot (Sales Invoice / DR / AF / …). */
export async function addCounterSaleDoc(id: string, slotKey: string, doc: SaleDoc): Promise<void> {
  await requireViewer();
  if (!doc || typeof doc.path !== "string" || !doc.path) throw new Error("No file uploaded.");
  const sale = await prisma.counterSale.findUnique({ where: { id }, select: { docs: true, vatMode: true, status: true } });
  if (!sale) throw new Error("Sale not found.");
  if (sale.status === "VOID") throw new Error("This sale is void.");
  const slots = counterFileSlots(sale.vatMode as CounterSaleVatMode);
  if (!slots.some((s) => s.key === slotKey)) throw new Error("Unknown document slot.");
  const docs = coerceCounterDocs(sale.docs);
  docs[slotKey] = [...(docs[slotKey] ?? []), { path: doc.path, name: doc.name, uploadedAt: doc.uploadedAt || new Date().toISOString() }];
  await prisma.counterSale.update({ where: { id }, data: { docs: docs as unknown as Prisma.InputJsonValue } });
  revalidatePath(`/counter-sales/${id}`);
}

/** Remove a document from a slot. */
export async function removeCounterSaleDoc(id: string, slotKey: string, path: string): Promise<void> {
  await requireViewer();
  const sale = await prisma.counterSale.findUnique({ where: { id }, select: { docs: true } });
  if (!sale) throw new Error("Sale not found.");
  const docs = coerceCounterDocs(sale.docs);
  if (docs[slotKey]) {
    docs[slotKey] = docs[slotKey].filter((d) => d.path !== path);
    if (docs[slotKey].length === 0) delete docs[slotKey];
  }
  await prisma.counterSale.update({ where: { id }, data: { docs: docs as unknown as Prisma.InputJsonValue } });
  revalidatePath(`/counter-sales/${id}`);
}

/**
 * Save the Payments Collected list — the collections against this sale with
 * their proof of payment attached (deposit slip / transfer confirmation / check
 * photo). The same list an order carries, so a walk-in payment is evidenced the
 * same way a manufactured order's is.
 *
 * The list is a RECORD of what was collected. It deliberately does NOT rewrite
 * `amountPaid` — that is the figure booked when the sale was completed and it
 * feeds the sales report; a proof attached afterwards must not silently restate
 * the takings. The panel shows both, so a mismatch is visible rather than merged.
 */
export async function saveCounterSalePayments(id: string, payments: SalePayment[]): Promise<void> {
  await requireViewer();
  const sale = await prisma.counterSale.findUnique({ where: { id }, select: { status: true } });
  if (!sale) throw new Error("Sale not found.");
  if (sale.status === "VOID") throw new Error("This sale is void.");
  const clean = coerceCounterPayments(payments);
  await prisma.counterSale.update({ where: { id }, data: { payments: clean as unknown as Prisma.InputJsonValue } });
  revalidatePath(`/counter-sales/${id}`);
}

/**
 * Admin: edit a sale's lines / payment / salesperson / notes on ANY status.
 * A COMPLETED sale is re-booked: its old stock is returned and its (unpaid)
 * commission dropped, the lines are replaced, then stock is re-deducted and the
 * commission re-computed against the new total — keeping the same sale number.
 * A VOID sale keeps its returned stock (edits are display/records only); a DRAFT
 * edits like the normal editor.
 */
export async function adminEditCounterSale(id: string, input: Omit<CounterSaleInput, "customerId" | "newCustomer">): Promise<void> {
  const user = await requireViewer();
  if (!isAdmin(user)) throw new Error("Only an admin can edit a finalized sale.");
  const sale = await prisma.counterSale.findUnique({ where: { id }, include: { items: true } });
  if (!sale) throw new Error("Sale not found.");
  const vatMode: CounterSaleVatMode = coerceCounterVatMode(input.vatMode);
  if (!PAYMENT_METHODS.some((m) => m.key === input.paymentMethod)) throw new Error("Choose a payment method.");
  const items = cleanItems(input.items);
  if (items.length === 0) throw new Error("Add at least one item to sell.");
  const totals = counterTotals(items, vatMode);
  const wasCompleted = sale.status === "COMPLETED";

  await prisma.$transaction(async (tx) => {
    if (wasCompleted) {
      // Return the previously-sold stock and drop the (unpaid) commission so we
      // can re-book against the edited lines.
      for (const it of sale.items) {
        if (!it.stockItemId) continue;
        const qty = Number(it.qty);
        if (qty > 0) await applyStockChange(tx, { stockItemId: it.stockItemId, kind: "RECEIPT", qty, reason: `Edit counter sale ${sale.saleNumber ?? ""}`.trim() }, user.name);
      }
      await tx.commission.deleteMany({ where: { counterSaleId: id, paid: false } });
    }
    await tx.counterSaleItem.deleteMany({ where: { saleId: id } });
    await tx.counterSale.update({
      where: { id },
      data: {
        vatMode,
        paymentMethod: input.paymentMethod,
        salespersonId: input.salespersonId ?? null,
        notes: input.notes?.trim() || null,
        subtotal: totals.subtotal,
        vat: totals.vat,
        total: totals.total,
        ...(wasCompleted ? { amountPaid: totals.total } : {}),
        items: { create: items },
      },
    });
    if (wasCompleted) {
      for (const it of items) {
        if (!it.stockItemId) continue;
        const qty = Number(it.qty);
        if (qty > 0) await applyStockChange(tx, { stockItemId: it.stockItemId, kind: "ISSUE", qty, reason: `Counter sale ${sale.saleNumber ?? ""} (edited)`.trim() }, user.name);
      }
    }
  });
  if (wasCompleted) await ensureCounterSaleCommission(id);
  revalidatePath(`/counter-sales/${id}`);
  revalidatePath("/counter-sales");
  revalidatePath("/inventory");
  revalidatePath("/commissions");
  revalidatePath("/management");
}

/**
 * Admin: permanently delete a sale on ANY status. A COMPLETED sale returns its
 * stock to inventory first; its items and commission cascade-delete with the row.
 */
export async function adminDeleteCounterSale(id: string): Promise<void> {
  const user = await requireViewer();
  if (!isAdmin(user)) throw new Error("Only an admin can delete a counter sale.");
  const sale = await prisma.counterSale.findUnique({ where: { id }, include: { items: true } });
  if (!sale) throw new Error("Sale not found.");
  await prisma.$transaction(async (tx) => {
    if (sale.status === "COMPLETED") {
      for (const it of sale.items) {
        if (!it.stockItemId) continue;
        const qty = Number(it.qty);
        if (qty > 0) await applyStockChange(tx, { stockItemId: it.stockItemId, kind: "RECEIPT", qty, reason: `Delete counter sale ${sale.saleNumber ?? ""}`.trim() }, user.name);
      }
    }
    await tx.counterSale.delete({ where: { id } });
  });
  revalidatePath("/counter-sales");
  revalidatePath("/inventory");
  revalidatePath("/commissions");
  revalidatePath("/management");
}

/** Discard a draft sale entirely (draft only; anyone with access, or admin). */
export async function deleteCounterSaleDraft(id: string): Promise<void> {
  const user = await requireViewer();
  const sale = await prisma.counterSale.findUnique({ where: { id }, select: { status: true, soldById: true } });
  if (!sale) throw new Error("Sale not found.");
  if (sale.status !== "DRAFT") throw new Error("Only a draft can be discarded.");
  if (!(isAdmin(user) || sale.soldById === user.id)) throw new Error("Only the person who started this draft (or an admin) can discard it.");
  await prisma.counterSale.delete({ where: { id } });
  revalidatePath("/counter-sales");
  redirect("/counter-sales");
}
