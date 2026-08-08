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

## 2026-08-08 · Workflow consistency sweep — messages / banners / designations / trail
- **Owner-requested:** make every message, notification and alarm consistent across the whole
  sourcing × fulfilment matrix. Audited via 3 parallel review agents (single-batch text,
  multi-batch tables, notifications/designations/stale wording).
- **Real content fix:** the Plant-Manager quality-check step told **plant-pickup** orders their
  goods "are transferred to the office" — corrected to "released for pick up at the plant"
  (`fulfillment-actions.tsx`).
- **Designations + audit trail now mode-aware** (`orders/[id]/page.tsx`): `APPROVAL_DESIGNATION`
  and the `fTrail` labels reused the same stage keys with the wrong role for plant/office pickup.
  Now: office-pickup `qa_tested` → 2nd Quality Inspector; plant-pickup `qa_transferred` →
  Warehouse ("Delivery form made"), `qa_sales_checked` → Plant Manager ("Delivery approved"),
  `delivered` → Warehouse; from-stock plant-pickup `client_notified` → Plant Manager; pickup
  `delivered`/`delivery_confirmed` trail rows say "Picked up" / "Pick up confirmed".
- **Banner ↔ button alignment** (`order-workflow.ts`): the qaPlantCheck "waiting for" banner is
  now "Quality & Quantity Approved" on both paths (matches the button); the stock-release and
  `delivered` banners match the button casing/wording; from-stock quality-test wording
  consistently says "quality & quantity".
- **Multi-batch table casing** (`delivery-multibatch.ts`): step labels Title-cased to match the
  single-batch buttons (Transferred to Office, Quality & Quantity Approved/Re-Checked/Checked);
  bought-in office-pickup delivered label aligned to "Approve POD — successful pick up".
- **Stale comments/docstrings** refreshed (office pickup = from-stock **or bought-in**;
  `engineerApprovesStock` marked vestigial; stock-release button casing standardised).
- P&L untouched. Typecheck + lint clean. (Low-value cosmetic items — a couple of `done`-string
  and coarse orders-list stage labels — left as-is.)

## 2026-08-08 · Bought-in (Bought to Supplier) workflows — Delivery + Office pick up
- **Owner-requested (frozen Phase 5, owner-approved):** the bought-in Phase 5 is shorter than
  produced/from-stock — a bought-in order has **no plant quality steps**. After Final Payment
  Confirmed it goes straight to **Transferred to Office (Logistics) → Quality & Quantity Checked
  (Sales) → Save Documents & Approve Delivery → …**. Also **enables Office pick up** for bought-in
  orders (previously from-stock only).
- **Skip mechanism:** `confirmFinalPayment` lands a **bought-in** order on `qa_plant_checked`
  (instead of `final_pay_cleared`), skipping the quality-test + plant-QC stages; the normal
  `qa_plant_checked → Transfer → qa_transferred → Sales QC` path then runs. Works for both bought-in
  **delivery** and **office pick up** (office pickup's `qa_tested` shortcut is naturally bypassed).
- **Labels:** the Sales QC button/step reads **"Quality & Quantity Checked"** (not "Re-Checked")
  for bought-in; `pendingStep` `qa_transferred` action + the fulfilment trail label are bought-in
  aware; the `qa_plant_checked` stage label shows **"For transfer to office"** for bought-in
  (it's a transient pre-transfer landing). Step-7 button kept "Documents Checked" (owner: leave as is).
- **Office pick up for bought-in:** `availableModes` adds `office_pickup` for `boughtInOnly`;
  `setFulfillmentMode` / `setOfficePickup` guards widened. Phase 2 stays the bought-in PO flow
  (BoughtInProduction); Phase 5 uses the office-pickup tail (Sales uploads proof of pick up / surrenders).
- **Multi-batch:** new `MULTIBATCH_BOUGHTIN_STEPS` (delivery — drops qa_tested/qa_plant_checked) and
  `MULTIBATCH_BOUGHTIN_PICKUP_STEPS` (office pickup). `mbSteps`/`mbStepDef`/`mbProgress` take a
  `boughtInOnly` flag, threaded through `advanceMultiBatch`, the order page batch views and the My
  Dashboard multi-batch feed.
- **Where:** `order-workflow.ts`, `delivery-multibatch.ts`, `my-dashboard.ts`, `orders/actions.ts`,
  `orders/[id]/page.tsx`, `orders/[id]/fulfillment-actions.tsx`, `orders/page.tsx`. **P&L untouched.**
  Typecheck + lint clean.

## 2026-08-08 · From-stock Phase-2 release — role/order by fulfilment mode + billing upload
- **Owner-requested (frozen Phase 2, owner-approved):** the from-stock stock-release
  choreography now differs by fulfilment mode (the plant and office are far apart, so who
  releases differs). Replaces the old single "PM approves → Warehouse releases → auto-notify".
  - **Delivery:** Plant Manager **Release from Stock** → Sales **Release from Stock & Notify Client**.
  - **Office pick up:** Sales **Release from stock & notify client** (one step — was the Engineer).
  - **Plant pick up:** Warehouse **Release From Stock** → Plant Manager **Quality & Quantity Approved**.
- **New `stock_released` stamp** marks the physical release (inventory deducted). Two actions:
  `releaseOrderFromStock` (step 1 — matches lines + deducts; role by mode; office pickup also
  stamps `client_notified` and advances) and new `confirmStockRelease` (step 2 — delivery: Sales
  → `client_notified`; plant: PM → `stock_release_approved` + `client_notified`; both → Phase 5).
  Replaces `approveStockRelease`. `pendingStep` released/stockOnly rewritten for the 3 modes'
  two-step flow; `StockRelease` UI rewritten (mode-driven labels/roles/awaiting text); order-page
  perms `canReleaseStock` (step 1) + `canConfirmRelease` (step 2) by mode.
- **Billing statement (optional):** new `BillingStatement` upload link (clone of the final-payment
  proof), shown at the final-payment stage (`final_pay_review`/`final_pay_checked`); doc key
  `billing_statement` added to `CLOSE_DOC_KEYS`. Accounting attaches it after release, before final
  payment — same appearance/behaviour as the previous upload links.
- **Notifications/alarms/messages** all derive from `pendingStep`, so the orders-list banner, order
  "waiting for" card, approver alarm and My Dashboard feed update for every role automatically.
  **P&L untouched** per instruction. Payment-cleared button label kept as "Clear payment & release
  from stock" (owner: use that label). Typecheck + lint clean.
- **Still owner-pending:** the produced (Centrifugal/Axial) and bought-items workflows — to be
  uploaded later.

## 2026-08-08 · From-stock plant pick up — Warehouse runs the quality test
- **Owner-requested (frozen Phase 5, owner-approved):** extends the from-stock "Warehouse runs
  the quality & quantity test" rule (#257, delivery) to the **plant pick up** fulfilment mode.
  For a from-stock order (F&B on-hand, e.g. angle corner) collected at the plant, step "Quality
  Tested-Passed" is done by the **Warehouse**; the Plant Manager still approves and the
  Warehouseman still makes the delivery form. **Produced** plant-pickup orders keep Technical
  Head / QI on the quality test (unchanged — the produced workflow is still owner-pending).
- **Where:** `pendingStep` (final_pay_cleared: from-stock — delivery OR plant pickup — → Warehouse
  before the produced plant-pickup Tech-Head/QI branch); `qaTest` action (`fromStock = stockOnly
  && !pickup`, so plant pickup from-stock authorises the Warehouse); order-page `canQaTest` perm;
  new `MULTIBATCH_PLANT_STOCK_STEPS` (plant-pickup steps with `qa_tested` role = warehouse) +
  `mbSteps` returns it for plant_pickup + stockOnly. The FulfillmentActions copy/awaiting
  (via the existing `fromStock` prop) and the `qa_tested` sign-off designation already keyed off
  `stockOnly`, so they cover plant pickup automatically. Typecheck + lint clean.
- **Pending / flagged to owner:** the rest of the three from-stock specs (Delivery / Office pickup
  / Plant pickup) already match the app **except** the Phase-2 stock-release wording (steps 8–10),
  which differs across the specs and from the current two-step flow (Payment Cleared → Plant
  Manager "Approve stock release" → Warehouse "Release from stock" → auto-notify). Awaiting owner
  confirmation before touching frozen Phase 2. **P&L untouched** per instruction.

## 2026-08-08 · From-stock (F&B on-hand) delivery — Warehouse runs the quality test
- **Owner-requested (frozen Phase 5, owner-approved):** for an order fulfilled from Fans &
  Blowers on-hand **stock** (e.g. angle corner), the Phase 5 quality & quantity test (step 15,
  "Quality Tested-Passed") is done by the **Warehouse**; the **Plant Manager** then approves
  (step 16, "Quality & Quantity Approved") and **Logistics** transfers to the office (step 17,
  "Transferred to Office"). Applies to **single-batch and multi-batch delivery**.
- **The gap:** the code lumped from-stock with bought-in as "noProd" and routed both to the
  Office-side actors (Logistics/Sales/Payment Approver). A from-stock item is physically at the
  plant, so it now joins the produced-order path (Plant Manager QC, Logistics transfer) — but
  with the **Warehouse** doing the initial quality test instead of the Technical Head/QI. Only a
  **bought-in** order (never at the plant) keeps the Office-side QA.
- **Single-batch:** `pendingStep` now splits `boughtInOnly = boughtIn && !stockOnly`; from-stock
  → Warehouse test then Plant Manager. `qaTest` / `qaPlantCheck` actions authorise accordingly
  (new `orderSourcingFlags`, replacing `isNoProductionOrder`). Order-page `perms`
  (`canQaTest`/`canQaPlant`), the `FulfillmentActions` copy + "awaiting" roles (new `fromStock`
  prop), the `qa_tested` sign-off designation (→ Warehouse), and the `qa_plant_checked` stage
  label all updated.
- **Multi-batch:** new `MULTIBATCH_STOCK_STEPS` (delivery steps with `qa_tested` role =
  `warehouse`); `mbSteps`/`mbStepDef`/`mbProgress` take an optional `stockOnly`. Threaded through
  `advanceMultiBatch` (auth + progress), the order page's batch views, and the My Dashboard
  multi-batch feed. Produced & bought-in orders and office/plant pick up are unchanged.
- **Where:** `lib/order-workflow.ts`, `lib/delivery-multibatch.ts`, `lib/my-dashboard.ts`,
  `orders/actions.ts`, `orders/[id]/page.tsx`, `orders/[id]/fulfillment-actions.tsx`,
  `orders/page.tsx`. Typecheck + lint clean.

## 2026-08-08 · Zero-rated — Certificate of VAT Exempt/Zero Rated upload
- **Owner-requested:** a zero-rated sale also requires a **Certificate of VAT Exempt/Zero
  Rated**; add an upload slot with the same behaviour as the other closing attachments.
- **New doc key `vat_zero_cert`** (`VAT_ZERO_CERT_DOC` in `sale.ts`). It's appended (required)
  only for zero-rated. Threaded a `zeroRated` flag through the closing-doc helpers —
  `afterPaymentDocTypes`, `plantDocTypes`, `closeDocsState`, `plantCloseState` all take an
  optional `zeroRated` (default false); when set they add the certificate slot and the close
  gate requires it. NOT added to `deliveryUnsignedDocTypes` (the cert has no unsigned pre-
  delivery variant — it's a closing attachment).
- **Plumbed `zeroRated = quote.vatMode === "ZERO_RATED"`** from the order page + quotation
  page/builder down through `CloseDocuments`, `SaleDocumentList`, `FulfillmentActions`,
  `MultiBatchPanel`, `SalePanel`, `BatchDocumentList`. Server gates use it too: `fileDocuments`
  close gate and the multi-batch `delivery_docs` gate in `orders/actions.ts`. Added
  `vat_zero_cert` to `CLOSE_DOC_KEYS` + `MB_DOC_KEYS` so uploads are accepted; Accounting/Sales/
  admin attach it like the other closing docs (no special role gate).
- **Counter sales:** `counterDocSlots` adds the certificate (required) for `ZERO_RATED`;
  `addCounterSaleDoc` already validates against the slot list so the upload is accepted; detail-
  page doc caption updated.
- **Where:** `lib/sale.ts`, `lib/counter-sale.ts`, `orders/actions.ts`, `orders/[id]/`
  (`page.tsx`, `close-documents.tsx`, `fulfillment-actions.tsx`, `multi-batch-panel.tsx`,
  `sale-document-list.tsx`), `quotations/[id]/` (`page.tsx`, `quotation-builder.tsx`,
  `sale-panel.tsx`, `batch-document-list.tsx`), `counter-sales/[id]/page.tsx`. Typecheck + lint
  clean.

## 2026-08-08 · Counter-sale zero-rated + Fans head can't release stock
- **Two owner-requested changes:**
- **(1) Counter sales gains the zero-rated VAT mode** (parity with the quotation builder).
  `CounterSaleVatMode` adds `ZERO_RATED`; new `coerceCounterVatMode` + `COUNTER_VAT_LABEL`
  helpers. Totals: like EXCLUSIVE, the entered price IS the total, 0% VAT (`counterTotals`
  else branch already handled it). Docs (`counterDocSlots`): zero-rated hands over **Sales
  Invoice + Collection Receipt + Delivery Receipt + EWT (BIR 2307)** — same SI/CR/DR as
  inclusive, but the BIR 2307 (EWT) is **not optional** for zero-rated. Dropdown option added
  to the create form and the admin-edit; detail + list badges and the doc description line use
  the new label. Actions coerce all three modes. **Management P&L:** a zero-rated counter sale
  charges **no output VAT** (both `cs.vatMode !== "EXCLUSIVE"` output-VAT checks → `=== "INCLUSIVE"`).
  Files: `lib/counter-sale.ts`, `counter-sales/actions.ts`, `counter-sale-form.tsx`,
  `counter-sale-admin-edit.tsx`, `counter-sales/[id]/page.tsx`, `counter-sales/page.tsx`,
  `management/pnl-actions.ts`.
- **(2) Fans & Blowers head can no longer release from stock** (owner-approved, frozen Phase 2).
  Items manufactured by Fans & Blowers are released from stock by the **Warehouse only** (the
  Fans & Blowers head has no authority). Removed `prod_head_fans` from: the "Release from stock"
  approvers banner (`order-workflow.ts` pendingStep), the release authorization
  (`STOCK_RELEASE_ROLES` in `orders/actions.ts` + its error text), and the UI gate
  (`canReleaseStock` in `orders/[id]/page.tsx`). Updated the user-facing "Awaiting the
  Warehouse to release the stock" wording in `stock-release.tsx`. Plant-Manager/Engineer
  approval step is unchanged. Typecheck + lint clean.

## 2026-08-08 · New VAT presentation — "VAT exclusive zero rated"
- **Owner-requested:** add a 4th VAT presentation to the quotation builder, **VAT
  exclusive zero rated** — the total is the **same figure as VAT inclusive** (the entered
  price IS the total) but the sale is **zero-rated: 0% output VAT** (usually 1% EWT
  withheld). Its closing documents are **Sales Invoice, Collection Receipt, Delivery
  Receipt and EWT** (= BIR 2307).
- **Stored `vatMode = "ZERO_RATED"`** (the column is a free String, default INCLUSIVE — no
  migration). Centralised the mode semantics in `quote.ts`:
  - `vatDisplayBasisIsGross(mode)` → INCLUSIVE & ZERO_RATED show the entered (gross) price
    as the base; the exclusive modes strip VAT (÷1.12).
  - `vatModeAddsVat(mode)` → only EXCLUSIVE_PLUS adds 12% on top.
  - `vatModeChargesOutputVat(mode)` → INCLUSIVE & EXCLUSIVE_PLUS charge output VAT;
    EXCLUSIVE & ZERO_RATED do not.
  - `payableTotal` uses `vatDisplayBasisIsGross` → a zero-rated quote's deal value equals the
    entered price (matches VAT inclusive). Everything computing the deal value flows through
    `payableTotal` (WON amount, dashboards, sales report, customers, finance monitor).
- **Documents:** no Phase-5 change needed — the closing-doc derivation is `vatMode !==
  "EXCLUSIVE"`, so ZERO_RATED already gets the full VAT set (Sales Invoice, Collection
  Receipt, Delivery Receipt, BIR 2307/EWT). Exactly what zero-rated requires.
- **Presentation:** builder dropdown option + totals ("NET AMOUNT (VAT zero-rated)"); the
  quotation **PDF** and **Excel** show the gross figure with a "VAT zero-rated" net label and
  no VAT line; PDF/Excel routes + `quotations/[id]/page.tsx` pass the mode through.
- **Management P&L:** zero-rated books **no output VAT**; because it has no VAT to strip, the
  **full line price is department revenue** (new `saleLineNet` — `lineNetOf` still ÷1.12 for
  the other modes). `markupDiscountNet` / `pnl-detail` use the gross display basis for
  ZERO_RATED (but don't strip VAT from the mark-up/discount, since there is none). New
  `VAT_MODE_LABEL` entry "Zero-rated".
- **Where:** `quote.ts` (helpers + `payableTotal`); `quotation-builder.tsx`, `pdf/quotation-
  pdf.tsx`, `excel/quotation-xlsx.ts` (presentation); `pnl-actions.ts`, `pnl-detail.tsx`
  (output VAT + revenue basis); `quotations/actions.ts` (zod enum), `quotations/[id]/page.tsx`
  + the pdf/excel routes (passthrough). Typecheck + lint clean.
- **Out of scope / flagged:** counter-sales keeps its 2-option INCLUSIVE|EXCLUSIVE model —
  zero-rated wasn't added there (separate channel). Say the word to extend it.

## 2026-08-08 · Closing documents — VAT-appropriate labels everywhere
- **Owner-requested:** the closing-document upload slots should be named by the tax
  treatment (matching the counter-sales taxonomy), and consistently across every place
  they appear (order Phase 5, quotation Sale panel, delivery-docs prep, multi-batch,
  plant pick up):
  - **VAT-inclusive** → **Delivery Receipt** + **Collection Receipt** (plus Sales Invoice
    & BIR 2307).
  - **VAT-exclusive** → **Delivery Form** + **Acknowledgement Form**.
- **Centralised in `sale.ts`:** new `collectionReceiptLabel(vat)` / `deliveryDocLabel(vat)`
  and a `vatLabel()` remapper. `afterPaymentDocTypes` and `deliveryUnsignedDocTypes` now
  relabel the `or_cr_af` slot ("Collection Receipt"/"Acknowledgement Form") and the delivery
  slot (`delivery_receipt`/`unsigned_dr` → "Delivery Receipt"/"Delivery Form") by VAT.
  **Doc keys are unchanged**, so existing uploads stay valid — only the display labels move.
  Every consumer already renders `t.label` from these helpers, so the change propagates
  everywhere with no per-file edits.
- **Plant pick up reconciled:** `plantDocTypes(false)` (VAT-exclusive) now pairs the
  Warehouseman's **delivery form** with an **Acknowledgement Form** (`or_cr_af`) slot — this
  revises the earlier "delivery form alone is enough" so VAT-exclusive plant matches the
  general VAT-exclusive rule (Delivery Form + Acknowledgement Form). VAT-inclusive plant
  relabelled to Collection Receipt + Delivery Receipt. Flagged to owner.
- **Also:** `fulfillment-actions.tsx` plant "Make the delivery form" caption no longer says
  "Delivery Receipt" (VAT-inclusive-specific) — now "prepares and attaches the delivery form".
- **Where:** `sale.ts` (label helpers + `afterPaymentDocTypes`/`deliveryUnsignedDocTypes`/
  `plantDocTypes`); `fulfillment-actions.tsx` (caption). Typecheck + lint clean.

## 2026-08-07 · Plant pick up — VAT-aware documents (delivery form vs closing docs)
- **Owner-requested:** for plant pick up the **Warehouseman's delivery form** is a distinct
  document. **VAT-exclusive** → the delivery form alone is enough to close. **VAT-inclusive**
  → Accounting also makes the Sales Invoice, OR/CR/AF and Delivery Receipt.
- **New `delivery_form` doc slot** (Warehouseman) — the "Make the delivery form" step now
  attaches `delivery_form` (was reusing `delivery_receipt`). `plantDocTypes(vatInclusive)` /
  `plantCloseState(...)` in `sale.ts` encode the requirement (delivery form always; SI/OR/DR
  only for VAT-inclusive; no BIR 2307 per owner).
- **Where:** `sale.ts` (`plantDocTypes`/`plantCloseState`); `actions.ts` (`CLOSE_DOC_KEYS` +
  `MB_DOC_KEYS` gain `delivery_form`; `qaTransfer` requires the delivery form; `fileDocuments`
  + the multi-batch `delivery_docs` gate use the plant/VAT requirement; `loadForCloseDoc`
  lets the Warehouseman attach `delivery_form`); `close-documents.tsx` (plant-aware slots +
  gate — VAT-exclusive shows no accounting slots, closes on the delivery form); `plant-doc-
  step.tsx` (form kind → `delivery_form`); `fulfillment-actions.tsx` + `multi-batch-panel.tsx`
  (plant/VAT doc slots). Typecheck + lint clean.
- **Multi-batch note:** the WH attaches the batch's delivery documents at the make-form step
  (bundled); for VAT-inclusive that includes SI/OR/DR (can split to Accounting later).

## 2026-08-07 · Plant pick up — multi-batch (PR 3 of 3)
- **Feature (owner-approved, frozen Phase 5 multi-batch):** plant pick up can be collected
  in multiple batches; each batch repeats the plant Phase-5 sequence. Reuses the multi-batch
  engine with a plant step variant, alongside delivery and office-pickup variants.
- **`MULTIBATCH_PLANT_PICKUP_STEPS`** (per batch): notify client → payment checked → payment
  confirmed → quality tested (Tech Head/QI) → Plant Manager "Quality & Quantity Approved" →
  **Warehouseman "Make the delivery form"** (`delivery_docs`) → **Plant Manager "Approve
  delivery"** (`delivery_approved`) → **Warehouseman "Upload proof of pick up & mark picked
  up"** (`delivered`) → **Sales "Approve POD"** (`delivery_confirmed`) → Accounting "Confirm
  documents received" → "File documents — batch picked up".
- **Engine generalised:** `mbSteps`/`mbStepDef`/`mbProgress` now take a `MBMode`
  (`delivery | office_pickup | plant_pickup`) instead of an `officePickup` boolean; all
  callers pass `wf.fulfillmentMode`. `advanceMultiBatch` uses the mode. The Warehouseman may
  attach the batch's delivery documents + proof of pick up (`saveMultiBatchDoc` /
  `saveMultiBatchPod` / `removeMultiBatchPod`). `setMultiBatchPickup` now works for any
  pick-up mode. The "Multi-batch pick up" toggle + multi-mode card + `MultiBatchPanel`
  relabelling now cover plant pickup (`isPickupMode = office || plant`).
- **Known simplification:** in multi-batch the "Make the delivery form" step bundles the
  batch's delivery documents (SI/OR/DR), whereas single-batch splits DR-at-make-form from
  SI/OR-at-close. Functional; can refine if the owner wants the split per batch.
- Typecheck + lint clean.

## 2026-08-07 · Plant pick up — single-batch Phase 5 + 3-way selector (PR 2 of 3)
- **Feature (owner-approved, frozen Phase 2/5):** adds the **plant pick up** handover mode
  (client collects at the plant). Per `docs/plant-pickup-design.md` + owner confirmations:
  delivery form = the Delivery Receipt (Warehouseman attaches it), Make-form and
  Approve-delivery are two steps, and from-stock plant pickup uses the same QA roles as
  produced.
- **3-way selector** replaces the old office-pickup on/off toggle on the Phase 2 card:
  **Delivery · Office pick up · Plant pick up** (`FulfillmentModeSelector` +
  `setFulfillmentMode`). Options gated by contents: office pick up = from-stock; plant pick
  up = not bought-in-only. Admin can change any time; a non-admin only before the order
  leaves Phase 2.
- **Plant pick up Phase 5 (single-batch)** — mapped onto existing stages with plant labels/
  roles: QA test (Tech Head/QI) `qa_tested` → Plant Manager "Quality & Quantity Approved"
  `qa_plant_checked` → **Warehouseman "Make the delivery form"** (attach DR) `qa_transferred`
  → **Plant Manager "Approve Delivery"** `qa_sales_checked` → **Warehouseman "Upload form +
  proof of pick up"** `delivered` → **Sales "Approve POD – Successful Pick Up"**
  `delivery_confirmed` → **Accounting "Confirm Documents Received"** (skips surrender)
  `docs_received` → File. All gated on `fulfillmentMode === "plant_pickup"`.
- **Where:** `order-workflow.ts` (`pendingStep` plant branches + `plantPickup` arg; 4 callers
  updated), `actions.ts` (`qaTest`/`qaPlantCheck`/`qaTransfer`/`qaSalesCheck`/`markDelivered`/
  `confirmDocsReceived` plant branches; `loadForCloseDoc` allows Warehouseman for DR/POD; new
  `setFulfillmentMode`), `page.tsx` (plant-aware perms; the selector; header badge shows the
  mode), `fulfillment-actions.tsx` (plant Phase-5 UI), new `plant-doc-step.tsx` +
  `fulfillment-mode-selector.tsx`. The old `office-pickup-toggle.tsx` is now unused.
- **Notes:** typecheck + lint clean; the build compiles (the only failure is prerendering an
  unrelated Supabase-env page). Plant **multi-batch** is PR 3. Single-batch plant pickup on a
  from-stock order still uses the normal two-step stock release in Phase 2 (fine).

## 2026-08-07 · Fulfilment mode — enum refactor (plant pickup PR 1 of 3)
- **Refactor (no behaviour change), per `docs/plant-pickup-design.md`:** introduced
  `wf.fulfillmentMode: "delivery" | "office_pickup" | "plant_pickup"` as the source of
  truth for the handover mode, in preparation for adding **plant pick up**.
  - `src/lib/order-workflow.ts` — new `FulfillmentMode` type + `fulfillmentMode` field on
    `OrderWorkflow`; coerce reads the stored enum, falling back to the legacy `officePickup`
    boolean (so pre-enum orders keep working). `officePickup` is now **derived**
    (`=== "office_pickup"`) so all existing office-pickup call sites read unchanged.
  - `src/app/(app)/orders/actions.ts` — `setOfficePickup` now writes `fulfillmentMode`
    instead of the boolean.
- **Zero behaviour change** — legacy data coerces identically; the ~30 `wf.officePickup`
  reads still work via the derived field. Sets up PR 2 (plant single-batch + 3-way selector)
  and PR 3 (plant multi-batch).

## 2026-08-07 · Office pickup — toggle label reads "On - Office pick up / Off - Delivery"
- **Owner-requested:** the Phase 2 `OfficePickupToggle` label now reads
  **"On - Office pick up / Off - Delivery"** (was "Office pick up"/"Office pick up?"), so
  both toggle positions are self-explanatory. The header badge and the read-only tag keep
  saying "Office pick up" — they're status indicators shown only when pickup is on, where
  an on/off legend would be meaningless.
- **Also removed** the now-redundant caption "Client collects at the office instead of
  delivery." from the Phase 2 toggle box (the toggle label already says it).
- **Where:** `src/app/(app)/orders/[id]/office-pickup-toggle.tsx`,
  `src/app/(app)/orders/[id]/page.tsx`.

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
