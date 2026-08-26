"use client";

/**
 * Storefront UI bus.
 *
 * The cart drawer, the quotation dialog and the toast are mounted once in the
 * layout, but they're opened from all over the shop — the header buttons, a
 * product card's "+", the hero's second CTA, a quote-only product page. A tiny
 * module-level pub/sub keeps that possible without wrapping the storefront in a
 * context provider (which would force the whole tree client-side and cost the
 * static rendering the catalogue pages depend on for SEO).
 */
import { useSyncExternalStore } from "react";

export type StorePanel = "cart" | "quote" | null;

interface UiState {
  panel: StorePanel;
  /** Product name prefilled into the quotation dialog. */
  quoteSubject: string;
  toast: string;
  /** Bumped on every toast so the same message can be shown twice. */
  toastNonce: number;
}

let state: UiState = { panel: null, quoteSubject: "", toast: "", toastNonce: 0 };
const listeners = new Set<() => void>();

function emit(next: Partial<UiState>) {
  state = { ...state, ...next };
  for (const l of listeners) l();
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}

const SERVER_STATE: UiState = { panel: null, quoteSubject: "", toast: "", toastNonce: 0 };

export function useStoreUi(): UiState {
  return useSyncExternalStore(subscribe, () => state, () => SERVER_STATE);
}

export const openCartPanel = () => emit({ panel: "cart" });
export const openQuotePanel = (subject = "") => emit({ panel: "quote", quoteSubject: subject });
export const closePanels = () => emit({ panel: null });

/** Show a transient confirmation at the bottom of the screen. */
export const showToast = (message: string) => emit({ toast: message, toastNonce: state.toastNonce + 1 });
