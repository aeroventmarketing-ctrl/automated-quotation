"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useStoreUi, closePanels } from "./ui-store";
import { CartDrawer } from "./cart-drawer";
import { QuoteDialog } from "./quote-dialog";

/**
 * The storefront's overlays — cart drawer, quotation dialog and toast — mounted
 * once in the layout and driven by the UI bus. Escape closes whatever is open,
 * and the body scroll is locked while a panel is up.
 */
export function StoreChrome({ quoteNote }: { quoteNote: string }) {
  const { panel, quoteSubject, toast, toastNonce } = useStoreUi();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") closePanels(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (!panel) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [panel]);

  // The nonce lets the same message be shown twice in a row.
  useEffect(() => {
    if (!toast) return;
    setVisible(true);
    const t = setTimeout(() => setVisible(false), 2600);
    return () => clearTimeout(t);
  }, [toast, toastNonce]);

  return (
    <>
      {panel === "cart" && <CartDrawer />}
      {panel === "quote" && <QuoteDialog subject={quoteSubject} note={quoteNote} />}

      <div
        role="status"
        aria-live="polite"
        className={`fixed bottom-8 left-1/2 z-[80] rounded-md bg-[var(--store-ink)] px-5 py-3.5 text-[13.5px] font-medium text-white shadow-[0_18px_60px_rgba(9,20,38,0.35)] transition-all duration-300 ${
          visible ? "translate-x-[-50%] translate-y-0 opacity-100" : "pointer-events-none translate-x-[-50%] translate-y-8 opacity-0"
        }`}
      >
        {toast}
      </div>
    </>
  );
}

/** Shared shell for the drawer / dialog: dimmed, blurred backdrop + close button. */
export function Overlay({ children, labelledBy }: { children: React.ReactNode; labelledBy: string }) {
  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-labelledby={labelledBy}>
      <button
        type="button"
        aria-label="Close"
        onClick={closePanels}
        className="absolute inset-0 bg-[#040914]/70 backdrop-blur-[4px]"
      />
      {children}
    </div>
  );
}

/** The round × in the corner of a panel. */
export function CloseButton() {
  return (
    <button
      type="button"
      onClick={closePanels}
      aria-label="Close"
      className="absolute right-5 top-[18px] grid h-9 w-9 place-items-center rounded-full bg-[#edf1f4] text-[18px] leading-none text-[var(--store-ink)] transition-colors hover:bg-[#e2e8ee]"
    >
      <span aria-hidden>×</span>
    </button>
  );
}

/** Small red uppercase label used above every panel and section heading. */
export function Kicker({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[11px] font-black uppercase tracking-[0.18em] text-[var(--store-accent)]">{children}</div>
  );
}

/** "Continue shopping" link shown when a panel has nothing to act on. */
export function BrowseLink() {
  return (
    <Link
      href="/store#products"
      onClick={closePanels}
      className="mt-5 inline-flex w-full items-center justify-center rounded-md bg-[var(--store-accent)] px-5 py-3.5 text-[14px] font-extrabold text-white transition-colors hover:bg-[var(--store-accent-dark)]"
    >
      Explore the catalogue →
    </Link>
  );
}
