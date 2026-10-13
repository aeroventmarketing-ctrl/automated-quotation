/**
 * The workflow roles that get Receipt Generation (Admin gets it by base role).
 * Its own import-free module so the browser nav can read it without pulling in
 * the server's auth code. The rule itself is `canGenerateReceipts`.
 */
export const RECEIPT_ROLES = ["accounting", "payment_approver"] as const;
