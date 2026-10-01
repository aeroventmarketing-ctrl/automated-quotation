/**
 * Template seeding vs the admin's own edits.
 *
 * Against a real Postgres, because the whole bug lived in what the second call
 * wrote over the first:
 *
 *   TEST_DATABASE_URL=postgresql://… npx vitest run src/lib/ensure-templates
 *
 * The owner: *"in Admin Templates tab, tried revising the templates — after
 * revising I cannot save the revised version."* The save worked. The page then
 * re-rendered, `ensureBuiltinTemplates` ran (it runs on every render of that
 * page) and four of the six built-ins forced `terms` back to the code default.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";

const TEST_DB = process.env.TEST_DATABASE_URL ?? "";
const run = TEST_DB ? describe : describe.skip;

vi.mock("next/cache", () => ({
  revalidatePath: () => {},
  revalidateTag: () => {},
  unstable_cache: (fn: (...a: unknown[]) => unknown) => fn,
}));

process.env.DATABASE_URL = TEST_DB;
process.env.DIRECT_URL = TEST_DB;

const { PrismaClient } = await import("@prisma/client");
const prisma = new (PrismaClient as unknown as new () => import("@prisma/client").PrismaClient)();
const { ensureBuiltinTemplates, ADMIN_EDITED_KEY, isAdminEdited } = await import("./ensure-templates");

/** Every built-in, so a template added later cannot quietly opt out of this. */
const KEYS = ["standard", "power_roof_ventilator", "wind_driven_roof_vent", "air_terminals", "kdk", "services"] as const;

const configOf = async (layoutKey: string): Promise<Record<string, unknown>> => {
  const row = await prisma.quotationTemplate.findUnique({ where: { layoutKey } });
  return (row?.config as Record<string, unknown>) ?? {};
};
/** What the admin screen's Save writes: the edit, plus ownership of the row. */
const adminSaves = async (layoutKey: string, patch: Record<string, unknown>) => {
  const config = { ...(await configOf(layoutKey)), ...patch, [ADMIN_EDITED_KEY]: true };
  await prisma.quotationTemplate.update({ where: { layoutKey }, data: { config: config as never } });
};

run("ensureBuiltinTemplates vs an admin edit", () => {
  beforeAll(async () => { await prisma.$connect(); });
  afterAll(async () => { await prisma.$disconnect(); });

  beforeEach(async () => {
    await prisma.quotationTemplate.deleteMany({ where: { layoutKey: { in: [...KEYS] } } });
    await ensureBuiltinTemplates();
  });

  it.each(KEYS)("keeps the admin's terms on %s, however many times the page renders", async (layoutKey) => {
    const terms = `1. ADMIN REVISED TERMS for ${layoutKey}`;
    await adminSaves(layoutKey, { terms });
    await ensureBuiltinTemplates();
    await ensureBuiltinTemplates();
    expect((await configOf(layoutKey)).terms).toBe(terms);
  });

  it("keeps a spec note the admin deliberately cleared", async () => {
    // KDK used to put its note back whenever the note was empty, so emptying it
    // was impossible for the same reason editing the terms was.
    await adminSaves("kdk", { specNote: "" });
    await ensureBuiltinTemplates();
    expect((await configOf("kdk")).specNote).toBe("");
  });

  it("still seeds a template nobody has touched", async () => {
    await prisma.quotationTemplate.deleteMany({ where: { layoutKey: "services" } });
    await ensureBuiltinTemplates();
    const config = await configOf("services");
    expect(String(config.terms ?? "")).not.toBe("");
    // Seeded, not claimed — a fresh template still follows the code.
    expect(isAdminEdited(config)).toBe(false);
  });

  it("still pushes a code-side change to a template nobody has claimed", async () => {
    // The behaviour the sync existed for, and which must survive the fix: no
    // flag, so the code default wins back.
    await prisma.quotationTemplate.update({
      where: { layoutKey: "services" },
      data: { config: { terms: "something stale", showTerms: true } as never },
    });
    await ensureBuiltinTemplates();
    expect((await configOf("services")).terms).not.toBe("something stale");
  });

  it("hands the template back when the flag is removed by hand", async () => {
    // Advanced config is a free-text JSON box, so deleting the flag is the
    // escape hatch — it has to actually work.
    await adminSaves("services", { terms: "1. MINE" });
    const config = await configOf("services");
    delete config[ADMIN_EDITED_KEY];
    await prisma.quotationTemplate.update({ where: { layoutKey: "services" }, data: { config: config as never } });
    await ensureBuiltinTemplates();
    expect((await configOf("services")).terms).not.toBe("1. MINE");
  });

  it("does not claim a template on the admin's behalf", () => {
    // Only a save sets the flag. Seeding must never set it, or a code-side terms
    // update would stop reaching every template the moment it was created.
    expect(isAdminEdited({})).toBe(false);
    expect(isAdminEdited({ [ADMIN_EDITED_KEY]: "yes" })).toBe(false);
    expect(isAdminEdited(null)).toBe(false);
    expect(isAdminEdited({ [ADMIN_EDITED_KEY]: true })).toBe(true);
  });
});
