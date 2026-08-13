"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getCurrentUser, isAdmin } from "@/lib/auth";
import { setMarketingConfig, type MarketingConfig } from "@/lib/marketing";
import { renderCampaignPreview, sendCampaign, sendCampaignTest, type MarketingRunResult, type CampaignPreview } from "@/lib/marketing-runner";
import { setCampaignDraft, normalizeCampaignDraft, type CampaignDraft } from "@/lib/marketing-campaign";

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

// ---- Rich campaign builder ------------------------------------------------

const productSchema = z.object({
  name: z.string(),
  blurb: z.string(),
  imagePath: z.string().optional(),
  imageName: z.string().optional(),
});
const imageSchema = z.object({ path: z.string(), name: z.string(), caption: z.string().optional() });
const draftSchema = z.object({
  senderName: z.string(),
  subject: z.string(),
  preheader: z.string(),
  greeting: z.string(),
  hook: z.string(),
  valueProp: z.string(),
  products: z.array(productSchema),
  benefits: z.array(z.string()),
  images: z.array(imageSchema),
  socialProof: z.string(),
  ctaLabel: z.string(),
  ctaUrl: z.string(),
  contactInfo: z.string(),
  footer: z.string(),
  unsubscribeText: z.string(),
});

/** Persist the working campaign draft. */
export async function saveCampaignDraftAction(input: z.infer<typeof draftSchema>): Promise<CampaignDraft> {
  await assertMarketer();
  const saved = await setCampaignDraft(draftSchema.parse(input) as Partial<CampaignDraft>);
  revalidatePath("/marketing");
  return saved;
}

/** Render the campaign HTML/text for a sample recipient (live preview). */
export async function previewCampaignBuilderAction(input: z.infer<typeof draftSchema>): Promise<CampaignPreview> {
  await assertMarketer();
  return renderCampaignPreview(normalizeCampaignDraft(draftSchema.parse(input) as Partial<CampaignDraft>));
}

const audienceSchema = z.enum(["list", "all"]);

/** Count recipients for the campaign — sends nothing. */
export async function previewCampaignRecipientsAction(input: { draft: z.infer<typeof draftSchema>; audience: z.infer<typeof audienceSchema> }): Promise<MarketingRunResult> {
  await assertMarketer();
  return sendCampaign({ draft: normalizeCampaignDraft(draftSchema.parse(input.draft) as Partial<CampaignDraft>), audience: audienceSchema.parse(input.audience), live: false });
}

/** Send the built campaign to the chosen audience now. */
export async function sendCampaignBuilderAction(input: { draft: z.infer<typeof draftSchema>; audience: z.infer<typeof audienceSchema> }): Promise<MarketingRunResult> {
  const user = await assertMarketer();
  const res = await sendCampaign({
    draft: normalizeCampaignDraft(draftSchema.parse(input.draft) as Partial<CampaignDraft>),
    audience: audienceSchema.parse(input.audience),
    live: true,
    actor: { id: user.id, name: user.name },
  });
  revalidatePath("/marketing");
  return res;
}

/** Send one test copy of the campaign to a single address. */
export async function sendCampaignTestAction(input: { draft: z.infer<typeof draftSchema>; toEmail: string }): Promise<{ ok: boolean; reason?: string }> {
  await assertMarketer();
  const toEmail = z.string().email().parse(input.toEmail);
  return sendCampaignTest({ draft: normalizeCampaignDraft(draftSchema.parse(input.draft) as Partial<CampaignDraft>), toEmail });
}
