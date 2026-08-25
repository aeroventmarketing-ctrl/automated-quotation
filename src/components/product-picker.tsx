"use client";

/**
 * Selection-only product picker for the requisition / MRF "Articles / Description"
 * cells. The user may TYPE to search, but the committed value can only ever be a
 * product that exists in the catalogue — free text never sticks:
 *
 *  - typing filters the list (the field shows the query while the menu is open);
 *  - a value is committed only by picking a match (click / Enter);
 *  - on blur, an empty box clears the row, an exact product name commits, and
 *    anything else snaps back to the last picked product.
 *
 * The menu uses fixed positioning so a table's horizontal scroll never clips it.
 *
 * Escape hatch: when the catalogue is empty (`products` is []), the field falls
 * back to a plain free-text input — otherwise the form would be unusable before
 * any product has been imported. This mirrors the existing "unknown item"
 * validation, which is likewise only enforced when a catalogue exists.
 */
import { useEffect, useId, useRef, useState } from "react";

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
  placeholder = "Type or pick a product",
  className = INPUT_CLASS,
}: {
  /** The committed product name ("" when the row is empty). */
  value: string;
  /** Called with the picked product, or null when the row is cleared. */
  onPick: (product: PickableProduct | null) => void;
  products: PickableProduct[];
  placeholder?: string;
  className?: string;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const listId = useId();
  const [query, setQuery] = useState(value);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [pos, setPos] = useState<{ left: number; top: number; width: number } | null>(null);

  // Re-sync when the value changes from outside (a barcode scan filled the row,
  // or the form reset after submitting).
  useEffect(() => setQuery(value), [value]);

  const catalogue = products.length > 0;
  const q = query.trim().toLowerCase();
  const matches = (q ? products.filter((p) => p.name.toLowerCase().includes(q) || (p.sku ?? "").toLowerCase().includes(q)) : products).slice(0, 10);

  function place() {
    const r = ref.current?.getBoundingClientRect();
    if (r) setPos({ left: r.left, top: r.bottom, width: r.width });
  }

  function pick(p: PickableProduct) {
    onPick(p);
    setQuery(p.name);
    setOpen(false);
  }

  /**
   * Leaving the field: empty clears the row, an exact product name commits, and
   * anything else reverts to the last committed pick — so a half-typed or
   * made-up item can never be submitted.
   */
  function commitOrRevert() {
    setOpen(false);
    if (!catalogue) return;
    const typed = query.trim();
    if (typed === "") {
      if (value !== "") onPick(null);
      return;
    }
    const exact = products.find((p) => p.name.trim().toLowerCase() === typed.toLowerCase());
    if (exact) pick(exact);
    else setQuery(value);
  }

  if (!catalogue) {
    // No catalogue yet — plain free-text input (see the escape hatch above).
    return (
      <input
        value={value}
        onChange={(e) => onPick({ name: e.target.value })}
        placeholder={placeholder}
        autoComplete="off"
        className={className}
      />
    );
  }

  return (
    <>
      <input
        ref={ref}
        value={query}
        onChange={(e) => { setQuery(e.target.value); setActive(0); place(); setOpen(true); }}
        onFocus={() => { place(); setOpen(true); }}
        onBlur={() => setTimeout(commitOrRevert, 150)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") { e.preventDefault(); setOpen(true); setActive((a) => Math.min(a + 1, matches.length - 1)); }
          else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
          else if (e.key === "Enter") { if (open && matches[active]) { e.preventDefault(); pick(matches[active]); } }
          else if (e.key === "Escape") { setQuery(value); setOpen(false); }
        }}
        placeholder={placeholder}
        autoComplete="off"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        className={className}
      />
      {open && pos && (
        <ul
          id={listId}
          role="listbox"
          style={{ position: "fixed", left: pos.left, top: pos.top, width: pos.width, zIndex: 50 }}
          className="mt-1 max-h-52 overflow-auto rounded-md border bg-background text-sm shadow-md"
        >
          {matches.length === 0 ? (
            <li className="px-2 py-1.5 text-xs text-muted-foreground">
              No product matches &ldquo;{query.trim()}&rdquo;. Pick an existing product — add new ones in Products.
            </li>
          ) : (
            matches.map((p, i) => (
              <li key={`${p.name}-${i}`}>
                <button
                  type="button"
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
      )}
    </>
  );
}
