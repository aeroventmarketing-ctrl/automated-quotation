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
import { cache } from "react";
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
  tin?: string; // client's Taxpayer Identification Number (BIR) — used by the Sales Summary report
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
    const tin = typeof rec?.tin === "string" ? rec.tin.trim() : "";
    const ty =
      rec?.thankYou && typeof rec.thankYou === "object" && !Array.isArray(rec.thankYou)
        ? (rec.thankYou as Record<string, string>)
        : null;
    if (
      Array.isArray(hist) || Array.isArray(convs) || rec?.optOutFollowUp != null ||
      rec?.terms != null || inqSent || mktSent || onMktList || ty || tin
    ) {
      out[cid] = {
        history: Array.isArray(hist) ? (hist as AccountAssignment[]) : [],
        conversations: Array.isArray(convs) ? (convs as ConversationEntry[]) : [],
        optOutFollowUp: rec?.optOutFollowUp === true,
        terms: rec?.terms === true,
        ...(tin ? { tin } : {}),
        ...(inqSent ? { inquiryFollowUp: { sent: inqSent } } : {}),
        ...(onMktList ? { marketingList: true } : {}),
        ...(mktSent ? { marketingFollowUp: { sent: mktSent } } : {}),
        ...(ty ? { thankYou: ty } : {}),
      };
    }
  }
  return out;
}

/**
 * Read the whole registry (customerId -> AccountData).
 *
 * **Memoised per request.** The registry is ONE JSON blob holding every client's
 * ownership history, and on 25 September 2026 it measured **296 KB** — by a wide
 * margin the largest row in the database. Two callers in one render meant
 * reading it twice.
 *
 * Prefer {@link getAccountData} when you want one customer. This function exists
 * for the passes that genuinely walk every account — the reports, the follow-up
 * and marketing runners — and for the writers, which must have the whole thing
 * to write it back.
 */
export const getAccountsRegistry = cache(async function getAccountsRegistry(): Promise<Record<string, AccountData>> {
  const row = await prisma.quotationTemplate.findUnique({ where: { layoutKey: ACCOUNT_REGISTRY_KEY } });
  return parseAccounts(row?.config);
});

/**
 * Read ONE customer's account data (or null if never assigned/transferred).
 *
 * ## Why this does not call `getAccountsRegistry`
 *
 * It used to, and that meant the quotation detail page and the customer detail
 * page each pulled **296 KB across the wire to answer "who owns this client?"** —
 * a question whose answer is a few hundred bytes. Both pages auto-refresh, so
 * they asked again every time anything on the order moved.
 *
 * Measured over 40 hours on 25 September: ~8,500 of those reads, about **2.5 GB**,
 * roughly 9% of the database's entire egress for the period — to read one key out
 * of a map, over and over.
 *
 * Postgres can pick the key out itself. `config -> 'accounts' -> $customerId`
 * returns that customer's object alone, so the 296 KB never leaves the database.
 * `->` (not `->>`) keeps it JSON, which is what `parseAccounts` already expects.
 *
 * The shape is deliberately identical to a registry of one: the same
 * `parseAccounts` validates it, so a customer whose record is malformed is
 * dropped here exactly as it would be there, and this can never accept something
 * the whole-registry path would reject.
 */
export async function getAccountData(customerId: string): Promise<AccountData | null> {
  if (!customerId) return null;
  const rows = await prisma.$queryRaw<{ record: unknown }[]>`
    select "config" -> 'accounts' -> ${customerId} as "record"
    from "QuotationTemplate"
    where "layoutKey" = ${ACCOUNT_REGISTRY_KEY}
  `;
  const record = rows[0]?.record;
  if (record == null) return null;
  // Validate through the one parser, by handing it a registry containing only
  // this customer — so "what counts as an account" is defined in exactly one
  // place and cannot drift between the two readers.
  return parseAccounts({ accounts: { [customerId]: record } })[customerId] ?? null;
}

/**
 * Persist the whole registry, creating the hidden row if needed.
 *
 * **This overwrites everything.** Whatever the caller read minutes ago is what
 * the registry becomes, so anything another writer recorded in between is gone.
 * That is only safe for a caller that read and wrote in one breath.
 *
 * A long-running caller — anything that reads, then sends emails, then
 * writes — must use {@link mergeAccountsRegistry} or
 * {@link updateAccountsRegistry} instead. See the note on those.
 */
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

/**
 * Read the registry, change it, and write it back — with the row LOCKED for the
 * length of it, so a concurrent writer waits its turn instead of reading the
 * same "before" and overwriting the result.
 *
 * ## Why this exists
 *
 * The whole registry is one JSON blob. Every writer used to read it, work for a
 * while, and write the lot back, which makes a lost update not a race you might
 * lose but the normal outcome: the slower writer's copy — read before the faster
 * one's changes existed — lands last and erases them.
 *
 * On 14 September 2026 that sent a client the automatic check-in email **every
 * hour for a day**. The cron runs the follow-up pass and the marketing pass in a
 * `Promise.all`; both read this registry at the same instant; marketing sent its
 * emails and recorded them; the follow-up pass, still working from the copy it
 * read before any of that, wrote its own version over the top. The record of the
 * send vanished, so an hour later every client was "never mailed", and the
 * 30-day cadence and the 12-email cap — both of which read that record — never
 * saw a thing.
 *
 * The mutator runs INSIDE the transaction. Keep it short and do no I/O in it:
 * the lock is held until it returns, and everything else that writes a client's
 * account waits behind it.
 */
export async function updateAccountsRegistry(
  mutate: (accounts: Record<string, AccountData>) => void,
): Promise<void> {
  // The lock needs a row to hold on to. Creating it first (outside the
  // transaction, idempotently) means the first-ever write is not the one case
  // where two writers can both insert.
  await prisma.quotationTemplate.upsert({
    where: { layoutKey: ACCOUNT_REGISTRY_KEY },
    update: {},
    create: {
      layoutKey: ACCOUNT_REGISTRY_KEY,
      name: "Account Registry (internal)",
      active: false,
      config: { accounts: {} } as unknown as Prisma.InputJsonObject,
    },
  });
  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`select 1 from "QuotationTemplate" where "layoutKey" = ${ACCOUNT_REGISTRY_KEY} for update`;
    const row = await tx.quotationTemplate.findUnique({ where: { layoutKey: ACCOUNT_REGISTRY_KEY } });
    const accounts = parseAccounts(row?.config);
    mutate(accounts);
    await tx.quotationTemplate.update({
      where: { layoutKey: ACCOUNT_REGISTRY_KEY },
      data: { config: { accounts } as unknown as Prisma.InputJsonObject },
    });
  });
}

/**
 * Write back only the clients this caller actually touched, onto whatever the
 * registry says right now.
 *
 * For the long-running passes — the follow-up runner works through emails and
 * texts for minutes before it saves. Re-reading under the lock and copying just
 * the touched entries across means two passes that worked on different clients
 * both keep their changes, instead of the later one erasing the earlier.
 *
 * `touched` is the list of customer ids whose entry is to be taken from
 * `accounts`; an id present in `touched` but absent from `accounts` is deleted,
 * so a caller can remove an entry too.
 */
export async function mergeAccountsRegistry(
  touched: Iterable<string>,
  accounts: Record<string, AccountData>,
): Promise<void> {
  const ids = [...new Set(touched)];
  if (ids.length === 0) return;
  await updateAccountsRegistry((fresh) => {
    for (const id of ids) {
      if (accounts[id]) fresh[id] = accounts[id];
      else delete fresh[id];
    }
  });
}
