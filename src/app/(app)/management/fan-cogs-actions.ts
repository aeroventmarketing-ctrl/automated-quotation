"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { canManagePayroll } from "./payroll-actions";

export interface FanCogsRowView {
  id: string;
  modelCode: string | null;
  size: string | null;
  material: string | null;
  cost: number;
  note: string | null;
}

async function requireManager() {
  const user = await getCurrentUser();
  if (!user || !(await canManagePayroll(user))) throw new Error("Unauthorized");
  return user;
}

/** All fan-body COGS rows (model-code overrides first, then size/material). */
export async function listFanCogs(): Promise<FanCogsRowView[]> {
  await requireManager();
  const rows = await prisma.fanBodyCogs.findMany({
    orderBy: [{ modelCode: "asc" }, { size: "asc" }, { material: "asc" }],
  });
  return rows.map((r) => ({
    id: r.id,
    modelCode: r.modelCode,
    size: r.size,
    material: r.material,
    cost: Number(r.cost) || 0,
    note: r.note,
  }));
}

export interface FanCogsInput {
  modelCode?: string | null;
  size?: string | null;
  material?: string | null;
  cost: number;
  note?: string | null;
}

const clean = (v: string | null | undefined) => {
  const s = (v ?? "").trim();
  return s === "" ? null : s;
};

/** Add a fan-body COGS row. Needs a model code, or a size and/or material. */
export async function addFanCogs(input: FanCogsInput): Promise<void> {
  const user = await requireManager();
  const modelCode = clean(input.modelCode);
  const size = clean(input.size);
  const material = clean(input.material);
  if (!modelCode && !size && !material) throw new Error("Enter a model code, or a size and/or material.");
  await prisma.fanBodyCogs.create({
    data: {
      modelCode,
      size,
      material,
      cost: Math.max(0, Number(input.cost) || 0),
      note: clean(input.note),
      createdByName: user.name,
    },
  });
  revalidatePath("/management");
}

/** Update a row's cost (and note). */
export async function updateFanCogs(id: string, cost: number, note?: string | null): Promise<void> {
  await requireManager();
  await prisma.fanBodyCogs.update({
    where: { id },
    data: { cost: Math.max(0, Number(cost) || 0), ...(note === undefined ? {} : { note: clean(note) }) },
  });
  revalidatePath("/management");
}

export async function deleteFanCogs(id: string): Promise<void> {
  await requireManager();
  await prisma.fanBodyCogs.delete({ where: { id } }).catch(() => {});
  revalidatePath("/management");
}
