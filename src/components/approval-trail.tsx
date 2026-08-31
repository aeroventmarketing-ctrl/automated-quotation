import { Check } from "lucide-react";
import type { ApprovalStep } from "@/lib/approval-history";

/**
 * Date + time on an approval record, fixed to `en-PH` / Asia/Manila so the
 * server and the browser render the same string — a locale-dependent format
 * hydrates mismatched on a machine set to another region. The year is included
 * because a record without one is not a record.
 */
export const approvalStamp = (iso: string) =>
  new Date(iso).toLocaleString("en-PH", {
    timeZone: "Asia/Manila", year: "numeric", month: "short", day: "numeric",
    hour: "numeric", minute: "2-digit",
  });

/**
 * The signature trail: who raised a request and who signed it after, each with
 * their designation and the moment.
 *
 * One component for the pending card and the history page, so a request reads
 * identically before and after it is decided — the same lines in the same order,
 * with "awaiting approval" simply becoming a name and a time.
 */
export function ApprovalTrail({ raisedBy, steps, className = "" }: {
  raisedBy: ApprovalStep;
  steps: ApprovalStep[];
  className?: string;
}) {
  return (
    <ul className={`space-y-0.5 text-[11px] text-muted-foreground ${className}`}>
      <li>
        <span className="font-medium text-foreground">Raised by</span>{" "}
        {raisedBy.name ?? "—"} · {raisedBy.designation}
        {raisedBy.at && <> · {approvalStamp(raisedBy.at)}</>}
      </li>
      {steps.map((s, i) => (
        <li key={`${s.designation}-${i}`} className={s.signed ? "text-emerald-700 dark:text-emerald-500" : ""}>
          <span className="font-medium">{s.designation}</span>{" · "}
          {s.signed ? (
            <>
              <Check className="mr-0.5 inline h-3 w-3" />
              {s.name ?? "—"}
              {s.at && <> · {approvalStamp(s.at)}</>}
            </>
          ) : (
            <span className="italic">awaiting approval</span>
          )}
        </li>
      ))}
    </ul>
  );
}
