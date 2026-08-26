-- Which orders still need attention after the "Phase 4 shows the quotation's
-- full specification" fix.
--
-- The fix derives the spec from the quotation every time a requisition is READ,
-- so the Phase 4 card, the Purchasing workspace and any PO prepared FROM NOW ON
-- are correct for every order automatically — no data change needed.
--
-- The one thing it can't fix is a PO that was already prepared and saved: its
-- line descriptions were copied from the short requisition line at the time, and
-- rewriting a document already sent to a supplier isn't something to do silently.
--
-- This lists exactly those: bought-in requisitions that already carry a PO.
-- For each, open the PO in Purchasing and re-apply the default lines (or edit the
-- description) so the supplier sees the mounting / rated capacity.
select
  q."quoteNumber"                                  as order_no,
  pr.id                                            as request_id,
  pr.status,
  pr.po -> 'poNumber'                              as po_number,
  jsonb_array_length(coalesce(pr.po -> 'lines', '[]'::jsonb)) as po_lines,
  pr.items                                         as requisition_lines
from "PurchaseRequest" pr
join "Quotation" q on q.id = pr."quotationId"
where pr."quotationId" is not null
  and pr.note like 'Bought-in items for order%'
  and pr.po is not null
  and pr.po <> '{}'::jsonb
order by q."quoteNumber";

-- Every bought-in requisition, PO or not — useful to confirm the fix landed:
-- after deploying, the Phase 4 card for each of these shows the full spec.
-- select q."quoteNumber" as order_no, pr.status, (pr.po is not null and pr.po <> '{}'::jsonb) as has_po, pr.items
-- from "PurchaseRequest" pr
-- join "Quotation" q on q.id = pr."quotationId"
-- where pr.note like 'Bought-in items for order%'
-- order by q."quoteNumber";
