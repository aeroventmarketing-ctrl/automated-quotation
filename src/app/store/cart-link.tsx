"use client";

import Link from "next/link";
import { useCartCount, useMounted } from "./cart-store";

/** Header cart link with a live item-count badge. */
export function CartLink() {
  const count = useCartCount();
  const mounted = useMounted();
  return (
    <Link
      href="/store/cart"
      className="relative inline-flex items-center gap-2 rounded-full bg-[var(--store-accent)] px-4 py-2 text-[13px] font-bold text-white transition-colors hover:bg-[var(--store-accent-dark)]"
    >
      Cart
      {mounted && count > 0 && (
        <span className="inline-flex min-w-[1.25rem] items-center justify-center rounded-full bg-white px-1.5 text-[11px] font-extrabold text-[var(--store-accent)]">
          {count}
        </span>
      )}
    </Link>
  );
}
