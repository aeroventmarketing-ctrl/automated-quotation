-- Fan-body cost of goods sold for the departmental P&L. Looked up by exact model
-- code first, else by size + material. Idempotent for the Supabase SQL editor.

CREATE TABLE IF NOT EXISTS "FanBodyCogs" (
  "id"            TEXT NOT NULL,
  "modelCode"     TEXT,
  "size"          TEXT,
  "material"      TEXT,
  "cost"          DECIMAL(14,2) NOT NULL DEFAULT 0,
  "note"          TEXT,
  "createdByName" TEXT NOT NULL,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "FanBodyCogs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "FanBodyCogs_modelCode_idx" ON "FanBodyCogs" ("modelCode");
CREATE INDEX IF NOT EXISTS "FanBodyCogs_size_material_idx" ON "FanBodyCogs" ("size", "material");
