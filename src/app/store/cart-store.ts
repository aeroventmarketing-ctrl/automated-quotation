"use client";

/**
 * Browser-side cart. Holds ONLY identifiers + quantities in localStorage — never
 * prices, which the server re-derives at every step (see `lib/store-cart.ts`).
 *
 * A tiny subscribe/notify store rather than context, so the header badge, the
 * product page and the cart page all stay in step (including across tabs, via
 * the `storage` event) without wrapping the storefront in a provider.
 */
import { useEffect, useSyncExternalStore } from "react";
import { normalizeCart, MAX_LINE_QTY, type CartLine } from "@/lib/store-cart";

const KEY = "aerovent.store.cart.v1";

/**
 * The empty cart, as ONE array that is always the same array.
 *
 * `useSyncExternalStore` compares snapshots with `Object.is`, so a snapshot
 * function returning a fresh `[]` never compares equal to its own previous
 * result. React says so on every storefront page:
 *
 *     The result of getServerSnapshot should be cached to avoid an infinite loop
 *
 * `read` below was already written to hand back a stable reference — see the
 * note about reusing `cache` — but the SERVER snapshot was the literal `() => []`
 * and slipped past. The two need the same care for the same reason.
 *
 * Never mutated: every cart change builds a new array through `write`.
 */
const EMPTY: CartLine[] = [];

let cache: CartLine[] = EMPTY;
let cacheJson = "[]";
const listeners = new Set<() => void>();

function read(): CartLine[] {
  if (typeof window === "undefined") return EMPTY;
  let json = "[]";
  try { json = window.localStorage.getItem(KEY) ?? "[]"; } catch { json = "[]"; }
  // Reuse the previous array when the stored JSON is unchanged, so
  // useSyncExternalStore sees a stable reference and doesn't loop.
  if (json !== cacheJson) {
    cacheJson = json;
    try { cache = normalizeCart(JSON.parse(json)); } catch { cache = EMPTY; }
  }
  return cache;
}

function write(lines: CartLine[]) {
  const next = normalizeCart(lines);
  try { window.localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* private mode / full quota */ }
  cacheJson = JSON.stringify(next);
  cache = next;
  for (const l of listeners) l();
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  const onStorage = (e: StorageEvent) => { if (e.key === KEY) { read(); cb(); } };
  window.addEventListener("storage", onStorage);
  return () => { listeners.delete(cb); window.removeEventListener("storage", onStorage); };
}

/** Hoisted rather than written inline at the call site, so it is one function
 *  returning one array — see `EMPTY`. */
const serverSnapshot = (): CartLine[] => EMPTY;

/** The cart as the browser holds it. Empty during SSR. */
export function useCart(): CartLine[] {
  return useSyncExternalStore(subscribe, read, serverSnapshot);
}

/** Total item count — what the header badge shows. */
export function useCartCount(): number {
  const lines = useCart();
  return lines.reduce((a, l) => a + l.qty, 0);
}

/** Add (or top up) a line. Quantities are capped per line. */
export function addToCart(slug: string, variantKey: string, qty = 1) {
  const lines = read();
  const at = lines.findIndex((l) => l.slug === slug && l.variantKey === variantKey);
  if (at >= 0) {
    const next = [...lines];
    next[at] = { ...next[at], qty: Math.min(next[at].qty + qty, MAX_LINE_QTY) };
    write(next);
  } else {
    write([...lines, { slug, variantKey, qty }]);
  }
}

/** Set a line's quantity (0 removes it). */
export function setCartQty(slug: string, variantKey: string, qty: number) {
  const lines = read().map((l) => (l.slug === slug && l.variantKey === variantKey ? { ...l, qty } : l));
  write(lines.filter((l) => l.qty > 0));
}

export function removeFromCart(slug: string, variantKey: string) {
  write(read().filter((l) => !(l.slug === slug && l.variantKey === variantKey)));
}

export function clearCart() {
  write([]);
}

/** True once mounted — lets a component avoid rendering cart state during SSR. */
export function useMounted(): boolean {
  return useSyncExternalStore(
    (cb) => { cb(); return () => {}; },
    () => true,
    () => false,
  );
}

/** Clear the cart on mount — used by the order-confirmation page. */
export function useClearCartOnMount() {
  useEffect(() => { clearCart(); }, []);
}
