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
 * slips / proofs of payment. Persisted on the sale classification. Once reached,
 * the figures must be checked and keyed in manually (an admin can always record
 * a payment manually).
 */
export const AI_DEPOSIT_SLIP_READ_LIMIT = 8;
