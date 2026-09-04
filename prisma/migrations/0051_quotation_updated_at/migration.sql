-- Quotation.updatedAt — so the app can ask "has anything changed?" cheaply.
--
-- The pages auto-refresh, and until now each refresh re-ran the whole page's
-- queries whether or not anything had changed. /orders re-read all 1,142
-- quotations — 3.2 MB — every eight seconds per open tab, which came to roughly
-- 2.1 TB of egress a month and enough load to take the app down.
--
-- With this column the browser can poll a single indexed row instead: max
-- updatedAt plus a row count, about a hundred bytes, and only do the expensive
-- refresh when that changes. Every other table in this schema already had an
-- updatedAt; Quotation was the one that did not.
--
-- Existing rows get the current time, which is correct for the purpose: the
-- token only has to CHANGE when data changes, and everything is "as of now" the
-- moment this runs.
--
-- Creates no table, so no RLS block is needed (the table already has RLS from
-- 0038_enable_rls and keeps it).

alter table "Quotation"
  add column if not exists "updatedAt" timestamp(3) not null default current_timestamp;

-- The token reads max("updatedAt"); an index keeps that a single lookup rather
-- than a scan as the table grows.
create index if not exists "Quotation_updatedAt_idx" on "Quotation" ("updatedAt");
