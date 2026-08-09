/**
 * Persistence for the admin-editable per-nudge follow-up templates (subject +
 * body for nudge 1, 2, 3 …). Stored in the AppSetting key/value table (no
 * migration). Falls back to the built-in DEFAULT_FOLLOWUP_TEMPLATES when unset,
 * so the follow-up engine always has copy to send.
 */
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { DEFAULT_FOLLOWUP_TEMPLATES, type FollowUpTemplate } from "@/lib/follow-up-email";

export const FOLLOWUP_TEMPLATES_KEY = "follow_up_templates";

const str = (v: unknown): string => (typeof v === "string" ? v : "").trim();

/** Coerce stored JSON into a clean template list (drops empty / malformed rows). */
export function coerceTemplates(value: unknown): FollowUpTemplate[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((v): FollowUpTemplate | null => {
      if (!v || typeof v !== "object") return null;
      const o = v as Record<string, unknown>;
      const subject = str(o.subject);
      const body = str(o.body);
      return subject || body ? { subject, body } : null;
    })
    .filter((t): t is FollowUpTemplate => !!t);
}

/** The saved per-nudge templates, or the built-in defaults when never customized. */
export async function getFollowUpTemplates(): Promise<FollowUpTemplate[]> {
  const row = await prisma.appSetting.findUnique({ where: { key: FOLLOWUP_TEMPLATES_KEY } });
  const saved = coerceTemplates(row?.value);
  return saved.length ? saved : DEFAULT_FOLLOWUP_TEMPLATES.map((t) => ({ ...t }));
}

/** Persist the per-nudge templates (returns the normalized value that was stored). */
export async function setFollowUpTemplates(list: FollowUpTemplate[]): Promise<FollowUpTemplate[]> {
  const clean = coerceTemplates(list);
  const toStore = clean.length ? clean : DEFAULT_FOLLOWUP_TEMPLATES.map((t) => ({ ...t }));
  const value = toStore as unknown as Prisma.InputJsonValue;
  await prisma.appSetting.upsert({
    where: { key: FOLLOWUP_TEMPLATES_KEY },
    create: { key: FOLLOWUP_TEMPLATES_KEY, value },
    update: { value },
  });
  return toStore;
}
