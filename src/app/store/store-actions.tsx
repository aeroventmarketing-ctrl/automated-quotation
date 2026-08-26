"use client";

import { openCartPanel, openQuotePanel } from "./ui-store";
import { useCartCount, useMounted } from "./cart-store";

/**
 * The header's three action buttons. Client-side because they open the cart
 * drawer / quotation dialog and show the live cart count — the rest of the
 * header stays a server component.
 */
export function HeaderActions({ quoteLabel = "Get a Quote" }: { quoteLabel?: string }) {
  const count = useCartCount();
  const mounted = useMounted();

  /** Jump to the catalogue and put the cursor in its search box when there is one. */
  function focusSearch() {
    const input = document.getElementById("store-search") as HTMLInputElement | null;
    if (input) {
      document.getElementById("products")?.scrollIntoView({ behavior: "smooth" });
      input.focus({ preventScroll: true });
    } else {
      window.location.href = "/store#products";
    }
  }

  return (
    <div className="flex items-center gap-2.5">
      <button
        type="button"
        onClick={focusSearch}
        aria-label="Search the catalogue"
        className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-[var(--store-line)] bg-white text-[17px] text-[var(--store-text)] transition-colors hover:border-[var(--store-accent)] hover:text-[var(--store-accent)]"
      >
        <span aria-hidden>⌕</span>
      </button>

      <button
        type="button"
        onClick={() => openQuotePanel()}
        className="hidden h-11 items-center justify-center rounded-full bg-[var(--store-accent)] px-5 text-[13px] font-extrabold text-white transition-colors hover:bg-[var(--store-accent-dark)] sm:inline-flex"
      >
        {quoteLabel}
      </button>

      <button
        type="button"
        onClick={openCartPanel}
        className="inline-flex h-11 items-center justify-center gap-2.5 rounded-full bg-[var(--store-ink)] px-[17px] text-[13px] font-extrabold text-white transition-opacity hover:opacity-90"
      >
        Cart
        <span className="grid h-5 w-5 place-items-center rounded-full bg-white text-[11px] font-extrabold text-[var(--store-text)]">
          {mounted ? count : 0}
        </span>
      </button>
    </div>
  );
}

/** Any button that opens the quotation dialog (hero, solutions band, product page). */
export function QuoteButton({
  children,
  subject = "",
  className,
}: {
  children: React.ReactNode;
  subject?: string;
  className?: string;
}) {
  return (
    <button type="button" onClick={() => openQuotePanel(subject)} className={className}>
      {children}
    </button>
  );
}
