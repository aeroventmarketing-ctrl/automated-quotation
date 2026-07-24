import { BellRing } from "lucide-react";

/**
 * A blinking, highlighted "awaiting approval" badge that names the role and the
 * people who must act — for high visibility wherever an approval is pending.
 *
 * Pass a `role` label and optional `names` (the assigned approvers). When names
 * are known it reads e.g. "⏳ Awaiting Payment Approver: Reyjellan Gil"; with no
 * names it shows just the role. `detail` adds a trailing action hint
 * ("to confirm the final payment"). Purely presentational — resolve the names
 * server-side via getApproverDirectory().
 */
export function ApproverHighlight({
  role,
  names = [],
  detail,
  className = "",
}: {
  role?: string;
  names?: string[];
  detail?: string;
  className?: string;
}) {
  const who = names.length > 0 ? names.join(", ") : null;
  return (
    <span
      className={`animate-approver-blink inline-flex flex-wrap items-center gap-1.5 rounded-md border border-amber-400 bg-amber-100 px-2 py-1 text-xs font-semibold text-amber-900 dark:border-amber-600 dark:bg-amber-950/60 dark:text-amber-200 ${className}`}
      role="status"
    >
      <BellRing className="h-3.5 w-3.5 shrink-0" />
      <span className="uppercase tracking-wide">Awaiting approval</span>
      {role && (
        <>
          <span aria-hidden>·</span>
          <span className="rounded bg-amber-200 px-1.5 py-0.5 text-amber-900 dark:bg-amber-800/70 dark:text-amber-100">{role}</span>
        </>
      )}
      {who && <span className="font-bold">{who}</span>}
      {detail && <span className="font-normal normal-case text-amber-800 dark:text-amber-300/90">{detail}</span>}
    </span>
  );
}
