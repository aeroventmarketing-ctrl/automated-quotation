/**
 * An item on a requisition or an MRF must be a product that exists.
 *
 * The owner: *"In requisitions, disallow editing in articles/description to all
 * roles including the purchaser role. In MRF, disallow editing in
 * articles/description to all roles including the purchaser role. Let all roles
 * choose from drop down only."*
 *
 * The forms already refused to submit an unknown item, and the picker now has no
 * text input to type one into — but both of those are the browser's opinion. The
 * server actions took whatever `description` string they were handed, so the rule
 * was an affordance rather than a rule. This is where it becomes one.
 *
 * Matched on the NAME, exactly, ignoring case and stray whitespace — the same
 * comparison the forms make, so the button and the server can never disagree
 * about whether a row is valid.
 */

/** Names as the catalogue holds them, ready to compare against. */
export function catalogueNameSet(products: readonly { name: string }[]): Set<string> {
  return new Set(products.map((p) => p.name.trim().toLowerCase()).filter(Boolean));
}

/**
 * The descriptions that are NOT in the catalogue, in the order given.
 *
 * Empty when the catalogue itself is empty. That is deliberate and matches what
 * the forms have always done: a catalogue that failed to load must not turn into
 * "nothing is a valid item", which would refuse every requisition in the company
 * over a transient database error. The picker says the same thing at the other
 * end — with nothing to choose from, it stays shut rather than accepting text.
 */
export function unknownCatalogueItems(
  descriptions: readonly string[],
  products: readonly { name: string }[],
): string[] {
  const known = catalogueNameSet(products);
  if (known.size === 0) return [];
  return descriptions
    .map((d) => (d ?? "").trim())
    .filter((d) => d !== "" && !known.has(d.toLowerCase()));
}

/**
 * What to tell someone whose submission carried an item the catalogue has never
 * heard of — naming the items, because "invalid item" sends a person hunting
 * through their own rows.
 */
export function unknownItemsMessage(unknown: readonly string[]): string {
  return `${unknown.length === 1 ? "This item is" : "These items are"} not in the product catalogue: ${unknown.join(", ")}. Pick each row from the dropdown — new products are added on the Products page.`;
}
