/**
 * Per-salesperson "an RFQ was assigned to you" notifications.
 *
 * When an inbound RFQ is converted to an inquiry and assigned to a salesperson
 * (other than the person converting it), a notification is dropped here for that
 * salesperson. It surfaces as a blinking count on the Inquiries nav tab and a
 * banner on the Inquiries list, and clears when they open the inquiry.
 *
 * Stored in the AppSetting key/value table (no schema change), keyed by user id.
 */
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";

const KEY = "inquiry_assignment_notifications";
const MAX_PER_USER = 100;

export interface InquiryAssignmentNote {
  inquiryId: string;
  customer: string; // client company / name, for the banner
  fromName: string; // who assigned it
  at: string; // ISO
}

type Store = Record<string, InquiryAssignmentNote[]>;

function coerce(v: unknown): Store {
  if (!v || typeof v !== "object") return {};
  const out: Store = {};
  for (const [uid, list] of Object.entries(v as Record<string, unknown>)) {
    if (!Array.isArray(list)) continue;
    out[uid] = list.filter(
      (n): n is InquiryAssignmentNote => !!n && typeof n === "object" && typeof (n as { inquiryId?: unknown }).inquiryId === "string",
    );
  }
  return out;
}

async function load(): Promise<Store> {
  const row = await prisma.appSetting.findUnique({ where: { key: KEY } }).catch(() => null);
  return coerce(row?.value);
}
async function save(store: Store): Promise<void> {
  await prisma.appSetting.upsert({
    where: { key: KEY },
    create: { key: KEY, value: store as unknown as Prisma.InputJsonValue },
    update: { value: store as unknown as Prisma.InputJsonValue },
  });
}

/** Notify a salesperson that an inquiry was assigned to them (newest first, de-duped). */
export async function addInquiryAssignment(userId: string, note: InquiryAssignmentNote): Promise<void> {
  const store = await load();
  const list = (store[userId] ?? []).filter((n) => n.inquiryId !== note.inquiryId);
  list.unshift(note);
  store[userId] = list.slice(0, MAX_PER_USER);
  await save(store);
}

/** A salesperson's unseen assigned-inquiry notifications (newest first). */
export async function getInquiryAssignments(userId: string): Promise<InquiryAssignmentNote[]> {
  return (await load())[userId] ?? [];
}

/** Clear one notification (e.g. when the salesperson opens the inquiry). */
export async function clearInquiryAssignment(userId: string, inquiryId: string): Promise<void> {
  const store = await load();
  const list = store[userId];
  if (!list?.some((n) => n.inquiryId === inquiryId)) return;
  store[userId] = list.filter((n) => n.inquiryId !== inquiryId);
  await save(store);
}
