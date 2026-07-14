import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatCurrency(
  value: number | string,
  currency = "PHP",
): string {
  const n = typeof value === "string" ? Number(value) : value;
  const symbol = currency === "PHP" ? "₱" : currency === "USD" ? "$" : "";
  return `${symbol}${n.toLocaleString("en-PH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/**
 * A successful server action that calls redirect()/notFound() throws a special
 * Next.js control-flow error (digest "NEXT_REDIRECT…" / "NEXT_NOT_FOUND").
 * Client try/catch blocks must re-throw these so navigation actually happens.
 */
export function isNextControlFlowError(e: unknown): boolean {
  if (!e || typeof e !== "object" || !("digest" in e)) return false;
  const digest = (e as { digest?: unknown }).digest;
  return (
    typeof digest === "string" &&
    (digest.startsWith("NEXT_REDIRECT") || digest === "NEXT_NOT_FOUND")
  );
}

/** Philippine Standard Time — the business timezone for all displayed dates. */
export const PH_TIME_ZONE = "Asia/Manila";

export function formatDate(d: Date | string | null | undefined): string {
  if (!d) return "—";
  const date = typeof d === "string" ? new Date(d) : d;
  return date.toLocaleDateString("en-PH", {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: PH_TIME_ZONE,
  });
}

/** Date + time in Philippine Standard Time, e.g. "Jul 14, 2026, 3:42 PM". */
export function formatDateTime(d: Date | string | null | undefined): string {
  if (!d) return "—";
  const date = typeof d === "string" ? new Date(d) : d;
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("en-PH", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: PH_TIME_ZONE,
  });
}
