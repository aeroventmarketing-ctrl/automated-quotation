-- Per-event label colour (TimeTree-style) and an optional URL on calendar events.
-- Idempotent; safe to run in the Supabase SQL editor.
ALTER TABLE "Schedule" ADD COLUMN IF NOT EXISTS "color" TEXT;
ALTER TABLE "Schedule" ADD COLUMN IF NOT EXISTS "url" TEXT;
