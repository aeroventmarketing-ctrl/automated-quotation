-- Shared team calendar. Any user may add a schedule (starts PENDING); an
-- Engineer, Admin or Approver approves or rejects it. Idempotent so it can be
-- run safely in the Supabase SQL editor.

DO $$ BEGIN
  CREATE TYPE "ScheduleStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

CREATE TABLE IF NOT EXISTS "Schedule" (
  "id"            TEXT NOT NULL,
  "title"         TEXT NOT NULL,
  "details"       TEXT,
  "category"      TEXT NOT NULL DEFAULT 'general',
  "startAt"       TIMESTAMP(3) NOT NULL,
  "endAt"         TIMESTAMP(3),
  "allDay"        BOOLEAN NOT NULL DEFAULT true,
  "location"      TEXT,
  "status"        "ScheduleStatus" NOT NULL DEFAULT 'PENDING',
  "createdById"   TEXT NOT NULL,
  "createdByName" TEXT NOT NULL,
  "decidedById"   TEXT,
  "decidedByName" TEXT,
  "decidedAt"     TIMESTAMP(3),
  "decisionNote"  TEXT,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Schedule_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "Schedule_startAt_idx" ON "Schedule" ("startAt");
CREATE INDEX IF NOT EXISTS "Schedule_status_idx" ON "Schedule" ("status");
