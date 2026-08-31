# Project guidance for Claude

## 🔒 Frozen area — Order Phases 1, 2, 3, 4 & 5: do NOT change without explicit owner approval

The order workflow's **Phase 1 (Order intake & payment clearing)**, **Phase 2 (Job
orders & production)**, **Phase 3 (Materials / MRF)**, **Phase 4 (Purchasing)**, and
**Phase 5 (Final payment, quality, delivery & documents)**
are **locked**. Do not
modify, refactor, "improve", or extend any of them unless the repository owner
explicitly approves that specific change in the current conversation. If a
requested task would touch these areas, stop and ask for approval first — even for
a small tweak or a change that seems obviously correct. When in doubt about
whether something is part of a frozen area, ask before editing.

> **All five phases were tested and signed off by the owner on 2026-08-09.** Every
> order workflow is now considered verified and locked. From this point on, change a
> workflow **only** when the owner explicitly approves that specific change in the
> current conversation — this applies to *every* phase equally, not just the ones
> listed below. UI-only, copy/label, or non-workflow changes are fine; anything that
> alters who acts, the step order, the gating, or the stage progression needs approval
> first.

### Phase 1 · Order intake & payment clearing

The approval sign-offs that take an order from intake through documents-checked
and payment-cleared to job-orders-released.

- The Phase 1 card in `src/app/(app)/orders/[id]/page.tsx`.
- The early order stages and their advance actions in
  `src/app/(app)/orders/actions.ts` (documents checked, payment cleared & job
  orders released, and the stage progression up to `released`).
- The `OrderStage` progression / stamps in `src/lib/order-workflow.ts`.

### Phase 2 · Job orders & production

Generating, issuing, receiving and running the department job orders.

- `src/app/(app)/orders/[id]/job-order-manager.tsx`
- `src/app/(app)/orders/[id]/fans-job-order-panel.tsx`
- `src/app/(app)/orders/[id]/duct-job-order-panel.tsx`
- `src/app/(app)/orders/[id]/accessories-job-order-panel.tsx`
- `src/app/(app)/orders/[id]/motor-controller-job-order-panel.tsx`
- `src/app/(app)/orders/[id]/dept-production-controls.tsx`
- `src/app/(app)/orders/[id]/autofill-jo-button.tsx`
- `src/lib/job-order-autogen.ts` (incl. `buildAutoJobOrders`,
  `quotationJobOrderDepts`) and `src/lib/accessories-job-order.ts`
- The job-order server actions in `src/app/(app)/orders/actions.ts`
  (`autofillJobOrders`, `issueJobOrders`, `receiveJobOrders`, `setJobOrderDue`,
  and the department production advance) and the job-order types / status logic in
  `src/lib/order-workflow.ts`.

### Phase 3 · Materials (MRF)

The Material Request Form workflow and the order's Phase 3 · Materials logic.

- The MRF lifecycle & statuses: `requested → issued / purchasing / partial →
  (released) → completed / cancelled`, and the under-issued / shortfall logic.
- The handshake flow: warehouse checks availability first → issue from stock or
  send to purchasing → **Release to requestor** (Warehouse / Purchaser / Payment
  Approver / Admin, with the stock-item picker + inventory deduction) → the
  requesting department's **"<Dept> Request Received"** confirmation.
- Follow-up / Inform-requestor / Release actions and their role gating.
- Issued-quantity tracking and its display ("Issued 1 of 2", etc.).
- The **"Materials — MRF status"** feed on My Dashboard: its status labels and who
  sees it (Admin, Warehouse, Purchaser, Plant Manager, and each requesting
  department head for their own department).
- The Phase 3 · Materials UI on the order page (triage panel, MRF cards, buttons).

Files:

- `src/app/(app)/orders/[id]/material-requests.tsx`
- `src/app/(app)/orders/[id]/mrf-triage-panel.tsx`
- `src/app/(app)/orders/[id]/stock-match-panel.tsx`
- The MRF server actions in `src/app/(app)/orders/actions.ts`
  (`raiseMaterialRequest`, `processMaterialRequest`, `cancelMaterialRequest`,
  `confirmMaterialReceipt`, `followUpMaterialRequest`, `informMaterialAvailable`,
  `releaseMaterialToRequestor`, and the MRF status computation)
- The `MaterialRequest` / `MRFItem` / `MaterialRequestStatus` types and their
  coercion in `src/lib/order-workflow.ts`
- The Materials feed (`MaterialNote`, `mrfNote`, feed generation) in
  `src/lib/my-dashboard.ts`
- The "Materials — MRF status" card in `src/app/(app)/my-dashboard/page.tsx`

### Phase 4 · Purchasing

The purchasing chain that turns approved requisitions / MRF-to-purchase lines into
purchase orders, receives them into stock, and reconciles the spend — including the
Cash Voucher.

- The purchasing lifecycle & statuses: requisition / material-request → Plant
  Manager approval → **For purchasing** → PO prepared → issued → received into
  stock → reconciliation (escalate / approve / settle) and returns. The
  combined-PO (multiple requests on one PO) flow and its receiving.
- The **Cash Voucher**: generation from ticked approved requests, the red
  auto-incrementing voucher number (tied to the admin `cash_request_counter`),
  Paid-to = Logistics Head, the signatories (Prepared by = Accounting, Approved by =
  Payment Approver / Admin, Received by = Logistics Head), claim-on-print, the
  printed-voucher registry, and the voucher-vs-approved-PO tally reported to the
  management dashboard.
- The PO document/registry, supplier & payment-terms selection, PO numbering, and
  the reconciliation / voucher-reconciliation reporting.
- The Phase 4 · Purchasing card on the order page (monitoring / read-only
  `PurchasingChain`) and the flashing "awaiting approval" badge for the next
  approver.

Files:

- `src/app/(app)/orders/[id]/purchasing-chain.tsx` and the Phase 4 card in
  `src/app/(app)/orders/[id]/page.tsx`
- The Purchasing workspace: `src/app/(app)/purchasing/page.tsx`,
  `purchasing-workspace.tsx`, `combined-purchasing.tsx`,
  `admin-purchase-override.tsx`, `purchase-reconcile-panel.tsx`,
  `purchase-returns-panel.tsx`, `replenishment-list.tsx`
- The PO view / export: `src/app/(app)/purchasing/po/[prId]/` (view + xlsx)
- The Cash Voucher: `src/app/(app)/purchasing/voucher/page.tsx` and
  `print-button.tsx`
- Requisitions: `src/app/(app)/requisitions/` (`page.tsx`, `requisition-form.tsx`,
  `requisitions-list.tsx`)
- The purchasing libs: `src/lib/purchase-chain-row.ts`, `purchase-order.ts`,
  `purchase-batch.ts`, `purchase-reconcile.ts`, `purchase-returns.ts`,
  `purchasing.ts`, `po-catalog.ts`, `po-html.ts`, `purchase-voucher.ts`,
  `purchaser-signatory.ts`, and `src/lib/excel/purchase-order-xlsx.ts`
- The purchasing server actions in `src/app/(app)/orders/actions.ts`
  (`createDepartmentRequisition`, `advancePurchaseRequest`, `savePurchaseOrder`,
  `createCombinedPO`, `updateCombinedPO`, `advanceCombinedPO`, `receiveCombinedPO`,
  `receivePurchaseRequest`, `returnPurchaseItems`, `resolvePurchaseReturn`,
  `recordReconciliation`, the reconciliation-receipt actions, `escalateReconciliation`,
  `approveReconciliation`, `settleReconciliation`, `escalateReconcileAiRead`,
  `resetReconcileAiRead`, `adminRollbackPurchase`, `cancelPurchaseRequest`,
  `deletePurchaseRequest`) and the purchaser-signatory actions in
  `src/app/(app)/admin/purchaser-signatory/actions.ts`
- The purchase-request / PO / reconciliation types & status logic in
  `src/lib/order-workflow.ts`

### Phase 5 · Final payment, quality, delivery & documents

The delivery phase — single-delivery and multiple-batch — from clearing the final
payment through quality checks, delivery, proof of delivery and the closing
documents that close the order.

- The delivery sequence & stamps: **final payment checked → confirmed** → quality
  (**QA tested → plant QC → transferred → Sales 2nd QC**) → **delivery documents →
  delivered → POD approved → documents surrendered → received → filed (order
  closed)**, and the single-vs-multiple delivery-mode switch.
- The **final payment gate**: the "Final Payment Checked" button stays disabled
  until the final-payment proof is attached; the closing-documents gate (Sales
  Invoice / OR-CR-AF / Delivery Receipt, plus BIR 2307 for VAT-inclusive).
- The **proof of delivery** handshake (Logistics attaches before "Mark delivered";
  Sales approves the POD) and the document-view access that lets client-restricted
  roles open the POD files they handle.
- **Multiple-batch delivery**: opening a batch, running each batch through the full
  sequence, per-batch payment (payment-first) and the order-level "Record payment"
  receivables box (Accounting / Payment Approver / admin), the payment
  details & records list, per-batch proof of delivery, and each batch's own closing
  documents (Sales Invoice / OR-CR-AF / Delivery Receipt / BIR 2307).

Files:

- The Phase 5 cards (single delivery, multiple-batch delivery, the batch-delivery
  toggle) in `src/app/(app)/orders/[id]/page.tsx`
- `src/app/(app)/orders/[id]/fulfillment-actions.tsx`,
  `final-payment-proof.tsx`, `sale-document-list.tsx`
- `src/app/(app)/orders/[id]/multi-batch-panel.tsx`, `multi-delivery-entry.tsx`,
  `batch-delivery-toggle.tsx`
- The per-batch document list on the quotation tab:
  `src/app/(app)/quotations/[id]/batch-document-list.tsx`
- The delivery libs: `src/lib/delivery-multibatch.ts` and the Phase 5 stages /
  step definitions in `src/lib/order-workflow.ts`
- Sale-document access control: `src/lib/sale-doc-access.ts` and the
  `src/app/api/sale-uploads/` view / download routes
- The Phase 5 server actions in `src/app/(app)/orders/actions.ts`
  (`checkFinalPayment`, `confirmFinalPayment`, `qaTest`, `qaPlantCheck`,
  `qaTransfer`, `qaSalesCheck`, `prepareDeliveryDocs`, `markDelivered`,
  `approveDelivery`, `surrenderDeliveryDocs`, `confirmDocsReceived`,
  `fileDocuments`, `saveCloseDoc`, `removeCloseDoc`, `setBatchDeliveryEnabled`,
  `setMultiDelivery`, `createMultiBatch`, `advanceMultiBatch`, `cancelMultiBatch`,
  `recordOrderPayment`, `saveMultiBatchPod`, `removeMultiBatchPod`,
  `saveMultiBatchDoc`, `removeMultiBatchDoc`, `removeMultiBatchProof`) and the
  delivery / batch types & status logic in `src/lib/order-workflow.ts`

## 🧭 Permission changes — update the capability grid in the same commit

A run of individually-correct permission changes shut the Payment Approver out of
the Inventory page they give final approval on, and left them allowed by the
server to upload a catalogue file with no button to do it. Neither was caught by
typecheck, lint or the build; both reached the owner.

**The rules live in `src/lib/catalogue-access.ts`** — `inventoryAccess()` and
`productsAccess()`, pure functions over (user, role map). Do not add role
booleans back into the page components: inline gates are what made the blast
radius of a change invisible.

**`src/lib/catalogue-access.test.ts` is the policy**, asserted for every role at
once. Change a rule → update the expected table in the same commit, and read
every cell that moved. The moved cells ARE the blast radius.

**Before a PR that touches permissions or screens**, run the role harness — it
boots the real app on a throwaway copy of your working tree and reports what each
role can actually see and press:

```
node scripts/role-harness.mjs          # table per role
node scripts/role-harness.mjs --keep   # leave it up and click around
```

The grid catches wrong *rules* in milliseconds; the harness catches wrong
*screens* — a button on the wrong flag, a page that refuses someone the nav just
invited. Every permission bug that reached the owner was of the second kind.

## 🔐 Database migrations — always enable RLS on new tables

Supabase exposes every `public`-schema table through its REST API (authenticated
by the public anon key). This app never uses that API for data — all data access
is via **Prisma** as the table owner (`postgres`), which **bypasses RLS** — so we
keep every public table under **RLS with no policies** (deny-all for the public
API, invisible to Prisma). See migration `0038_enable_rls`.

**Rule:** any migration that **creates a table** MUST end with the idempotent
enable-RLS block below, so a new table never ships with RLS disabled (which would
re-trigger the Supabase `rls_disabled_in_public` advisory):

```sql
do $$
declare t record;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security;', t.tablename);
  end loop;
end $$;
```

Do **not** add policies (deny-all is intended) and do **not** use `FORCE ROW
LEVEL SECURITY` (that would also block the owner / Prisma).
