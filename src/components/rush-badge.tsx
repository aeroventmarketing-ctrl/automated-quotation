import { Zap } from "lucide-react";
import { cn } from "@/lib/utils";
import { rushLabel } from "@/lib/rush-order";

/**
 * The red RUSH badge — the one look a rush order has everywhere it appears
 * (lib/rush-order). `daysLeft` is days to the client due date (null: just "RUSH").
 * A plain element, no hooks: usable on server pages and client cards alike.
 */
export function RushBadge({ daysLeft = null, size = "sm", className }: { daysLeft?: number | null; size?: "xs" | "sm" | "md"; className?: string }) {
  const sz =
    size === "xs" ? "px-1.5 py-0 text-[10px] gap-0.5" : size === "md" ? "px-2.5 py-1 text-sm gap-1" : "px-2 py-0.5 text-xs gap-1";
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center whitespace-nowrap rounded-full border border-red-600 bg-red-600 font-bold uppercase tracking-wide text-white shadow-sm dark:border-red-500 dark:bg-red-600",
        sz,
        className,
      )}
      title="Rush order — this order moves first"
      data-rush="1"
    >
      <Zap className={size === "md" ? "h-3.5 w-3.5" : "h-3 w-3"} />
      {rushLabel(daysLeft)}
    </span>
  );
}

/** "Waiting 5h — RUSH" — a rush task past the 4-hour alarm. */
export function RushWaitAlarm({ text, className }: { text: string; className?: string }) {
  return (
    <span className={cn("inline-flex shrink-0 items-center whitespace-nowrap rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-semibold text-red-800 ring-1 ring-red-300 dark:bg-red-950 dark:text-red-300 dark:ring-red-800", className)}>
      {text}
    </span>
  );
}
