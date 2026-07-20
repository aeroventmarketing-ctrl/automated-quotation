/**
 * How many times the AI "Auto-read receipt" may be run against a single voucher
 * reconciliation / cash-request liquidation. The count is persisted (on the
 * reconciliation / liquidation JSON), so it survives reloads. Once the limit is
 * reached the button is locked and Accounting must check the document and enter
 * the figures by hand — a guard against blindly trusting repeated AI reads.
 */
export const AI_RECEIPT_READ_LIMIT = 3;
