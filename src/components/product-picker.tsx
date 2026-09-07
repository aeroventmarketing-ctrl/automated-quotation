"use client";

/**
 * The "Articles / Description" cell on the requisition and MRF forms — a
 * **dropdown, not a text box**.
 *
 * The owner: *"In requisitions, disallow editing in articles/description to all
 * roles including the purchaser role. In MRF, disallow editing in
 * articles/description to all roles including the purchaser role. Let all roles
 * choose from drop down only."*
 *
 * The cell used to be a type-ahead: you typed into the field itself, and free
 * text was undone on blur. The rule was right and the affordance was wrong —
 * a box you can type in is an invitation, and "it snaps back when you look
 * away" is not something a person discovers, it is something that happens to
 * them. So the value now has no text input at all: the cell is a button, and
 * the only way to fill it is to choose.
 *
 * Typing is still how you FIND a product — the search box lives inside the open
 * menu, where what you type filters the list and can never become the answer.
 *
 * No role is exempt. The Purchaser was named because they are the one who could
 * most plausibly be trusted to type an item; the point is that the catalogue is
 * the only source of item names, whoever is at the keyboard.
 *
 * The menu is fixed-positioned so a table's horizontal scroll never clips it.
 */
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { ChevronDown, Search } from "lucide-react";

export interface PickableProduct {
  name: string;
  unit?: string;
  sku?: string | null;
}

const INPUT_CLASS = "w-full rounded border bg-background px-2 py-1";

export function ProductPicker({
  value,
  onPick,
  products,
  placeholder = "Choose a product",
  className = INPUT_CLASS,
  disabled = false,
}: {
  /** The committed product name ("" when the row is empty). */
  value: string;
  /** Called with the picked product, or null when the row is cleared. */
  onPick: (product: PickableProduct | null) => void;
  products: PickableProduct[];
  placeholder?: string;
  className?: string;
  disabled?: boolean;
}) {
  const btnRef = useRef<HTMLButtonElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const listId = useId();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [pos, setPos] = useState<{ left: number; top: number; width: number } | null>(null);

  const catalogue = products.length > 0;
  const q = query.trim().toLowerCase();
  const matches = (q ? products.filter((p) => p.name.toLowerCase().includes(q) || (p.sku ?? "").toLowerCase().includes(q)) : products).slice(0, 50);

  function place() {
    const r = btnRef.current?.getBoundingClientRect();
    if (r) setPos({ left: r.left, top: r.bottom, width: Math.max(r.width, 260) });
  }

  /**
   * Opening starts a fresh search and puts the cursor in it — the search box is
   * the only place typing happens, so landing anywhere else makes the control
   * feel broken.
   *
   * Keyed on `pos` as well as `open`: the menu only mounts once a position has
   * been measured, so an effect watching `open` alone runs a render too early
   * and finds no input to focus. The first version did exactly that, and typing
   * after opening went nowhere.
   */
  useLayoutEffect(() => {
    if (!open || !pos) return;
    searchRef.current?.focus();
  }, [open, pos]);

  // A menu pinned to the viewport has to follow its button.
  useEffect(() => {
    if (!open) return;
    const onMove = () => place();
    window.addEventListener("scroll", onMove, true);
    window.addEventListener("resize", onMove);
    return () => {
      window.removeEventListener("scroll", onMove, true);
      window.removeEventListener("resize", onMove);
    };
  }, [open]);

  /** Measure first, then open — see the focus note above. */
  function openMenu() {
    place();
    setQuery("");
    setActive(0);
    setOpen(true);
  }

  function pick(p: PickableProduct | null) {
    onPick(p);
    setOpen(false);
    btnRef.current?.focus();
  }

  const trigger = (
    <button
      ref={btnRef}
      type="button"
      disabled={disabled || !catalogue}
      onClick={() => { if (open) { setOpen(false); return; } openMenu(); }}
      onKeyDown={(e) => {
        if (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ") { e.preventDefault(); openMenu(); }
      }}
      role="combobox"
      aria-expanded={open}
      aria-controls={listId}
      aria-haspopup="listbox"
      className={`${className} flex items-center justify-between gap-1 text-left disabled:cursor-not-allowed disabled:opacity-60`}
    >
      <span className={`truncate ${value ? "" : "text-muted-foreground"}`}>
        {value || (catalogue ? placeholder : "No products in the catalogue")}
      </span>
      <ChevronDown className="h-3.5 w-3.5 shrink-0 opacity-60" aria-hidden />
    </button>
  );

  /**
   * Nothing to choose from. The field stays SHUT rather than falling back to a
   * free-text box — that fallback was the one hole left in a selection-only
   * rule, and it opened exactly when the catalogue failed to load, which is
   * when a typo is least likely to be noticed. It says what to do instead.
   */
  if (!catalogue) {
    return (
      <span className="inline-flex w-full flex-col gap-0.5">
        {trigger}
        <span className="text-[10px] text-muted-foreground">Add products in Products first.</span>
      </span>
    );
  }

  return (
    <>
      {trigger}
      {open && pos && (
        <>
          {/* Click anywhere else to close. Behind the menu, over everything else. */}
          <div className="fixed inset-0 z-40" onMouseDown={() => setOpen(false)} aria-hidden />
          <div
            style={{ position: "fixed", left: pos.left, top: pos.top, width: pos.width, zIndex: 50 }}
            className="mt-1 overflow-hidden rounded-md border bg-background text-sm shadow-md"
          >
            <div className="flex items-center gap-1.5 border-b px-2 py-1.5">
              <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
              <input
                ref={searchRef}
                value={query}
                onChange={(e) => { setQuery(e.target.value); setActive(0); }}
                onKeyDown={(e) => {
                  if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(a + 1, matches.length - 1)); }
                  else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
                  else if (e.key === "Enter") { e.preventDefault(); if (matches[active]) pick(matches[active]); }
                  else if (e.key === "Escape") { e.preventDefault(); setOpen(false); btnRef.current?.focus(); }
                }}
                placeholder="Search the catalogue…"
                autoComplete="off"
                aria-label="Search products"
                className="w-full bg-transparent text-sm outline-none"
              />
            </div>
            <ul id={listId} role="listbox" className="max-h-56 overflow-auto">
              {/* Emptying a row is a choice too — otherwise a row picked by
                  mistake could never be taken back. */}
              {value && (
                <li>
                  <button
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => pick(null)}
                    className="block w-full px-2 py-1.5 text-left text-xs text-muted-foreground hover:bg-accent"
                  >
                    Clear this row
                  </button>
                </li>
              )}
              {matches.length === 0 ? (
                <li className="px-2 py-1.5 text-xs text-muted-foreground">
                  No product matches &ldquo;{query.trim()}&rdquo;. Add new ones in Products.
                </li>
              ) : (
                matches.map((p, i) => (
                  <li key={`${p.name}-${i}`}>
                    <button
                      type="button"
                      role="option"
                      aria-selected={p.name === value}
                      onMouseDown={(e) => e.preventDefault()}
                      onMouseEnter={() => setActive(i)}
                      onClick={() => pick(p)}
                      className={`block w-full px-2 py-1.5 text-left ${i === active ? "bg-accent" : "hover:bg-accent"}`}
                    >
                      <span>{p.name}</span>
                      {(p.sku || p.unit) && (
                        <span className="ml-2 text-xs text-muted-foreground">{[p.sku ? `SKU ${p.sku}` : null, p.unit].filter(Boolean).join(" · ")}</span>
                      )}
                    </button>
                  </li>
                ))
              )}
            </ul>
          </div>
        </>
      )}
    </>
  );
}
