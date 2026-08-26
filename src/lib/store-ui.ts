/**
 * Shared storefront class names.
 *
 * The design uses one content column throughout (max 1240px with a fixed
 * gutter) and one condensed-uppercase heading treatment. Keeping both here
 * means a section can't drift half a pixel out of line with its neighbours.
 */

/** The page's content column — matches the design's `.wrap`. */
export const WRAP = "mx-auto w-[min(1240px,calc(100%_-_28px))] sm:w-[min(1240px,calc(100%_-_40px))]";

/** Condensed uppercase display heading. */
export const DISPLAY = "font-[family-name:var(--font-display)] font-bold uppercase";

/** Small red label above a section heading. */
export const KICKER = "text-[11px] font-black uppercase tracking-[0.18em] text-[var(--store-accent)]";
