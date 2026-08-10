# Receipt reading — reference notes

Domain knowledge for the AI receipt readers, captured for future sessions. This is
a **reference document only** — it records how specific receipts should be read and
what rules we *want*. It does **not** itself change behaviour. The live reading
rules are the `SYSTEM` prompts in:

- `src/app/api/ai/read-receipt/route.ts` — PO reconciliation (Phase 4)
- `src/app/api/ai/read-cash-receipt/route.ts` — cash-voucher liquidation (Phase 4)

> ⚠️ Both readers are in the **frozen Phase 4** area. Changing how they read, what
> they extract, or adding gating (e.g. a duplicate block) needs explicit owner
> approval in-conversation before any code change.

---

## Petron fuel station receipts (Sales Invoice)

Petron is a Philippine petroleum station (gasoline, diesel, gaas). Its POS prints a
**SALES INVOICE**. Read it as follows:

| Field | Where on the receipt | Example |
|---|---|---|
| **Amount / total paid** | the number to the **right of the word `TOTAL`** | `Php 1,500.00` |
| **Date of refill** | the **`Date:`** row near the top | `08/10/2026` |
| **Sales invoice number (S.I. #)** | the **`S.I.#:`** row | `100000063250` |
| Product & volume | the line item (`*Turbo Diesel`, `Qty × Price`) | `16.129 L × Php 93.00` |
| VAT split | `VATable Sales` + `VAT Amount` = `TOTAL` | `1,339.29 + 160.71 = 1,500.00` |

### Date trap — do NOT use the "Date Issued" lines at the bottom
Near the footer a Petron receipt prints **`Date Issued`** twice (accreditation and
`P.T.U. No.` dates, e.g. `10/15/2025`, `10/24/2025`). Those are the **POS
accreditation / permit-to-use issue dates — NOT the transaction date.** The refill
date is always the **`Date:`** row at the top. (Same spirit as the existing rule that
ignores "Date Issued at the very bottom" on supplier sales invoices.)

---

## S.I. # is the receipt's unique fingerprint (duplicate detection)

The **`S.I.#`** uniquely identifies a Petron receipt. **The same `S.I.#` appearing in
a second reconciliation/liquidation means the same physical receipt is being
re-uploaded** and should be rejected — a receipt may back exactly one reconciliation.

**Desired rule (not yet implemented):** when a receipt is read/attached, capture its
`S.I.#` and **block reuse of an `S.I.#` that was already recorded on another
reconciliation or liquidation.** Per owner decision, this should apply to **both
readers** — cash liquidation *and* PO reconciliation — so the same S.I.# can't be
reused anywhere.

**Current state:** neither reader extracts the `S.I.#` today, and there is no
duplicate check. `receiptReadSchema` (`src/lib/ai/schemas.ts`) has no invoice-number
field. Implementing this is a **frozen Phase 4** change and requires owner approval
first. Rough shape when approved:

1. Add an invoice-number field to `receiptReadSchema` and to both `SYSTEM` prompts
   (read the `S.I.#` / official-receipt number).
2. Persist the captured number alongside the reconciliation/liquidation.
3. On read/attach, look up the number across existing reconciliations *and*
   liquidations; if already used elsewhere, reject with a clear "receipt already
   reconciled" message (naming the other record).

---

_Add other station/supplier receipt formats here as they come up, following the
same shape: where the total / date / unique number live, and any traps._
