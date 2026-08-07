# Work log

A running record of completed work and open follow-ups, so a fresh Claude Code
session (which always starts with no memory of past sessions) can catch up fast
and we never redo something that's already done.

**How to use it**
- Newest entry on top.
- One block per task: what changed, why, the PR, and anything still pending.
- At the end of a task, say "log it" (or Claude adds an entry as part of finishing)
  and commit the change together with the work.
- A SessionStart hook prints the top of this file automatically at the start of
  every session — see `.claude/hooks/session-start.sh`.

---

## 2026-08-07 · Office pickup — multi-batch pick up (client collects in batches)
- **Feature (owner-requested, frozen Phase 5 multi-batch):** an office-pickup order can be
  picked up in **multiple batches**; each batch repeats the pickup Phase-5 sequence (the
  owner's steps 12–19). Reuses the existing multi-batch **delivery** engine with a pickup
  step variant — the normal multi-batch delivery flow is unchanged (all gated on
  `wf.officePickup`).
- **Per-batch pickup sequence** (`MULTIBATCH_PICKUP_STEPS`): notify client (batch ready
  for pick up) → payment checked (collects partial payment) → payment confirmed → quality
  tested (**2nd Quality Inspector**) → save documents & approve pick up (Accounting) →
  **Approve POD — successful pick up** (**Sales**; uploads the proof of pick up + approves
  in one combined step, matching the single-pickup flow) → documents surrendered
  (**Sales**) → confirm documents received (Accounting) → file documents — batch picked up
  (Accounting). **Skips** the delivery-only plant-QC → transfer → Sales-2nd-QC. Shares step
  KEYS with the delivery list; the combined POD+approve step reuses the `delivered` key so
  the POD gate, delivered-qty tracking and close trigger work unchanged.
- **Toggle** (`MultiBatchPickupToggle` + `setMultiBatchPickup`): a single "Multi-batch pick
  up" toggle. **Admin** can turn it on/off any time; a **non-admin** (salesperson) can turn
  it ON but **not off** — once on, only an admin can turn it off (enforced server-side).
  Turning on sets `batchDeliveryEnabled` + `deliveryMode: "multi"`.
- **Where:**
  - `src/lib/delivery-multibatch.ts` — `MULTIBATCH_PICKUP_STEPS`; `mbSteps(officePickup)`;
    `mbStepDef`/`mbProgress` gained an `officePickup` arg.
  - `src/app/(app)/orders/actions.ts` — `advanceMultiBatch` passes `wf.officePickup`;
    `saveMultiBatchPod`/`removeMultiBatchPod` allow **Sales** for pickup; new
    `setMultiBatchPickup`.
  - `src/lib/my-dashboard.ts` — batch `mbProgress` passes `wf.officePickup`.
  - `src/app/(app)/orders/[id]/page.tsx` — batch step-views use `mbSteps(officePickup)`;
    the pickup toggle card + pickup-aware multi-mode card; `MultiBatchPanel` gets
    `officePickup`.
  - `src/app/(app)/orders/[id]/multi-batch-panel.tsx` — `officePickup` prop relabels
    "delivery" → "pick up".
  - `src/app/(app)/orders/[id]/multi-batch-pickup-toggle.tsx` — NEW.
- **Combined per-batch POD step (owner-requested):** the proof-of-pick-up upload and the
  POD approval are now **one** Sales step per batch (the `delivered` step relabeled
  "Approve POD — successful pick up"; the separate `delivery_confirmed` step was dropped
  from the pickup list) — matching the single-pickup flow. No other engine change needed.

## 2026-08-07 · Inquiries list — show the WON amount
- **Owner-requested:** the Inquiries list now shows the **won amount** under the status
  badge for any inquiry with a confirmed (won) quotation. Amount = sum of
  `payableTotal(q)` over the inquiry's confirmed quotations — the **same basis as the WON
  sales report** (`isSaleConfirmed(saleFromClassification(...))`), so the two reconcile.
- **Where:** `src/app/(app)/inquiries/page.tsx` (query now selects each quotation's
  `total/discountPct/vatMode/currency/classification`; computes `wonAmount` + `currency`
  per row) and `src/app/(app)/inquiries/inquiries-table.tsx` (renders the amount in
  emerald under the badge when `wonAmount > 0`).

## 2026-08-07 · Office pickup — "Pick Up" button wording in Phase 5
- **Owner-requested label change (pickup only):**
  - "Save Documents & Approve Delivery" → **"Save Documents & Approve Pick Up"**
    (`DeliveryDocsForm` gained an `officePickup` prop; passed through from
    `fulfillment-actions.tsx`; the normal delivery flow keeps "…Approve Delivery").
  - "Approve POD - Successful Delivery" → **"Approve POD - Successful Pick Up"**
    (`PickupPodForm` is pickup-only, changed directly — button + enable hint).

## 2026-08-07 · Office pickup — one-step "Release from Stock and Notify Client"
- **Feature (owner-requested, frozen Phase 2 stock-release):** when the **Office pick up**
  flag is on, the from-stock Phase-2 panel collapses the normal two steps (Plant
  Manager/Engineer **approve** → Warehouse **release**) into a **single** action:
  **"Release from Stock and Notify Client"**, pressed by the Plant Manager / Engineer
  (in-house duct hardware only) / admin. It picks the stock item(s), deducts inventory,
  and advances straight to final payment (client notified) — then Accounting issues the
  billing statement (skippable) and the client makes the final payment as before.
- **Gated on `officePickup`** — the normal from-stock flow keeps its two steps unchanged.
- **Refinements (owner-requested):**
  - The pickup release is the **Engineer's** action alone — **not** the Plant Manager.
    `releaseOrderFromStock` (pickup branch) gates on Engineer / admin only; `pendingStep`
    returns `{ roles: [], engineer: true }` so the "waiting for" banner, My Dashboard,
    the orders list and the approver alarm all show **Engineer** only; the panel wording
    is "Awaiting the Engineer to release from stock and notify the client"; the
    Phase-2 approve gate (`canApprove`) drops Plant Manager for pickup.
  - **Toggle-lock policy:** an **admin** can flip Office pick up on/off at any time; a
    **non-admin** (salesperson) can set it only while the order is still in Phase 2
    (`stageIndex(wf.stage) <= "released"`), after which it locks for them (they see the
    read-only tag). `canSetPickup` = `stockOnly && (admin || (preparer && pickupWindowOpen))`.
  - **Normal (non-pickup) from-stock release is now Plant-Manager-only** — the mirror of
    the pickup rule, so the two workflows partition cleanly: **Engineer → office pickup**,
    **Plant Manager → normal from-stock**. This **supersedes #241/#243** (which had let an
    Engineer approve normal from-stock release for duct hardware). `approveStockRelease`
    now gates on Plant Manager / admin only; `pendingStep` drops the `engineer` flag from
    the normal approve step (so the banner / My Dashboard / orders list / alarm show
    **Plant Manager** only); `StockRelease` wording is "Awaiting Plant Manager approval";
    the Phase-2 `canApprove` for non-pickup drops the Engineer. (`isDuctHardwareStockOnly`
    import removed from `actions.ts`; `engineerApprovesStock` is now unused by `pendingStep`
    but still passed by callers.)
- **Where:**
  - `src/app/(app)/orders/actions.ts` — `releaseOrderFromStock` now branches on
    `wf.officePickup`: for pickup it gates on Plant Manager / Engineer(duct-hardware) /
    admin and does NOT require a prior approval stamp; it stamps both
    `stock_release_approved` and `client_notified`. Normal flow still needs the Warehouse
    role + prior approval.
  - `src/lib/order-workflow.ts` — `pendingStep` "released" case returns a single
    "Release from stock & notify client" step for pickup orders.
  - `src/app/(app)/orders/[id]/stock-release.tsx` — `officePickup` prop; single combined
    button that opens the stock picker; shared `release()` helper.
  - `src/app/(app)/orders/[id]/page.tsx` — passes `officePickup` to `StockRelease`.

## 2026-08-07 · Office pickup workflow — STEP 2 built (from-stock, pickup Phase 5)
- **Feature (owner-approved, frozen Phases 1/2/5):** when the **Office pick up** flag is
  on, the order follows a from-stock pickup path. Confirmed with the owner: office pickup
  is **from-stock only** (reuses the existing release-from-stock spine, which already
  skips Phase 2 production and jumps to final payment), and only the **Phase-5 tail**
  differs. The normal (non-pickup) flow is **not modified** — every change gates on
  `wf.officePickup`.
- **Pickup Phase-5 divergences (vs the normal from-stock flow):**
  - QA test performed by the **2nd Quality Inspector** (`quality_inspector_2`) — added to
    the `qaTest` gate + `canQaTest` perm + UI wording when pickup.
  - **Skips** plant-QC → transfer → Sales-2nd-QC: `prepareDeliveryDocs` accepts stage
    `qa_tested` when pickup (→ `delivery_docs_ready`), and the UI shows the delivery-docs
    form straight after the quality test.
  - **Sales** uploads the proof of pick up AND approves in one step — new action
    `approvePickupDelivery` (delivery_docs_ready → delivery_confirmed, requires the pod
    file) + new `PickupPodForm` component (mirrors `DeliveredForm`, Sales-facing).
  - **Sales** surrenders the signed docs (not Logistics): `surrenderDeliveryDocs` gates
    on Sales when pickup.
  - `loadForCloseDoc` now also lets **Sales** attach the `pod` slot (proof of pick up).
  - Confirm-received → file → commission are reused unchanged.
- **Where:**
  - `src/app/(app)/orders/actions.ts` — `setOfficePickup` now rejects non-from-stock
    orders; `qaTest`, `prepareDeliveryDocs`, `surrenderDeliveryDocs`, `loadForCloseDoc`
    gained `officePickup` branches; new `approvePickupDelivery`.
  - `src/lib/order-workflow.ts` — `pendingStep` gained an `officePickup` arg and pickup
    branches for `final_pay_cleared` / `qa_tested` / `delivery_docs_ready` /
    `delivery_confirmed`. All 4 callers (`pending-approvals.ts`, `my-dashboard.ts`,
    orders list `page.tsx`, order `page.tsx`) pass `wf.officePickup`.
  - `src/app/(app)/orders/[id]/page.tsx` — `canSetPickup` now also requires `stockOnly`;
    `canQaTest` includes `quality_inspector_2` for pickup; passes `officePickup` to
    `FulfillmentActions`.
  - `src/app/(app)/orders/[id]/fulfillment-actions.tsx` — `officePickup` prop; pickup
    branches for the QA-test / qa_tested / delivery_docs_ready / delivery_confirmed steps.
  - `src/app/(app)/orders/[id]/pickup-pod-form.tsx` — NEW.
- **Progress bar tidied:** the top stage-progress chips now hide the skipped stages
  (`qa_plant_checked` / `qa_transferred` / `qa_sales_checked` / `delivered`) for a pickup
  order (filtered `ORDER_STAGES` when `officePickup`; done/current computed against the
  filtered list). Normal flow shows all chips as before.
- **Scope note:** office pickup is a **single** fulfilment pass (the correct spec has no
  multi-batch; the multi-batch mention belonged to the discarded plant-pickup paste).

## 2026-08-07 · "Office pick up" flag on Phase 2 (step 1 of 2 — flag + tag only)
- **Feature (owner-requested):** an **Office pick up** toggle on the Phase 2 card marks
  an order as collected by the client at the office instead of delivered. **Step 1
  only** (per owner): this **persists the flag and shows a tag** — it does **NOT** yet
  change any Phase 5 delivery logic. Non-destructive / reversible.
- **Where:**
  - `src/lib/order-workflow.ts` — `OrderWorkflow` gained `officePickup?: boolean`,
    coerced from the stored `wf` blob (mirrors `batchDeliveryEnabled`).
  - `src/app/(app)/orders/actions.ts` — new `setOfficePickup(quotationId, enabled)`
    server action, gated on `canManageMultiDelivery` (order's salesperson or admin).
  - `src/app/(app)/orders/[id]/office-pickup-toggle.tsx` — new client toggle
    (mirrors `batch-delivery-toggle.tsx`, `Store` icon).
  - `src/app/(app)/orders/[id]/page.tsx` — derives `officePickup` / `canSetPickup`;
    renders an amber "Office pick up" badge in the order header and a toggle/tag box at
    the top of the Phase 2 card (toggle for Sales/admin, read-only tag for others).
- **Note on frozen areas:** the Phase 2 card is a frozen area — the owner explicitly
  approved adding this checkbox in-conversation. Only additive UI + a new flag were
  added; no existing Phase 2 job-order logic was changed.
- **STEP 2 — office-pickup Phase-5 variant: DONE** (see the next entry below).

## 2026-08-07 · Approval alarm + dashboard now deep-link to the pending phase
- **Feature (owner-requested):** Tapping the flashing "Approval needed" pop-up now
  navigates straight to the order, scrolled to the pending phase card — instead of
  just silencing. My Dashboard's pending order tasks link to the same phase anchor.
- **Behaviour (per owner):** the pop-up auto-jumps to a single order (the most recent
  of those waiting) via a "Go to order {code}" button; other waiting orders are noted
  ("+N more — see My Dashboard"). A separate "Dismiss" button (and tapping outside /
  any key) silences without navigating.
- **Where:**
  - `src/lib/order-workflow.ts` — new `phaseAnchor(stage)` → "phase-1|2|5" (order
    stages only ever sit in Phase 1/2/5).
  - `src/lib/pending-approvals.ts` — `PendingApproval` gained `anchor`; the API
    (`/api/pending-approvals`) passes it through.
  - `src/components/approver-alarm.tsx` — navigation on tap (useRouter), Escape /
    backdrop = dismiss, card tap doesn't dismiss.
  - `src/app/(app)/orders/[id]/page.tsx` — `id="phase-1|2|5"` + `scroll-mt-24` on the
    Phase 1 / 2 / 5 cards (anchor targets; frozen cards, presentational only).
  - `src/lib/my-dashboard.ts` — order task `href` now includes `#phase-N`.
- **Notes:** hash-scroll uses the app's existing pattern (e.g. `/inventory#inv-items`).
  Multi-batch Phase 5 orders fall back to the top of the order page (no separate anchor).
- **Pending:** none.

## 2026-08-07 · Engineer stock-release approval limited to duct hardware (refines #241)
- **Change (owner-approved, frozen Phase 2):** #241 let an Engineer approve ANY from-stock
  release. Per owner, restrict that: an Engineer may approve only when every from-stock line
  is in-house duct hardware — **Duct Angle corner, TDC Cleat, S-clip, C-clip**. If the order
  has any Office-supplied resale stock (AlphaAir, Vent Cap), only the Plant Manager (or admin)
  may approve. Plant Manager/admin still approve everything.
- **New helper:** `isDuctHardwareStockOnly(items)` in `src/lib/department-pnl.ts` — true when
  all from-stock lines classify as `isDuctHardware` (reuses the existing classifiers).
- **Where:** server gate `approveStockRelease` (`actions.ts`) now loads items first and gates
  the Engineer on `isDuctHardwareStockOnly` (clear error otherwise); UI `canApprove` +
  `engineerEligible` wording on the Phase 2 card (`page.tsx`, `stock-release.tsx`); and
  `pendingStep(wf, stockOnly, engineerApprovesStock)` gained a 3rd flag so the `engineer`
  approver flag (banner / dashboard / alarm) is set only for duct-hardware-only orders. All
  four `pendingStep` callers updated (`orders/[id]/page.tsx`, `orders/page.tsx`,
  `my-dashboard.ts`, `pending-approvals.ts`).
- **Pending:** none.

## 2026-08-07 · "Waiting for" for from-stock orders now routes to Warehouse, not the PO step
- **Bug:** On a from-stock order, the Phase 2 "WAITING FOR / APPROVERS" banner (and the
  order-list hint, My Dashboard tasks, and approval alarms) showed "Prepare & process the
  Purchase Order — Purchaser / Technical Head". A from-stock order has no PO; it's released
  from stock by the Warehouse. So the wrong roles were shown and alarmed.
- **Cause:** `pendingStep(wf)` in `src/lib/order-workflow.ts` only saw job-order content;
  a from-stock order has none, so it was treated as bought-in (the PO path). It couldn't
  tell stock-only from bought-in because that distinction lives in the quotation lines.
- **Fix (owner-approved, touches frozen Phase 1/2 routing — display only, no stage/gate
  change):** `pendingStep(wf, stockOnly)` gained an optional flag. For a stock-only order at
  the `released` stage it now returns: not-yet-approved → "Approve stock release" (Plant
  Manager or Engineer), approved → "Release from stock" (Warehouse / Fans & Blowers head).
  Added an `engineer` flag to `PendingStep` (mirrors `sales`). All four callers pass the
  flag and honour the engineer owner: `orders/[id]/page.tsx`, `orders/page.tsx`,
  `src/lib/my-dashboard.ts`, `src/lib/pending-approvals.ts` (the last two now include
  quotation `items` to detect stock-only).
- **Pending:** none.

## 2026-08-07 · Phase 2 stock-release: Engineer can approve too (alongside Plant Manager)
- **Change (owner-approved, frozen Phase 2):** The "For stock release" approval gate
  on a from-stock order now accepts the **Engineer** base role in addition to the
  Plant Manager (and admin). Requested explicitly by the owner.
- **Where:** server gate `approveStockRelease` in `src/app/(app)/orders/actions.ts`
  (added `user.role === "ENGINEER"`), UI gate `canApprove` in
  `src/app/(app)/orders/[id]/page.tsx`, and the wording in
  `src/app/(app)/orders/[id]/stock-release.tsx` ("Awaiting Plant Manager or Engineer
  approval…").
- **Note:** "Engineer" is a base app role (SALES/ENGINEER/ADMIN), not a workflow role —
  hence `user.role === "ENGINEER"`, not a `WorkflowRoleKey` check.
- **Pending:** none.

## 2026-08-07 · Purchasing draft-PO no longer wiped by auto-refresh — PR #239 (merged)
- **Bug:** In the Purchaser role, building a combined PO could lose everything
  typed (lines, quantities, prices, ticked requests, supplier/EWT details) the
  moment a notification arrived.
- **Cause:** The draft lived only in React state. The Purchasing page auto-refreshes
  every 8s and on window focus; when another user acted on a pending request (the
  event that fires the notification), it dropped out of the recomputed list, which
  unmounted the draft form. No server-side deletion was involved.
- **Fix:** Snapshot the selected requests into state when the build starts and drive
  the form from that snapshot; keep the builder mounted while building; keep the
  combine workspace mounted on the builder tab even when the pending list momentarily
  empties. Files: `src/app/(app)/purchasing/combined-purchasing.tsx`,
  `src/app/(app)/purchasing/purchasing-workspace.tsx` (frozen Phase 4 — changed only
  to fix the reported bug).
- **Pending:** Optional follow-up — pause the auto-refresh while a PO form is open,
  so the list can't shift under an active edit at all.

## 2026-08-07 · Purchaser can delete stock items — PR #238 (merged)
- Added a delete control for stock items in the Purchaser role.
- **Pending:** none.
