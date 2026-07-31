"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getCurrentUser, isAdmin } from "@/lib/auth";
import { setMarketingConfig, type MarketingConfig } from "@/lib/marketing";
import { sendMarketingCampaign, type MarketingRunResult } from "@/lib/marketing-runner";

/** Marketing is a sales function — Sales / Engineer / Admin. */
async function assertMarketer() {
  const user = await getCurrentUser();
  if (!user || !(isAdmin(user) || user.role === "SALES" || user.role === "ENGINEER")) {
    throw new Error("You don't have access to marketing.");
  }
  return user;
}

const settingsSchema = z.object({
  enabled: z.boolean(),
  dryRun: z.boolean(),
  everyDays: z.number(),
  maxNudges: z.number(),
  subject: z.string(),
  body: z.string(),
});

export async function saveMarketingSettingsAction(input: z.infer<typeof settingsSchema>): Promise<MarketingConfig> {
  await assertMarketer();
  const saved = await setMarketingConfig(settingsSchema.parse(input));
  revalidatePath("/marketing");
  return saved;
}

const campaignSchema = z.object({
  subject: z.string().min(1),
  body: z.string().min(1),
  audience: z.enum(["list", "all"]),
});

/** Count recipients + validate — sends nothing. */
export async function previewCampaignAction(input: z.infer<typeof campaignSchema>): Promise<MarketingRunResult> {
  await assertMarketer();
  return sendMarketingCampaign({ ...campaignSchema.parse(input), live: false });
}

/** Actually send the campaign to the audience now. */
export async function sendCampaignAction(input: z.infer<typeof campaignSchema>): Promise<MarketingRunResult> {
  const user = await assertMarketer();
  const res = await sendMarketingCampaign({ ...campaignSchema.parse(input), live: true, actor: { id: user.id, name: user.name } });
  revalidatePath("/marketing");
  return res;
}
