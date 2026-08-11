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
  optOutFollowUp?: boolean; // when true, this client is skipped by automated follow-ups
  terms?: boolean; // admin-set: a "terms" client — a PO alone can confirm the sale
  // "Constant communication" nudges sent to a client who has an open inquiry but
  // no quotation sent yet — one entry per automated inquiry follow-up.
  inquiryFollowUp?: { sent: { at: string }[] };
  // On the email-marketing list (populated by the client import / a per-client
  // toggle) — the audience for marketing campaigns & recurring check-ins.
  marketingList?: boolean;
  // Automatic recurring marketing check-ins sent to this client — one per send.
  marketingFollowUp?: { sent: { at: string }[] };
  // One-shot "thank you" messages sent when a client's inquiry is Won / Lost.
  // Keyed by `${inquiryId}:won` / `${inquiryId}:lost` → ISO timestamp, so each is
  // sent at most once even if the status toggles.
  thankYou?: Record<string, string>;
}

/** The current sales in-charge (the open assignment), or null. */
export function currentOwner(data: AccountData | null | undefined): AccountAssignment | null {
  if (!data) return null;
  for (let i = data.history.length - 1; i >= 0; i--) {
    if (!data.history[i].endedAt) return data.history[i];
  }
  return null;
}

/**
 * True when the user currently holds the client's account (the open assignment).
 * A transferred quotation belongs to whoever the account is now assigned to, so
 * the current sales in-charge gets the same edit rights as the preparer.
 */
export async function isCurrentAccountOwner(customerId: string, userId: string): Promise<boolean> {
  const owner = currentOwner(await getAccountData(customerId));
  return owner != null && owner.userId === userId;
}

function parseAccounts(config: unknown): Record<string, AccountData> {
  const accounts = (config as Record<string, unknown> | null)?.accounts;
  if (!accounts || typeof accounts !== "object") return {};
  const out: Record<string, AccountData> = {};
  for (const [cid, v] of Object.entries(accounts as Record<string, unknown>)) {
    const rec = v as Record<string, unknown> | null;
    const hist = rec?.history;
    const convs = rec?.conversations;
    const inq = rec?.inquiryFollowUp as { sent?: unknown } | undefined;
    const inqSent = inq && Array.isArray(inq.sent) ? (inq.sent as { at: string }[]) : null;
    const mkt = rec?.marketingFollowUp as { sent?: unknown } | undefined;
    const mktSent = mkt && Array.isArray(mkt.sent) ? (mkt.sent as { at: string }[]) : null;
    const onMktList = rec?.marketingList === true;
    const ty =
      rec?.thankYou && typeof rec.thankYou === "object" && !Array.isArray(rec.thankYou)
        ? (rec.thankYou as Record<string, string>)
        : null;
    if (
      Array.isArray(hist) || Array.isArray(convs) || rec?.optOutFollowUp != null ||
      rec?.terms != null || inqSent || mktSent || onMktList || ty
    ) {
      out[cid] = {
        history: Array.isArray(hist) ? (hist as AccountAssignment[]) : [],
        conversations: Array.isArray(convs) ? (convs as ConversationEntry[]) : [],
        optOutFollowUp: rec?.optOutFollowUp === true,
        terms: rec?.terms === true,
        ...(inqSent ? { inquiryFollowUp: { sent: inqSent } } : {}),
        ...(onMktList ? { marketingList: true } : {}),
        ...(mktSent ? { marketingFollowUp: { sent: mktSent } } : {}),
        ...(ty ? { thankYou: ty } : {}),
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
