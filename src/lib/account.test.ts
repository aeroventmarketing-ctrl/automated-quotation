/**
 * Reading ONE customer's account out of the registry.
 *
 * The registry is a single JSON blob holding every client's ownership history.
 * On 25 September 2026 it measured **296 KB**, and `getAccountData` used to read
 * the whole thing to answer "who owns this client?" — on the quotation detail
 * page and the customer detail page, both of which auto-refresh. Measured over
 * 40 hours: ~8,500 such reads, about 2.5 GB, ~9% of the database's entire egress.
 *
 * It now asks Postgres for the one key. These lock in the only thing that makes
 * that safe: the narrow read must return EXACTLY what reading the whole registry
 * and indexing into it returned — including for records `parseAccounts`
 * deliberately drops, where both must say null.
 *
 * Runs against a real Postgres, skipped unless TEST_DATABASE_URL is set:
 *   TEST_DATABASE_URL=postgresql://… npx vitest run src/lib/account
 */
import { describe, it, expect, beforeAll } from "vitest";

const TEST_DB = process.env.TEST_DATABASE_URL ?? "";
const run = TEST_DB ? describe : describe.skip;

process.env.DATABASE_URL = TEST_DB;
process.env.DIRECT_URL = TEST_DB;

const { getAccountData, getAccountsRegistry, saveAccountsRegistry } = await import("./account");

/** One customer per branch `parseAccounts` distinguishes, kept or dropped. */
const ACCOUNTS: Record<string, unknown> = {
  "cust-owned": {
    history: [
      { userId: "u1", name: "Sam Sales", startedAt: "2026-01-02T00:00:00.000Z" },
      { userId: "u2", name: "Desiree Enigo", startedAt: "2026-06-01T00:00:00.000Z" },
    ],
    conversations: [{ at: "2026-02-01T00:00:00.000Z", note: "called" }],
    optOutFollowUp: false,
    terms: true,
    tin: "123-456-789",
  },
  "cust-marketing": { marketingList: true, marketingFollowUp: { sent: [{ at: "2026-03-01T00:00:00.000Z" }] } },
  "cust-thankyou": { thankYou: { at: "2026-04-01T00:00:00.000Z" } },
  "cust-inquiry": { inquiryFollowUp: { sent: [{ at: "2026-05-01T00:00:00.000Z" }] } },
  "cust-optout": { optOutFollowUp: true },
  // Nothing worth keeping — parseAccounts drops these, so both readers say null.
  "cust-empty": {},
  "cust-junk": { history: "not an array", conversations: 7 },
};

run("getAccountData", () => {
  beforeAll(async () => {
    await saveAccountsRegistry(ACCOUNTS as never);
  });

  it.each([...Object.keys(ACCOUNTS), "cust-never-assigned", ""])(
    "agrees with the whole-registry read for %j",
    async (customerId) => {
      const whole = await getAccountsRegistry();
      expect(await getAccountData(customerId)).toEqual(whole[customerId] ?? null);
    },
  );

  /**
   * The point of the change, asserted rather than assumed: a customer id must
   * not be able to drag the rest of the registry back with it.
   */
  it("returns one customer's record, not the registry", async () => {
    const one = await getAccountData("cust-owned");
    expect(one).not.toBeNull();
    expect(one!.history).toHaveLength(2);
    // Nothing belonging to any other customer came along for the ride.
    expect(JSON.stringify(one)).not.toContain("cust-marketing");
    expect(JSON.stringify(one)).not.toContain("thankYou");
  });

  /** An id that looks like SQL is a parameter, not syntax. */
  it("treats a hostile customer id as a key", async () => {
    for (const id of ["' or true --", '"; drop table "QuotationTemplate"; --', "cust-owned' --"]) {
      expect(await getAccountData(id)).toBeNull();
    }
    // …and the registry is still there afterwards.
    expect(Object.keys(await getAccountsRegistry()).length).toBeGreaterThan(0);
  });
});
