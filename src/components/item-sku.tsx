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
