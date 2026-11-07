/**
 * An item's code, beside the item — the owner's *"Show the sku number at the
 * right side of the item."*
 *
 * Deliberately quiet: the item's NAME is what a person reads, and the code is
 * what they carry to a shelf or a search box. Monospaced so a column of them
 * lines up and a transposed digit shows.
 *
 * Renders nothing at all when there is no code. A line the catalogue has never
 * heard of is one somebody typed by hand, and a row of "SKU —" would train the
 * eye straight past the real ones.
 */
export function ItemSku({ code, className = "" }: { code: string | null | undefined; className?: string }) {
  if (!code) return null;
  return (
    <span
      className={`ml-2 whitespace-nowrap rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] tracking-tight text-muted-foreground ${className}`}
      title="Item code (SKU) — for finding this item in inventory. It is never printed on the supplier's copy."
    >
      SKU {code}
    </span>
  );
}

/**
 * The line's stored code belongs to a different item than its name — found on
 * PO-AFBM20260001051 (lib/item-sku-align). The card uses the code the name
 * gives, and says so, so nobody counts or receives into the other item.
 */
export function SkuMismatch({ stored, expected }: { stored: string; expected: string }) {
  return (
    <span
      className="ml-2 whitespace-nowrap rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800 ring-1 ring-amber-300 dark:bg-amber-950 dark:text-amber-300 dark:ring-amber-800"
      title={`This line was saved with SKU ${stored}, which belongs to a different item. ${expected} — this item's code — is used instead. An admin can correct it in Admin → Data check.`}
    >
      SKU doesn&apos;t match · was {stored}
    </span>
  );
}
