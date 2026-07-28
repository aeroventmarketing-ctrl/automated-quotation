# Project guidance for Claude

## 🔒 Frozen area — MRF / Phase 3 (Materials): do NOT change without explicit owner approval

The Material Request Form (MRF) workflow and the order's **Phase 3 · Materials**
logic are **locked**. Do not modify, refactor, "improve", or extend any of it
unless the repository owner explicitly approves that specific change in the
current conversation. If a requested task would touch this area, stop and ask for
approval first — even for a small tweak or a change that seems obviously correct.

**What this covers**

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

**Files that make up this frozen area**

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

If in doubt about whether something is part of this frozen area, ask before
editing.
