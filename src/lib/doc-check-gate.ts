/**
 * Admin toggle for the "documents required before Mark documents checked" gate.
 * When enabled, the doc_check step requires the PO, Computation, Quotation, and
 * RFQ/BOQ to be attached. Turn off during testing. Stored in the AppSetting
 * key/value table (no migration). Default ON.
 */
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";

export const DOC_CHECK_GATE_KEY = "doc_check_gate_enabled";

/** Whether the required-documents gate is enforced (default true). */
export async function getDocCheckGateEnabled(): Promise<boolean> {
  const row = await prisma.appSetting.findUnique({ where: { key: DOC_CHECK_GATE_KEY } });
  const v = (row?.value as { enabled?: unknown } | null) ?? null;
  return v?.enabled !== false; // default ON; only off when explicitly false
}

/** Enable/disable the required-documents gate. */
export async function setDocCheckGateEnabled(enabled: boolean): Promise<void> {
  await prisma.appSetting.upsert({
    where: { key: DOC_CHECK_GATE_KEY },
    create: { key: DOC_CHECK_GATE_KEY, value: { enabled } as Prisma.InputJsonValue },
    update: { value: { enabled } as Prisma.InputJsonValue },
  });
}
