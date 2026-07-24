-- TimeTree-style calendar features: recurrence, in-app reminders, named
-- calendars, attendees/RSVP, attachments and per-event comments. All columns are
-- nullable and added idempotently so this is safe to run in the Supabase editor.

ALTER TABLE "Schedule" ADD COLUMN IF NOT EXISTS "recurrence"      TEXT;
ALTER TABLE "Schedule" ADD COLUMN IF NOT EXISTS "recurrenceUntil" TIMESTAMP(3);
ALTER TABLE "Schedule" ADD COLUMN IF NOT EXISTS "remindMinutes"   INTEGER;
ALTER TABLE "Schedule" ADD COLUMN IF NOT EXISTS "calendar"        TEXT;
ALTER TABLE "Schedule" ADD COLUMN IF NOT EXISTS "attendees"       JSONB;
ALTER TABLE "Schedule" ADD COLUMN IF NOT EXISTS "attachments"     JSONB;
ALTER TABLE "Schedule" ADD COLUMN IF NOT EXISTS "comments"        JSONB;
