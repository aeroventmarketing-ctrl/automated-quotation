/**
 * Client account ownership ("sales in-charge") with a transfer history.
 *
 * There is no per-customer JSON column and the database can't be migrated from
 * the build/deploy pipeline, so — like the sale/revision data on quotations —
 * this rides in an existing JSON column. It lives in a single hidden
 * QuotationTemplate row (layoutKey "__account_registry__", active:false) whose
 * config holds { accounts: { [customerId]: AccountData } }. The template pickers
 * filter by an allow-list of layout keys, so this row never appears as a
 * selectable template; the admin templates list filters it out explicitly.
 */
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";

export const ACCOUNT_REGISTRY_KEY = "__account_registry__";

export interface AccountAssignment {
  userId: string;
  name: string;
  startedAt: string; // ISO — when this salesperson took the account
  endedAt: string | null; // ISO when transferred away, or null while current
}

/** A logged conversation / follow-up with the client. */
export interface ConversationEntry {
  id: string;
  date: string; // ISO date the conversation happened
  channel: string; // Phone / Email / Viber / Meeting / SMS / Other
  contactPerson: string; // who the salesperson spoke with
  message: string; // what was discussed / follow-up notes
  quoteNumber: string | null; // related quotation number, if any
  nextFollowUp: string | null; // ISO date of the planned next follow-up
  loggedById: string; // the user who logged it (the salesperson)
  loggedByName: string;
  createdAt: string; // ISO when the entry was logged
}

export interface AccountData {
  history: AccountAssignment[]; // chronological; the open (endedAt=null) one is current
  conversations?: ConversationEntry[]; // logged follow-ups, chronological
}

/** The current sales in-charge (the open assignment), or null. */
export function currentOwner(data: AccountData | null | undefined): AccountAssignment | null {
  if (!data) return null;
  for (let i = data.history.length - 1; i >= 0; i--) {
    if (!data.history[i].endedAt) return data.history[i];
  }
  return null;
}

function parseAccounts(config: unknown): Record<string, AccountData> {
  const accounts = (config as Record<string, unknown> | null)?.accounts;
  if (!accounts || typeof accounts !== "object") return {};
  const out: Record<string, AccountData> = {};
  for (const [cid, v] of Object.entries(accounts as Record<string, unknown>)) {
    const rec = v as Record<string, unknown> | null;
    const hist = rec?.history;
    const convs = rec?.conversations;
    if (Array.isArray(hist) || Array.isArray(convs)) {
      out[cid] = {
        history: Array.isArray(hist) ? (hist as AccountAssignment[]) : [],
        conversations: Array.isArray(convs) ? (convs as ConversationEntry[]) : [],
      };
    }
  }
  return out;
}

/** Read the whole registry (customerId -> AccountData). */
export async function getAccountsRegistry(): Promise<Record<string, AccountData>> {
  const row = await prisma.quotationTemplate.findUnique({ where: { layoutKey: ACCOUNT_REGISTRY_KEY } });
  return parseAccounts(row?.config);
}

/** Read one customer's account data (or null if never assigned/transferred). */
export async function getAccountData(customerId: string): Promise<AccountData | null> {
  const accounts = await getAccountsRegistry();
  return accounts[customerId] ?? null;
}

/** Persist the whole registry, creating the hidden row if needed. */
export async function saveAccountsRegistry(accounts: Record<string, AccountData>): Promise<void> {
  await prisma.quotationTemplate.upsert({
    where: { layoutKey: ACCOUNT_REGISTRY_KEY },
    update: { config: { accounts } as unknown as Prisma.InputJsonObject },
    create: {
      layoutKey: ACCOUNT_REGISTRY_KEY,
      name: "Account Registry (internal)",
      active: false,
      config: { accounts } as unknown as Prisma.InputJsonObject,
    },
  });
}
