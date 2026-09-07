/**
 * How many times the AI "Auto-read receipt" may be run against a single voucher
 * reconciliation / cash-request liquidation. The count is persisted (on the
 * reconciliation / liquidation JSON), so it survives reloads. Once the limit is
 * reached the button is locked and Accounting must check the document and enter
 * the figures by hand — a guard against blindly trusting repeated AI reads.
 */
export const AI_RECEIPT_READ_LIMIT = 3;

/**
 * How many times the AI "Read slip" may be run against **one proof of payment**,
 * for NON-admin users.
 *
 * The owner: *"allow unlimited number of rows but limit to 3 reads per row. In
 * the first picture, 1st to 3rd row the AI reading is allowed but after the 4th
 * row it message that it exceeded the AI reading."* It used to be one budget for
 * the whole order, spent by whichever row was read first — so a fourth payment
 * was refused a read it had never had. Rows are unlimited; each attachment has
 * three.
 *
 * Persisted per proof path (`depositSlipReads` on the classification;
 * `CounterSale.slipReadCounts`). Admins have no limit, and their reads don't
 * consume anyone else's allowance.
 */
export const AI_DEPOSIT_SLIP_READ_LIMIT = 3;

/**
 * How many times the AI "Read document" may be run against **one closing
 * document** (Sales Invoice / Collection Receipt / Delivery Receipt), for users
 * other than an Admin or the Payment Approver.
 *
 * Per DOCUMENT, for the same reason as the slips above: one budget for the whole
 * order locked the fourth document without it ever having been read. Persisted
 * per path (`saleDocReadCounts` on the classification), beside the `saleDocReads`
 * stamps, which were already keyed that way. An Admin / Payment Approver has no
 * limit and consumes nobody else's allowance — they are the override.
 */
export const AI_SALE_DOC_READ_LIMIT = 3;

/**
 * How many times the AI check reader may be run against **one attached check
 * photo**, for users other than an Admin or the Payment Approver.
 *
 * The owner: *"In AI reading allow 3 tries in every row or every attachment…
 * Admin/payment approved still allowed unlimited number of tries."* Per
 * ATTACHMENT, not per purchase order: a PO paid by two checks is two photos to
 * read, and spending the budget on the first one used to leave the second
 * unreadable by the person who attached it.
 *
 * The count is persisted on the check doc (`readCount`), so it survives reloads.
 * Once reached, the figures must be checked against the check by hand; an Admin
 * / Payment Approver has no limit, and their reads don't consume anyone else's
 * allowance — they are the override for this rule.
 */
export const AI_CHECK_READ_LIMIT = 3;
