import { FlaskConical } from "lucide-react";

/**
 * Shown wherever test mode hides records, so it's obvious data isn't lost.
 * Renders nothing when test mode is off.
 */
export function TestModeBanner({ on, since }: { on: boolean; since?: string | null }) {
  if (!on) return null;
  const when = since ? new Date(since).toLocaleString("en-PH", { timeZone: "Asia/Manila", dateStyle: "medium", timeStyle: "short" }) : null;
  return (
    <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
      <FlaskConical className="mt-0.5 h-4 w-4 shrink-0" />
      <div>
        <span className="font-medium">Test mode is on.</span>{" "}
        Clients, inquiries and quotations{when ? ` created before ${when}` : ""} are hidden (not deleted) so the P&amp;L can be tested against a clean slate. Turn it off in Admin to bring everything back.
      </div>
    </div>
  );
}
