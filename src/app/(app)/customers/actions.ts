"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { getCurrentUser, isAdmin } from "@/lib/auth";
import {
  getAccountsRegistry,
  saveAccountsRegistry,
  currentOwner,
  type AccountData,
} from "@/lib/account";

/**
 * Transfer a client account to another salesperson. Only the current sales
 * in-charge (or an admin) may do this. The move closes the current assignment
 * (stamping its end date) and opens a new one for the target salesperson.
 *
 * If the account was never explicitly assigned, its history is first seeded
 * from the derived initial owner — the salesperson who created the customer's
 * earliest inquiry, starting from that inquiry's date — so the trail is complete.
 */
export async function transferAccount(customerId: string, toUserId: string) {
  const user = await getCurrentUser();
  if (!user) throw new Error("Unauthorized");
  if (!toUserId) throw new Error("Choose a salesperson to transfer to.");

  const accounts = await getAccountsRegistry();
  let data: AccountData | null = accounts[customerId] ?? null;

  if (!data) {
    const first = await prisma.inquiry.findFirst({
      where: { customerId },
      orderBy: { createdAt: "asc" },
      include: { createdBy: true },
    });
    data = first
      ? {
          history: [
            {
              userId: first.createdById,
              name: first.createdBy.name,
              startedAt: first.createdAt.toISOString(),
              endedAt: null,
            },
          ],
        }
      : { history: [] };
  }

  const owner = currentOwner(data);
  // Only the current sales in-charge or an admin may transfer. When there is no
  // current owner yet (no inquiries), only an admin can assign one.
  if (owner) {
    if (owner.userId !== user.id && !isAdmin(user))
      throw new Error("Only the current sales in-charge or an admin can transfer this account.");
    if (owner.userId === toUserId) throw new Error("That salesperson already holds this account.");
  } else if (!isAdmin(user)) {
    throw new Error("Only an admin can assign a sales in-charge for this account.");
  }

  const to = await prisma.user.findUnique({ where: { id: toUserId }, select: { id: true, name: true } });
  if (!to) throw new Error("Salesperson not found.");

  const now = new Date().toISOString();
  if (owner) owner.endedAt = now; // close the outgoing assignment
  data.history.push({ userId: to.id, name: to.name, startedAt: now, endedAt: null });

  accounts[customerId] = data;
  await saveAccountsRegistry(accounts);
  revalidatePath(`/customers/${customerId}`);
}
