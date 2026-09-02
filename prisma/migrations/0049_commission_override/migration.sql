-- Sales Head override: one sale can owe two people.
--
-- The rep who closed it earns 1.5% (kind 'base'); the Sales Head earns 0.25% on
-- the same sale (kind 'override'). The old `quotationId UNIQUE` allowed only one
-- payout record per order, so the override had nowhere to live — uniqueness moves
-- to (quotationId, kind), and the same for counter sales.
--
-- Creates no table, so no RLS block is needed (the table already has RLS from
-- 0038_enable_rls and keeps it).

alter table "Commission" add column if not exists "kind" text not null default 'base';

-- Existing rows are all the rep's own commission; the default already says so.
update "Commission" set "kind" = 'base' where "kind" is null or "kind" = '';

-- Prisma named these from the single-column @unique; drop whichever form exists.
alter table "Commission" drop constraint if exists "Commission_quotationId_key";
alter table "Commission" drop constraint if exists "Commission_counterSaleId_key";
drop index if exists "Commission_quotationId_key";
drop index if exists "Commission_counterSaleId_key";

create unique index if not exists "Commission_quotationId_kind_key"
  on "Commission" ("quotationId", "kind");
create unique index if not exists "Commission_counterSaleId_kind_key"
  on "Commission" ("counterSaleId", "kind");
