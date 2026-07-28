# Project guidance for Claude

## 🔒 Frozen area — Order Phases 1, 2, 3 & 4: do NOT change without explicit owner approval

The order workflow's **Phase 1 (Order intake & payment clearing)**, **Phase 2 (Job
orders & production)**, **Phase 3 (Materials / MRF)**, and **Phase 4 (Purchasing)**
are **locked**. Do not
modify, refactor, "improve", or extend any of them unless the repository owner
explicitly approves that specific change in the current conversation. If a
requested task would touch these areas, stop and ask for approval first — even for
a small tweak or a change that seems obviously correct. When in doubt about
whether something is part of a frozen area, ask before editing.

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
