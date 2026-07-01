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

export interface AccountData {
  history: AccountAssignment[]; // chronological; the open (endedAt=null) one is current
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
    const hist = (v as Record<string, unknown> | null)?.history;
    if (Array.isArray(hist)) out[cid] = { history: hist as AccountAssignment[] };
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
