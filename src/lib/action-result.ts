/**
 * The way a server action tells the user it refused.
 *
 * ## Why this type exists
 *
 * Next.js **redacts every error thrown by a server action in production**. The
 * client gets one sentence, the same one every time:
 *
 * > An error occurred in the Server Components render. The specific message is
 * > omitted in production builds to avoid leaking sensitive details…
 *
 * That is the right default for a crash — a stack trace or a database message
 * must never reach a browser. It is exactly wrong for the refusals the app
 * writes ON PURPOSE, which are careful, specific sentences meant to be read:
 *
 * > "GI SHEET 24GA" is priced at 850 but the catalogue says 100. Give a reason
 * > for the different price, or use the catalogue price.
 *
 * On 15 September 2026 the Purchaser hit exactly that rule while saving a PO and
 * was shown the redaction paragraph instead. Nothing was broken — the rule did
 * its job — but the one sentence that says what to do about it was thrown away
 * between the server and the screen.
 *
 * A RETURNED value is not redacted. So a rule the user is meant to act on is
 * returned, and a `throw` goes back to meaning what it should: something went
 * wrong that the user can do nothing about.
 */
export type ActionResult = { ok: true } | { ok: false; error: string };

/** Refuse, with the sentence the user is meant to read. */
export const refuse = (error: string): ActionResult => ({ ok: false, error });

/** The action did what was asked. */
export const done: ActionResult = { ok: true };

/**
 * Read a result (or a thrown error) as a message for the user, or null when it
 * succeeded. `null` means "no message": the caller closes the form.
 *
 * Callers pass whatever came back, including a caught exception, so the two
 * channels — the refusals a screen is meant to explain and the crashes it can
 * only apologise for — are handled in one place.
 */
export function actionError(result: ActionResult | void | unknown): string | null {
  if (result && typeof result === "object" && "ok" in result) {
    const r = result as ActionResult;
    return r.ok ? null : r.error;
  }
  return null;
}
