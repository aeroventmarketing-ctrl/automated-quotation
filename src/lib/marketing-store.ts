/**
 * Persistence for the campaign builder's three add-ons — all riding in AppSetting
 * JSON rows (no schema change, same as the rest of marketing):
 *
 *   • Templates  (marketing_campaign_library) — a named, reusable library of
 *     saved campaigns you can load / duplicate / delete.
 *   • Scheduled  (marketing_scheduled)        — campaigns queued to send at a
 *     future time; the hourly cron fires the due ones.
 *   • Sends      (marketing_sends)            — a record per delivered campaign
 *     with open / click tallies for the results view.
 *
 * All writes are read-modify-write on a single row. That's fine at this scale;
 * open/click tracking is best-effort (a rare concurrent open may be missed).
 */
import { randomUUID } from "crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import type { MarketingAudience } from "@/lib/marketing";
import { normalizeCampaignDraft, type CampaignDraft } from "@/lib/marketing-campaign";

export const MARKETING_TEMPLATES_KEY = "marketing_campaign_library";
export const MARKETING_SCHEDULED_KEY = "marketing_scheduled";
export const MARKETING_SENDS_KEY = "marketing_sends";
export const MARKETING_ABTESTS_KEY = "marketing_abtests";

const SENDS_KEEP = 100; // cap the analytics history so the row stays small
const ABTESTS_KEEP = 50;

const str = (v: unknown, d = ""): string => (typeof v === "string" ? v : d);
const int = (v: unknown): number => (Number.isFinite(Number(v)) ? Math.floor(Number(v)) : 0);
const strArr = (v: unknown): string[] => (Array.isArray(v) ? v.map((x) => str(x)).filter(Boolean) : []);

async function readRow<T>(key: string, parse: (v: unknown) => T): Promise<T> {
  const row = await prisma.appSetting.findUnique({ where: { key } });
  return parse(row?.value ?? null);
}
async function writeRow(key: string, value: unknown): Promise<void> {
  await prisma.appSetting.upsert({
    where: { key },
    create: { key, value: value as Prisma.InputJsonValue },
    update: { value: value as Prisma.InputJsonValue },
  });
}

// ---- Templates ------------------------------------------------------------

export interface SavedCampaign {
  id: string;
  name: string;
  draft: CampaignDraft;
  createdAt: string;
  updatedAt: string;
}

function parseTemplates(v: unknown): SavedCampaign[] {
  const arr = (v as { campaigns?: unknown } | null)?.campaigns;
  if (!Array.isArray(arr)) return [];
  const out: SavedCampaign[] = [];
  for (const e of arr) {
    if (!e || typeof e !== "object") continue;
    const o = e as Record<string, unknown>;
    if (!str(o.id)) continue;
    out.push({
      id: str(o.id),
      name: str(o.name) || "Untitled campaign",
      draft: normalizeCampaignDraft(o.draft as Partial<CampaignDraft> | null),
      createdAt: str(o.createdAt),
      updatedAt: str(o.updatedAt),
    });
  }
  return out.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function getCampaignTemplates(): Promise<SavedCampaign[]> {
  return readRow(MARKETING_TEMPLATES_KEY, parseTemplates);
}

/** Create (no id) or update (matching id) a saved campaign; returns the new list. */
export async function upsertCampaignTemplate(input: { id?: string; name: string; draft: CampaignDraft }): Promise<SavedCampaign[]> {
  const list = await getCampaignTemplates();
  const now = new Date().toISOString();
  const name = input.name.trim() || "Untitled campaign";
  const draft = normalizeCampaignDraft(input.draft);
  const existing = input.id ? list.find((t) => t.id === input.id) : undefined;
  if (existing) {
    existing.name = name;
    existing.draft = draft;
    existing.updatedAt = now;
  } else {
    list.push({ id: randomUUID(), name, draft, createdAt: now, updatedAt: now });
  }
  await writeRow(MARKETING_TEMPLATES_KEY, { campaigns: list });
  return parseTemplates({ campaigns: list });
}

export async function deleteCampaignTemplate(id: string): Promise<SavedCampaign[]> {
  const list = (await getCampaignTemplates()).filter((t) => t.id !== id);
  await writeRow(MARKETING_TEMPLATES_KEY, { campaigns: list });
  return list;
}

export async function duplicateCampaignTemplate(id: string): Promise<SavedCampaign[]> {
  const list = await getCampaignTemplates();
  const src = list.find((t) => t.id === id);
  if (src) {
    const now = new Date().toISOString();
    list.push({ id: randomUUID(), name: `${src.name} (copy)`, draft: src.draft, createdAt: now, updatedAt: now });
    await writeRow(MARKETING_TEMPLATES_KEY, { campaigns: list });
  }
  return parseTemplates({ campaigns: list });
}

// ---- Scheduled campaigns --------------------------------------------------

export type ScheduledStatus = "pending" | "sent" | "cancelled" | "failed";

export interface ScheduledCampaign {
  id: string;
  name: string;
  draft: CampaignDraft;
  audience: MarketingAudience;
  scheduledFor: string; // ISO
  status: ScheduledStatus;
  createdByName: string;
  createdAt: string;
  sentAt?: string;
  sendId?: string;
  result?: { sent: number; skipped: number; failed: number };
  error?: string;
}

function parseScheduled(v: unknown): ScheduledCampaign[] {
  const arr = (v as { jobs?: unknown } | null)?.jobs;
  if (!Array.isArray(arr)) return [];
  const out: ScheduledCampaign[] = [];
  for (const e of arr) {
    if (!e || typeof e !== "object") continue;
    const o = e as Record<string, unknown>;
    if (!str(o.id)) continue;
    const status = str(o.status) as ScheduledStatus;
    const res = o.result as { sent?: unknown; skipped?: unknown; failed?: unknown } | undefined;
    out.push({
      id: str(o.id),
      name: str(o.name) || "Untitled campaign",
      draft: normalizeCampaignDraft(o.draft as Partial<CampaignDraft> | null),
      audience: o.audience === "all" ? "all" : "list",
      scheduledFor: str(o.scheduledFor),
      status: (["pending", "sent", "cancelled", "failed"] as string[]).includes(status) ? status : "pending",
      createdByName: str(o.createdByName),
      createdAt: str(o.createdAt),
      ...(str(o.sentAt) ? { sentAt: str(o.sentAt) } : {}),
      ...(str(o.sendId) ? { sendId: str(o.sendId) } : {}),
      ...(res ? { result: { sent: int(res.sent), skipped: int(res.skipped), failed: int(res.failed) } } : {}),
      ...(str(o.error) ? { error: str(o.error) } : {}),
    });
  }
  return out.sort((a, b) => b.scheduledFor.localeCompare(a.scheduledFor));
}

export async function getScheduledCampaigns(): Promise<ScheduledCampaign[]> {
  return readRow(MARKETING_SCHEDULED_KEY, parseScheduled);
}

export async function addScheduledCampaign(input: {
  name: string;
  draft: CampaignDraft;
  audience: MarketingAudience;
  scheduledFor: string;
  createdByName: string;
}): Promise<ScheduledCampaign[]> {
  const list = await getScheduledCampaigns();
  list.push({
    id: randomUUID(),
    name: input.name.trim() || "Untitled campaign",
    draft: normalizeCampaignDraft(input.draft),
    audience: input.audience,
    scheduledFor: input.scheduledFor,
    status: "pending",
    createdByName: input.createdByName,
    createdAt: new Date().toISOString(),
  });
  await writeRow(MARKETING_SCHEDULED_KEY, { jobs: list });
  return parseScheduled({ jobs: list });
}

export async function updateScheduledCampaign(id: string, patch: Partial<ScheduledCampaign>): Promise<ScheduledCampaign[]> {
  const list = await getScheduledCampaigns();
  const job = list.find((j) => j.id === id);
  if (job) Object.assign(job, patch);
  await writeRow(MARKETING_SCHEDULED_KEY, { jobs: list });
  return parseScheduled({ jobs: list });
}

/** Cancel a still-pending scheduled campaign. */
export async function cancelScheduledCampaign(id: string): Promise<ScheduledCampaign[]> {
  const list = await getScheduledCampaigns();
  const job = list.find((j) => j.id === id);
  if (job && job.status === "pending") job.status = "cancelled";
  await writeRow(MARKETING_SCHEDULED_KEY, { jobs: list });
  return parseScheduled({ jobs: list });
}

// ---- Send records (open / click analytics) --------------------------------

export interface CampaignSendRecord {
  id: string;
  name: string;
  subject: string;
  audience: string;
  sentAt: string;
  sentByName: string;
  recipients: number;
  sent: number;
  openedIds: string[];
  clickedIds: string[];
}

function parseSends(v: unknown): CampaignSendRecord[] {
  const arr = (v as { sends?: unknown } | null)?.sends;
  if (!Array.isArray(arr)) return [];
  const out: CampaignSendRecord[] = [];
  for (const e of arr) {
    if (!e || typeof e !== "object") continue;
    const o = e as Record<string, unknown>;
    if (!str(o.id)) continue;
    out.push({
      id: str(o.id),
      name: str(o.name),
      subject: str(o.subject),
      audience: str(o.audience),
      sentAt: str(o.sentAt),
      sentByName: str(o.sentByName),
      recipients: int(o.recipients),
      sent: int(o.sent),
      openedIds: strArr(o.openedIds),
      clickedIds: strArr(o.clickedIds),
    });
  }
  return out.sort((a, b) => b.sentAt.localeCompare(a.sentAt));
}

export async function getCampaignSends(): Promise<CampaignSendRecord[]> {
  return readRow(MARKETING_SENDS_KEY, parseSends);
}

/** Insert a new send record (called once a campaign has been delivered). */
export async function recordCampaignSend(rec: Omit<CampaignSendRecord, "openedIds" | "clickedIds">): Promise<void> {
  const list = await getCampaignSends();
  list.unshift({ ...rec, openedIds: [], clickedIds: [] });
  await writeRow(MARKETING_SENDS_KEY, { sends: list.slice(0, SENDS_KEEP) });
}

/** Record a unique open / click for a recipient on a send. Best-effort. */
export async function recordCampaignEvent(sendId: string, customerId: string, event: "open" | "click"): Promise<void> {
  if (!sendId || !customerId) return;
  const list = await getCampaignSends();
  const rec = list.find((s) => s.id === sendId);
  if (!rec) return;
  const bag = event === "open" ? rec.openedIds : rec.clickedIds;
  if (!bag.includes(customerId)) {
    bag.push(customerId);
    // A click implies an open — count it too.
    if (event === "click" && !rec.openedIds.includes(customerId)) rec.openedIds.push(customerId);
    await writeRow(MARKETING_SENDS_KEY, { sends: list });
  }
}

// ---- A/B subject tests ----------------------------------------------------

export type AbStatus = "testing" | "completed" | "failed" | "cancelled";

export interface AbTest {
  id: string;
  name: string;
  draft: CampaignDraft; // the base draft (its subject is variant A)
  subjectA: string;
  subjectB: string;
  audience: MarketingAudience;
  testFraction: number; // 0..1 of the audience used for the test (split A/B)
  decideAfterHours: number;
  status: AbStatus;
  createdByName: string;
  createdAt: string;
  decideAt: string; // ISO — when the winner is picked & the remainder sent
  testedIdsA: string[];
  testedIdsB: string[];
  sendIdA?: string;
  sendIdB?: string;
  winner?: "A" | "B";
  winnerSubject?: string;
  remainderSendId?: string;
  remainderCount?: number;
  completedAt?: string;
  error?: string;
}

function parseAbTests(v: unknown): AbTest[] {
  const arr = (v as { tests?: unknown } | null)?.tests;
  if (!Array.isArray(arr)) return [];
  const out: AbTest[] = [];
  for (const e of arr) {
    if (!e || typeof e !== "object") continue;
    const o = e as Record<string, unknown>;
    if (!str(o.id)) continue;
    const status = str(o.status) as AbStatus;
    const w = str(o.winner);
    out.push({
      id: str(o.id),
      name: str(o.name) || "Untitled A/B test",
      draft: normalizeCampaignDraft(o.draft as Partial<CampaignDraft> | null),
      subjectA: str(o.subjectA),
      subjectB: str(o.subjectB),
      audience: o.audience === "all" ? "all" : "list",
      testFraction: Number.isFinite(Number(o.testFraction)) ? Number(o.testFraction) : 0.3,
      decideAfterHours: Number.isFinite(Number(o.decideAfterHours)) ? Number(o.decideAfterHours) : 4,
      status: (["testing", "completed", "failed", "cancelled"] as string[]).includes(status) ? status : "testing",
      createdByName: str(o.createdByName),
      createdAt: str(o.createdAt),
      decideAt: str(o.decideAt),
      testedIdsA: strArr(o.testedIdsA),
      testedIdsB: strArr(o.testedIdsB),
      ...(str(o.sendIdA) ? { sendIdA: str(o.sendIdA) } : {}),
      ...(str(o.sendIdB) ? { sendIdB: str(o.sendIdB) } : {}),
      ...(w === "A" || w === "B" ? { winner: w } : {}),
      ...(str(o.winnerSubject) ? { winnerSubject: str(o.winnerSubject) } : {}),
      ...(str(o.remainderSendId) ? { remainderSendId: str(o.remainderSendId) } : {}),
      ...(o.remainderCount != null ? { remainderCount: int(o.remainderCount) } : {}),
      ...(str(o.completedAt) ? { completedAt: str(o.completedAt) } : {}),
      ...(str(o.error) ? { error: str(o.error) } : {}),
    });
  }
  return out.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function getAbTests(): Promise<AbTest[]> {
  return readRow(MARKETING_ABTESTS_KEY, parseAbTests);
}

export async function addAbTest(test: AbTest): Promise<AbTest[]> {
  const list = await getAbTests();
  list.unshift(test);
  await writeRow(MARKETING_ABTESTS_KEY, { tests: list.slice(0, ABTESTS_KEEP) });
  return parseAbTests({ tests: list.slice(0, ABTESTS_KEEP) });
}

export async function updateAbTest(id: string, patch: Partial<AbTest>): Promise<AbTest[]> {
  const list = await getAbTests();
  const t = list.find((x) => x.id === id);
  if (t) Object.assign(t, patch);
  await writeRow(MARKETING_ABTESTS_KEY, { tests: list });
  return parseAbTests({ tests: list });
}

/** Cancel an A/B test that's still in its testing window (before the winner sends). */
export async function cancelAbTest(id: string): Promise<AbTest[]> {
  const list = await getAbTests();
  const t = list.find((x) => x.id === id);
  if (t && t.status === "testing") t.status = "cancelled";
  await writeRow(MARKETING_ABTESTS_KEY, { tests: list });
  return parseAbTests({ tests: list });
}
