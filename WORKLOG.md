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
- **Pending — STEP 2 (office-pickup Phase-5 variant, NOT yet built):** see the dedicated
  spec entry below ("Office pickup workflow — CONFIRMED spec + design"). Supersedes the
  earlier stock-based draft that used to live here.

## 2026-08-07 · Office pickup workflow — CONFIRMED spec + design (STEP 2, pending build)
- **Owner-confirmed decisions:**
  - **Architecture = "branch only where it differs."** Reuse the existing normal order
    flow for Phases 1–2, final payment, docs-received/file and the whole commission
    flow. Add an office-pickup variant ONLY for the Phase-5 **QA → delivery** segment,
    gated behind `wf.officePickup`. Do **NOT** modify the normal (non-pickup) flow.
  - **Delivery mode = single OR multi-batch pickup**, chosen by the SAME toggle as
    normal delivery (`batchDeliveryEnabled` / `deliveryMode`). So the pickup variant
    must apply to BOTH the single Phase-5 flow AND the per-batch multi-batch flow.
- **Where the pickup path diverges from the normal flow (only this segment differs):**

  | Step | Office pickup | Normal flow today |
  |---|---|---|
  | QA test | Technical Head / Quality Inspector → "Quality tested – Passed" | 2nd Quality Inspector |
  | Plant check | Plant Manager "Quality & Quantity Approved" (ONE step; only approved qty transfers) | plant QC → transfer → Sales 2nd QC (three steps) |
  | Delivery form | Warehouseman makes delivery form | Accounting makes delivery docs |
  | Approve delivery | Plant Manager "Approve Delivery" | Accounting "Save Documents & Approve Delivery" |
  | POD upload | Warehouseman uploads delivery form + proof of delivery | Logistics attaches POD / marks delivered |
  | POD approve | Sales "Approve POD – Successful Delivery" | Sales (same) |
  | Docs surrender | *(skipped)* | Sales surrenders signed docs → Accounting receives |

- **Identical to the normal flow (reused as-is, no changes):** steps 8–21 (payment
  cleared → JO create/issue → Plant Manager JO received → distribute → Start Production →
  MRF → follow-up → Mark Finished → Notify Client-Order Ready → billing (skip) → final
  pay → Final Payment Checked → Confirm Final Payment) and steps 28–37 (Confirm Documents
  Received → File Documents-Close Order → the full commission flow: Approve Commission
  Amount → Prepare Commission Voucher → Approve Commission Voucher → Release Commission
  Budget → Mark Commission received → upload signed voucher → accounting-closed).
- **Full owner-supplied spec (steps 8–37):** step 8 Clear Payment & release from stock;
  9 Engineer makes JO; 10 Engineer "Issue job orders" → to Plant Manager; 11 Plant
  Manager "Job Order Received" → distributes to fans/duct/accessories/motor; 12
  Production "Start Production"; 13 depts raise MRF to warehouseman; 14 warehouseman
  issues available materials; 15 Sales may follow up production; 16 Head of Production
  "Mark Finished"; 17 Sales "Notify Client-Order Ready" (start of fulfillment / optional
  multi-batch); 18 Accounting billing statement (skippable, no details yet); 19 client
  final pay; 20 Accounting "Final Payment Checked"; 21 Approver/admin "Confirm Final
  Payment"; 22 Technical Head / Quality Inspector "Quality tested – Passed"; 23 Plant
  Manager "Quality & Quantity Approved"; 24 Warehouseman makes delivery form; 25 Plant
  Manager "Approve Delivery"; 26 Warehouseman uploads delivery form + proof of delivery;
  27 Sales "Approve POD – Successful Delivery"; 28 Accounting "Confirm Documents
  Received"; 29 Accounting "File Documents-Close Order"; 30 order closed → commission
  computed; 31 Admin/approver "Approve Commission Amount"; 32 Accounting "Prepare
  Commission Voucher"; 33 Admin/approver "Approve Commission Voucher"; 34 Admin/approver
  "Release Commission Budget"; 35 Sales receives, Accounting "Mark Commission received";
  36 Accounting uploads voucher signed by sales exec; 37 accounting-closed once received
  (commission issued 15 days after the sales month).
- **Roles all already exist** in `workflow-roles.ts`: `technical_head`,
  `quality_inspector`, `warehouse` (Warehouseman), `plant_manager`.
- **Build plan (staged, reviewable):** (A) single-pickup Phase-5 variant first; (B) then
  apply the same variant per batch in the multi-batch flow. All gated on `officePickup`.

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
