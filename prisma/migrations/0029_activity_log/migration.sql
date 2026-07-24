-- System activity feed powering the dashboard notification bell. One row per
-- notable action (approvals, stage changes, lifecycle events). Idempotent so it
-- can be run safely in the Supabase SQL editor.

CREATE TABLE IF NOT EXISTS "ActivityLog" (
  "id"        TEXT NOT NULL,
  "action"    TEXT NOT NULL,
  "category"  TEXT NOT NULL DEFAULT 'general',
  "summary"   TEXT NOT NULL,
  "entity"    TEXT,
  "entityId"  TEXT,
  "href"      TEXT,
  "actorId"   TEXT,
  "actorName" TEXT NOT NULL DEFAULT 'System',
  "meta"      JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ActivityLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "ActivityLog_createdAt_idx" ON "ActivityLog" ("createdAt");
CREATE INDEX IF NOT EXISTS "ActivityLog_category_idx" ON "ActivityLog" ("category");
