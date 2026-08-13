"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getCurrentUser, isAdmin } from "@/lib/auth";
import { setMarketingConfig, type MarketingConfig } from "@/lib/marketing";
import { renderCampaignPreview, sendCampaign, sendCampaignTest, startAbTest, type MarketingRunResult, type CampaignPreview } from "@/lib/marketing-runner";
import { setCampaignDraft, normalizeCampaignDraft, type CampaignDraft } from "@/lib/marketing-campaign";
import {
  upsertCampaignTemplate,
  deleteCampaignTemplate,
  duplicateCampaignTemplate,
  addScheduledCampaign,
  cancelScheduledCampaign,
  cancelAbTest,
  getAbTests,
  type SavedCampaign,
  type ScheduledCampaign,
  type AbTest,
} from "@/lib/marketing-store";

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

// ---- Saved templates ------------------------------------------------------

/** Create (no id) or update (with id) a saved campaign template. */
export async function saveCampaignTemplateAction(input: { id?: string; name: string; draft: z.infer<typeof draftSchema> }): Promise<SavedCampaign[]> {
  await assertMarketer();
  return upsertCampaignTemplate({
    id: input.id,
    name: z.string().min(1, "Name the campaign.").parse(input.name),
    draft: normalizeCampaignDraft(draftSchema.parse(input.draft) as Partial<CampaignDraft>),
  });
}

export async function deleteCampaignTemplateAction(id: string): Promise<SavedCampaign[]> {
  await assertMarketer();
  return deleteCampaignTemplate(z.string().parse(id));
}

export async function duplicateCampaignTemplateAction(id: string): Promise<SavedCampaign[]> {
  await assertMarketer();
  return duplicateCampaignTemplate(z.string().parse(id));
}

// ---- Scheduling -----------------------------------------------------------

const scheduleSchema = z.object({
  name: z.string(),
  draft: draftSchema,
  audience: audienceSchema,
  scheduledFor: z.string().refine((s) => !Number.isNaN(Date.parse(s)), "Invalid date/time"),
});

/** Queue a campaign to send at a future time (fired by the hourly cron). */
export async function scheduleCampaignAction(input: z.infer<typeof scheduleSchema>): Promise<ScheduledCampaign[]> {
  const user = await assertMarketer();
  const parsed = scheduleSchema.parse(input);
  if (Date.parse(parsed.scheduledFor) <= Date.now()) throw new Error("Pick a time in the future.");
  const res = await addScheduledCampaign({
    name: parsed.name.trim() || parsed.draft.subject || "Campaign",
    draft: normalizeCampaignDraft(parsed.draft as Partial<CampaignDraft>),
    audience: parsed.audience,
    scheduledFor: new Date(parsed.scheduledFor).toISOString(),
    createdByName: user.name,
  });
  revalidatePath("/marketing");
  return res;
}

export async function cancelScheduledCampaignAction(id: string): Promise<ScheduledCampaign[]> {
  await assertMarketer();
  const res = await cancelScheduledCampaign(z.string().parse(id));
  revalidatePath("/marketing");
  return res;
}

// ---- A/B subject testing --------------------------------------------------

const abSchema = z.object({
  name: z.string().optional(),
  draft: draftSchema,
  subjectB: z.string().min(1, "Enter subject B."),
  audience: audienceSchema,
  testFraction: z.number().min(0.1).max(0.9),
  decideAfterHours: z.number().min(1).max(72),
});

/** Start an A/B subject test — sends both variants to a test slice now. */
export async function startAbTestAction(input: z.infer<typeof abSchema>): Promise<{ ok: boolean; reason?: string }> {
  const user = await assertMarketer();
  const p = abSchema.parse(input);
  const res = await startAbTest({
    draft: normalizeCampaignDraft(p.draft as Partial<CampaignDraft>),
    subjectB: p.subjectB,
    audience: p.audience,
    testFraction: p.testFraction,
    decideAfterHours: p.decideAfterHours,
    name: p.name,
    actor: { id: user.id, name: user.name },
  });
  revalidatePath("/marketing");
  return { ok: res.ok, reason: res.reason };
}

export async function cancelAbTestAction(id: string): Promise<AbTest[]> {
  await assertMarketer();
  const res = await cancelAbTest(z.string().parse(id));
  revalidatePath("/marketing");
  return res;
}

/** Fetch A/B tests (used to refresh the panel after starting one). */
export async function listAbTestsAction(): Promise<AbTest[]> {
  await assertMarketer();
  return getAbTests();
}
