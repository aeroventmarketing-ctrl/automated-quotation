/**
 * Inbound RFQ review queue.
 *
 * When a client replies to a marketing / follow-up email and attaches an RFQ,
 * an inbound-email webhook drops the message here as a PENDING item. Sales then
 * reviews the queue and either turns an item into an Inquiry (which flows into
 * the normal Inquiries → Quotations pipeline) or dismisses it. Nothing is
 * auto-created — the review step keeps auto-replies / spam out of the pipeline.
 *
 * Stored in the AppSetting key/value table (no schema change); attachment files
 * are referenced by URL. The list is capped so the blob can't grow unbounded.
 */
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";

export const INBOUND_RFQ_KEY = "inbound_rfq_queue";
const MAX_ITEMS = 500;

export type InboundRfqStatus = "pending" | "accepted" | "dismissed";

export interface InboundAttachment {
  name: string;
  url: string;
  path?: string; // Supabase Storage path (web-form uploads) — lets conversion carry the file onto the inquiry
}

export interface InboundRfqItem {
  id: string;
  fromEmail: string;
  fromName?: string;
  subject?: string;
  text?: string;
  attachments: InboundAttachment[];
  receivedAt: string; // ISO
  status: InboundRfqStatus;
  inquiryId?: string; // set when turned into an inquiry
  handledByName?: string; // who accepted / dismissed it
  assignedToName?: string; // the salesperson the inquiry was assigned to (if not the converter)
  handledAt?: string; // ISO
}

function coerce(value: unknown): InboundRfqItem[] {
  const items = (value as { items?: unknown } | null)?.items;
  if (!Array.isArray(items)) return [];
  const out: InboundRfqItem[] = [];
  for (const raw of items) {
    const r = raw as Partial<InboundRfqItem> | null;
    if (!r || typeof r.id !== "string" || typeof r.fromEmail !== "string") continue;
    out.push({
      id: r.id,
      fromEmail: r.fromEmail,
      fromName: typeof r.fromName === "string" ? r.fromName : undefined,
      subject: typeof r.subject === "string" ? r.subject : undefined,
      text: typeof r.text === "string" ? r.text : undefined,
      attachments: Array.isArray(r.attachments)
        ? r.attachments
            .filter((a): a is InboundAttachment => !!a && typeof a.name === "string" && typeof a.url === "string")
            .map((a) => ({ name: a.name, url: a.url, ...(typeof a.path === "string" ? { path: a.path } : {}) }))
        : [],
      receivedAt: typeof r.receivedAt === "string" ? r.receivedAt : new Date(0).toISOString(),
      status: r.status === "accepted" || r.status === "dismissed" ? r.status : "pending",
      inquiryId: typeof r.inquiryId === "string" ? r.inquiryId : undefined,
      handledByName: typeof r.handledByName === "string" ? r.handledByName : undefined,
      assignedToName: typeof r.assignedToName === "string" ? r.assignedToName : undefined,
      handledAt: typeof r.handledAt === "string" ? r.handledAt : undefined,
    });
  }
  return out;
}

export async function getInboundQueue(): Promise<InboundRfqItem[]> {
  const row = await prisma.appSetting.findUnique({ where: { key: INBOUND_RFQ_KEY } }).catch(() => null);
  return coerce(row?.value);
}

async function saveInboundQueue(items: InboundRfqItem[]): Promise<void> {
  const trimmed = items.slice(-MAX_ITEMS);
  await prisma.appSetting.upsert({
    where: { key: INBOUND_RFQ_KEY },
    create: { key: INBOUND_RFQ_KEY, value: { items: trimmed } as unknown as Prisma.InputJsonValue },
    update: { value: { items: trimmed } as unknown as Prisma.InputJsonValue },
  });
}

/** Append a newly-received inbound message to the queue. */
export async function addInboundItem(item: InboundRfqItem): Promise<void> {
  const items = await getInboundQueue();
  items.push(item);
  await saveInboundQueue(items);
}

/** Patch one queue item (e.g. mark accepted/dismissed). */
export async function updateInboundItem(id: string, patch: Partial<InboundRfqItem>): Promise<InboundRfqItem | null> {
  const items = await getInboundQueue();
  const idx = items.findIndex((i) => i.id === id);
  if (idx < 0) return null;
  items[idx] = { ...items[idx], ...patch };
  await saveInboundQueue(items);
  return items[idx];
}
