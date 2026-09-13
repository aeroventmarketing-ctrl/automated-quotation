"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";

/**
 * "Show all N" for a Completed box that is carrying only its newest page.
 *
 * A link, not a button: it re-renders the same server component with
 * `?completed=all`, which is the one place those rows are built (see
 * `lib/completed-page`). `scroll={false}` keeps the reader where they are —
 * the box they just expanded is usually at the bottom of a long page.
 *
 * Renders nothing when the page already holds everything, so the control simply
 * is not there on a young install with nine completed rows.
 */
export function ShowAllCompleted({
  shown,
  total,
  noun,
  className = "",
}: {
  shown: number;
  total: number;
  /** What is being counted, when the control sits outside a box that says so. */
  noun?: string;
  className?: string;
}) {
  const pathname = usePathname();
  const params = useSearchParams();
  if (total <= shown) return null;
  const next = new URLSearchParams(params.toString());
  next.set("completed", "all");
  return (
    <Link
      href={`${pathname}?${next.toString()}`}
      scroll={false}
      prefetch={false}
      className={`inline-block rounded-md border px-3 py-1.5 text-xs font-medium hover:bg-accent ${className}`}
    >
      Show all {total}{noun ? ` ${noun}` : ""} — the {shown} most recent are loaded
    </Link>
  );
}
