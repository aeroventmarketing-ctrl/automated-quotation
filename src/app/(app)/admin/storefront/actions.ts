"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUser, isAdmin } from "@/lib/auth";
import { setStoreTheme, type StoreTheme } from "@/lib/store-theme";

/**
 * Save the storefront's look & copy. Admin only — this is the public face of the
 * business, so it isn't delegated with the other store-listing permissions.
 */
export async function saveStoreTheme(input: Partial<StoreTheme>): Promise<StoreTheme> {
  const user = await getCurrentUser();
  if (!isAdmin(user)) throw new Error("Admin access required");
  const saved = await setStoreTheme(input);
  // The shell and every store page read the theme, so refresh the whole subtree.
  revalidatePath("/store", "layout");
  revalidatePath("/admin/storefront");
  return saved;
}
