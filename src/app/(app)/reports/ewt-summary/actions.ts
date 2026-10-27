"use server";

import { revalidatePath } from "next/cache";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { getWorkflowRoles } from "@/lib/workflow-roles";
import { logActivity } from "@/lib/activity-log";
import { canUseEwtSummary, EWT_TABLE_TITLE, type EwtKind } from "@/lib/ewt-summary";

export type EwtActionResult = { ok: true; count?: number } | { ok: false; error: string };

interface UploadedFile {
  path: string;
  name: string;
  uploadedAt: string;
}

const MIGRATION_HINT = "The proof table isn't set up yet — apply migration 0063_ewt_remittance in Supabase.";

async function actor() {
  const user = await getCurrentUser();
  if (!user || !canUseEwtSummary(user, await getWorkflowRoles())) {
    throw new Error("Only an admin, the Payment Approver or Accounting can record EWT payments.");
  }
  return user;
}

function check(kind: string, file?: UploadedFile): asserts kind is EwtKind {
  if (kind !== "supplier" && kind !== "client") throw new Error("Unknown EWT table.");
  if (file && (!file.path?.startsWith(`ewt/${kind}/`) || !file.name)) throw new Error("That file wasn't uploaded for this table.");
}

const run = async (fn: () => Promise<EwtActionResult>): Promise<EwtActionResult> => {
  try {
    return await fn();
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed";
    return { ok: false, error: /EwtRemittance|does not exist|P2021/.test(msg) ? MIGRATION_HINT : msg };
  }
};

/** Attach (or replace) the proof of payment to BIR on one row. */
export async function attachEwtProof(kind: string, refKey: string, file: UploadedFile): Promise<EwtActionResult> {
  return run(async () => {
    const user = await actor();
    check(kind, file);
    const proof = { ...file, byName: user.name } as unknown as Prisma.InputJsonValue;
    await prisma.ewtRemittance.upsert({
      where: { kind_refKey: { kind, refKey } },
      create: { kind, refKey, proof, byName: user.name },
      update: { proof, byName: user.name },
    });
    await logActivity(user, { action: "ewt.proof", category: "cash", summary: `${EWT_TABLE_TITLE[kind]}: proof of payment to BIR attached (${file.name})`, entity: "ewt", href: "/reports/ewt-summary" });
    revalidatePath("/reports/ewt-summary");
    return { ok: true };
  });
}

/**
 * One BIR payment usually covers a whole month or quarter: attach the same proof
 * to every row of the period that has none yet. Rows already paid keep theirs.
 */
export async function attachEwtProofToUnpaid(kind: string, refKeys: string[], file: UploadedFile): Promise<EwtActionResult> {
  return run(async () => {
    const user = await actor();
    check(kind, file);
    const keys = [...new Set(refKeys.filter((k) => typeof k === "string" && k))];
    if (keys.length === 0) return { ok: true, count: 0 };
    const have = new Set((await prisma.ewtRemittance.findMany({ where: { kind, refKey: { in: keys } }, select: { refKey: true } })).map((r) => r.refKey));
    const todo = keys.filter((k) => !have.has(k));
    const proof = { ...file, byName: user.name } as unknown as Prisma.InputJsonValue;
    if (todo.length) await prisma.ewtRemittance.createMany({ data: todo.map((refKey) => ({ kind, refKey, proof, byName: user.name })), skipDuplicates: true });
    await logActivity(user, { action: "ewt.proof", category: "cash", summary: `${EWT_TABLE_TITLE[kind]}: proof of payment to BIR attached to ${todo.length} unpaid row${todo.length === 1 ? "" : "s"} (${file.name})`, entity: "ewt", href: "/reports/ewt-summary" });
    revalidatePath("/reports/ewt-summary");
    return { ok: true, count: todo.length };
  });
}

/** Take the proof off a row — it reads Unpaid again. */
export async function removeEwtProof(kind: string, refKey: string): Promise<EwtActionResult> {
  return run(async () => {
    const user = await actor();
    check(kind);
    await prisma.ewtRemittance.deleteMany({ where: { kind, refKey } });
    await logActivity(user, { action: "ewt.proof.remove", category: "cash", summary: `${EWT_TABLE_TITLE[kind]}: proof of payment removed from a row`, entity: "ewt", href: "/reports/ewt-summary" });
    revalidatePath("/reports/ewt-summary");
    return { ok: true };
  });
}
