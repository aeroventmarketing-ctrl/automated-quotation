"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getCurrentUser, isAdmin } from "@/lib/auth";
import { saveSignatory, type Signatory } from "@/lib/signatory";

async function assertAdmin() {
  const user = await getCurrentUser();
  if (!user || !isAdmin(user)) throw new Error("Only an admin can manage the 2307 signatory.");
}

const schema = z.object({
  name: z.string().trim().max(120).optional().default(""),
  designation: z.string().trim().max(120).optional().default(""),
  // A data URL for the signature image, or "" to clear it. Capped ~1.5MB of base64.
  signature: z
    .string()
    .max(2_000_000)
    .refine((s) => s === "" || s.startsWith("data:image/"), "Signature must be an image")
    .optional()
    .default(""),
});

export async function saveSignatoryAction(input: z.infer<typeof schema>): Promise<Signatory> {
  await assertAdmin();
  const d = schema.parse(input);
  const saved = await saveSignatory(d);
  revalidatePath("/admin/signatory");
  return saved;
}
