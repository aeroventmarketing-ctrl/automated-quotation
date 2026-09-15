-- Schedule(recurrence, status) — for the reminder poll's second query.
--
-- Every open tab polls /api/calendar/reminders once a minute, and that route runs
-- two queries. The first is bounded by `startAt` and the existing
-- `Schedule_startAt_idx` already serves it (an index scan, seven buffers). The
-- second cannot be bounded by date — a weekly series that began last year still
-- fires this week — so it asks for the recurring events directly, and with no
-- index for that it read the WHOLE table to find them.
--
-- Measured on a three-year calendar of 3,000 events, six of them recurring:
--
--   before   Seq Scan, 3,000 rows examined, 375 buffers, 1.298 ms
--   after    Index Scan, 2 buffers, 0.064 ms
--
-- `recurrence` leads because it is the selective half: almost every row is NULL
-- there, and a b-tree indexes NULLs, so `recurrence IS NOT NULL` is a range at
-- the end of the index rather than a filter over the table. `status` rides along
-- so the second condition is answered from the same scan.
--
-- Creates no table, so no RLS block is needed (the table already has RLS from
-- 0038_enable_rls and keeps it).

create index if not exists "Schedule_recurrence_status_idx"
  on "Schedule" ("recurrence", "status");
