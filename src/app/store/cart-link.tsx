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
      className="relative rounded-md bg-[#ED1C24] px-3 py-1.5 text-sm font-semibold text-white transition-colors hover:bg-[#c2141a]"
    >
      Cart
      {mounted && count > 0 && (
        <span className="ml-1.5 inline-flex min-w-[1.25rem] items-center justify-center rounded-full bg-white px-1 text-xs font-bold text-[#ED1C24]">
          {count}
        </span>
      )}
    </Link>
  );
}
