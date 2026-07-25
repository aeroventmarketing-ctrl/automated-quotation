-- TimeTree-style to-do checklist on calendar events. Idempotent.
ALTER TABLE "Schedule" ADD COLUMN IF NOT EXISTS "todos" JSONB;
