/**
 * Test mode — an admin switch that hides (never deletes) all existing clients,
 * inquiries and quotations so the departmental P&L can be exercised against a
 * clean slate. Turning it on stamps a cutoff time; everything created at or
 * before that moment is hidden, while anything created afterwards (the test
 * data) stays visible. Turning it off restores everything.
 *
 * Stored in the AppSetting key/value table (no migration).
 */
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";

export const TEST_MODE_KEY = "test_mode";

export interface TestMode {
  on: boolean;
  since: string | null; // ISO cutoff — rows created after this are visible
}

export async function getTestMode(): Promise<TestMode> {
  const row = await prisma.appSetting.findUnique({ where: { key: TEST_MODE_KEY } }).catch(() => null);
  const v = (row?.value as { on?: unknown; since?: unknown } | null) ?? null;
  return { on: v?.on === true, since: typeof v?.since === "string" ? v.since : null };
}

/** Enable/disable test mode. Enabling (re)stamps the cutoff to "now". */
export async function setTestMode(on: boolean): Promise<TestMode> {
  const since = on ? new Date().toISOString() : null;
  await prisma.appSetting.upsert({
    where: { key: TEST_MODE_KEY },
    create: { key: TEST_MODE_KEY, value: { on, since } as Prisma.InputJsonValue },
    update: { value: { on, since } as Prisma.InputJsonValue },
  });
  return { on, since };
}

/**
 * A Prisma `createdAt` filter that hides pre-cutoff rows when test mode is on,
 * or `undefined` (no filtering) otherwise. Spread into a `where` clause:
 *   where: { ...(createdAtFilter ? { createdAt: createdAtFilter } : {}) }
 */
export function testModeCreatedAtFilter(tm: TestMode): { gt: Date } | undefined {
  return tm.on && tm.since ? { gt: new Date(tm.since) } : undefined;
}
