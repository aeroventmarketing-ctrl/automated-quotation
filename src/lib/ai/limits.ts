/**
 * How many times the AI "Auto-read receipt" may be run against a single voucher
 * reconciliation / cash-request liquidation. The count is persisted (on the
 * reconciliation / liquidation JSON), so it survives reloads. Once the limit is
 * reached the button is locked and Accounting must check the document and enter
 * the figures by hand — a guard against blindly trusting repeated AI reads.
 */
export const AI_RECEIPT_READ_LIMIT = 3;

/**
 * How many times the AI "Read slip" may be run against a single order's deposit
 * slips / proofs of payment, for NON-admin users. Persisted on the sale
 * classification. Once reached, non-admins must check the slip and key the
 * figures in manually. Admins have no limit (and their reads don't consume the
 * shared budget).
 */
export const AI_DEPOSIT_SLIP_READ_LIMIT = 3;

/**
 * How many times the AI "Read document" may be run against a single order's
 * closing documents (Sales Invoice / Collection Receipt / Delivery Receipt),
 * for users other than an Admin or the Payment Approver. Persisted on the sale
 * classification. Once reached, everyone else must check the document by hand;
 * an Admin / Payment Approver has no limit (and their reads don't consume the
 * shared budget) — they are the override for this rule.
 */
export const AI_SALE_DOC_READ_LIMIT = 3;
