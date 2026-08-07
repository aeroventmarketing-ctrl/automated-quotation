# Design: Plant pick up (3rd fulfilment mode)

**Status:** Proposed — not yet built.
**Author:** owner + Claude Code, 2026-08-07.
**Scope:** Add a third fulfilment/handover mode ("plant pick up") alongside the existing
delivery and office pick up modes, in both single-batch and multi-batch variants.

---

## 1. Background — what exists today

The order workflow already supports two handover modes, each in single- and multi-batch
form:

| Mode | Flag today | Sourcing | Handover |
|---|---|---|---|
| **Delivery** (default) | — | produced *or* from-stock | Logistics delivers to the client |
| **Office pick up** | `wf.officePickup === true` | **from-stock only** | client collects at the **office** |

Multi-batch is driven by `wf.deliveryMode === "multi"` + a per-mode step table:
`MULTIBATCH_STEPS` (delivery) and `MULTIBATCH_PICKUP_STEPS` (office pick up), selected by
`mbSteps(officePickup)`.

The single-batch Phase 5 differences are gated on `wf.officePickup` across
`fulfillment-actions.tsx`, `page.tsx`, and the Phase-5 server actions in `actions.ts`.

---

## 2. The scenario to support

Clients sometimes collect the goods **at the plant** (the Fans & Blowers production
department), by **single batch or multiple batches** — "plant pick up".

Owner-confirmed facts:

1. **Plant pick up is a handover choice, not a sourcing type.** It applies to any goods
   physically at the plant:
   - **Produced** orders — Fans & Blowers, Ducting, Accessories (full Phase 2 job orders).
   - **From-stock at the plant** — Fans & Blowers stock, AlphaAir stock.
   - *AlphaAir sits in both the plant and the office, so the same from-stock AlphaAir order
     could be office pick up OR plant pick up — the client chooses.*
2. Plant pick up is **not** available for purely **bought-in** orders (goods bought from an
   external supplier, never at the plant).
3. In plant pick up: the **Warehouseman** makes the delivery form, there is **no transfer
   to office**, and there is **no "Documents Surrendered" step** (POD-approve goes straight
   to Accounting "Confirm Documents Received").

---

## 3. Core insight — two independent axes

Everything maps onto two separate decisions, not one:

| Axis | Determined by | Drives |
|---|---|---|
| **Sourcing** (produced / from-stock / bought-in) | the order's items — **auto-detected today** (`isStockOnlyOrder`, `isBoughtInOnlyOrder`, else produced) | **Phase 2** (job orders vs stock release vs PO) |
| **Handover** (delivery / office pick up / plant pick up) | a **chosen mode** | the **Phase 5 tail** (roles, steps) |

A boolean (`officePickup`) can only encode two handover states, so it cannot carry a third
mode. The fix is to make the handover axis an **enum**.

Plant pick up reuses **whichever Phase 2 the order already has** (produced → job orders;
from-stock → stock release) and only swaps in its own **Phase 5 tail**. This is the same
shape office pick up used — just not limited to from-stock.

---

## 4. Proposed model

### 4.1 `fulfillmentMode` enum
Replace the boolean with:

```ts
wf.fulfillmentMode: "delivery" | "office_pickup" | "plant_pickup"   // default "delivery"
```

- The workflow is stored as JSON on the order, so **no DB migration**. In the read/coerce
  path, map legacy `officePickup: true` → `"office_pickup"` (and treat a missing
  `fulfillmentMode` as `"delivery"`). Existing orders keep working unchanged.
- During the transition, keep a derived `officePickup` boolean (`mode === "office_pickup"`)
  so call sites can migrate incrementally, then remove it.

### 4.2 Availability (which modes the selector offers)
Gated by the order's contents:

| Mode | Offered when |
|---|---|
| Delivery | always |
| Office pick up | from-stock order (F&B hardware / AlphaAir) — **unchanged** |
| Plant pick up | **produced** (any dept) **or** F&B/AlphaAir **from-stock** — i.e. anything physically at the plant; **not** bought-in-only |

### 4.3 Per-mode step tables (the pattern to keep)
- **Single-batch Phase 5:** three branches (delivery / office pick up / plant pick up).
- **Multi-batch:** add `MULTIBATCH_PLANT_PICKUP_STEPS`; change `mbSteps(officePickup)` →
  `mbSteps(mode)`.

Keeping each mode's sequence in one readable table beats scattering
`mode === X ? … : mode === Y ? …` across files.

---

## 5. Plant pick up — Phase 5 tail

Produced (or from-stock-released) goods, handed over at the plant. **No** transfer to
office, **no** Sales 2nd QC, **no** Documents-Surrendered step.

| # | Step | Role |
|---|---|---|
| 1 | Quality tested – Passed | **Technical Head / Quality Inspector** |
| 2 | Quality & Quantity Approved | **Plant Manager** |
| 3 | Make the delivery form | **Warehouseman** |
| 4 | Approve Delivery | **Plant Manager** |
| 5 | Upload delivery form + proof of pick up | **Warehouseman** |
| 6 | Approve POD – Successful Pick Up | **Sales** |
| 7 | Confirm Documents Received | **Accounting** |
| 8 | File Documents – Close Order | **Accounting** |
| 9 | → sales commission flow | (unchanged) |

**How it differs from the two existing tails:**

| | Delivery | Office pick up | **Plant pick up** |
|---|---|---|---|
| QA tester | Technical Head / QI | **2nd Quality Inspector** | Technical Head / QI |
| Plant Manager "Quality & Quantity Approved" | yes | **skipped** | **yes** |
| Transfer to office (Logistics) | yes | skipped | **skipped** |
| Sales 2nd QC | yes | skipped | **skipped** |
| Delivery form / docs by | Accounting | Accounting | **Warehouseman** |
| Extra "Approve Delivery" step | — | — | **Plant Manager** |
| POD uploaded by | Logistics | Sales | **Warehouseman** |
| Approve POD | Sales | Sales | Sales |
| Documents Surrendered | Logistics | Sales | **skipped** |
| Confirm received / file / commission | Accounting | Accounting | Accounting |

### 5.1 Multi-batch plant pick up
Reuse the multi-batch engine with `MULTIBATCH_PLANT_PICKUP_STEPS`. Per batch:
notify client → payment checked (partial) → payment confirmed → quality tested (Tech Head
/ QI) → Plant Manager "Quality & Quantity Approved" → Warehouseman makes form → Plant
Manager "Approve Delivery" → Warehouseman uploads form + POD → Sales "Approve POD" →
Accounting "Confirm documents received" → "File documents — batch picked up".

*Engine note:* keep the `delivered` step key for the picked-up milestone (POD gate,
delivered-qty tracking, close trigger all key on it), as the office-pickup variant does.

---

## 6. UI

Replace the on/off "Office pick up" toggle on the Phase 2 card with a small **3-way
selector**:

**Delivery · Office pick up · Plant pick up**

- Only offer the options allowed for the order (§4.2).
- Keep the existing **multi-batch toggle** — it works per-mode.
- Carry the same permission/lock policy already used for office pick up (admin can change
  freely; a non-admin can set but not revert once fulfilment has begun).
- The order header badge / read-only tag show the chosen mode ("Delivery" / "Office pick
  up" / "Plant pick up").

---

## 7. Build plan (phased PRs)

1. **PR 1 — enum refactor only.** Boolean `officePickup` → `fulfillmentMode` enum + legacy
   coercion. **Zero behaviour change**; pure consolidation. ~30 call sites, mechanical.
   Safe to merge on its own.
2. **PR 2 — plant-pickup single-batch.** The plant-pickup Phase-5 tail (§5) + the 3-way
   selector UI (§6) + availability gating (§4.2).
3. **PR 3 — plant-pickup multi-batch.** `MULTIBATCH_PLANT_PICKUP_STEPS` + `mbSteps(mode)`.

Doing the safe rename (PR 1) first keeps the mechanical change separate from the new
feature logic, and sets the codebase up cleanly for any future 4th mode.

---

## 8. Frozen-area note

Phase 2 and Phase 5 are frozen areas (see `CLAUDE.md`). This work touches both and requires
explicit owner approval per PR. The changes are additive and gated on `fulfillmentMode`;
the delivery and office-pickup flows are not altered.

---

## 9. Open items / to confirm at build time

- Exact **button labels** for the plant-pickup steps (e.g. "Approve Delivery" vs "Approve
  Pick Up"; whether the Warehouseman step is "Make delivery form" or "Make pick-up form").
- Whether a **produced** order can also choose **office pick up** (today office pick up is
  from-stock-only; not required for this scenario, left as-is).
- Confirm the **multi-batch plant-pickup** POD upload is the Warehouseman (single-batch is);
  and whether Sales "Approve POD" and the Warehouseman upload should be one combined step
  per batch (as office-pickup multi-batch combines) or two.
