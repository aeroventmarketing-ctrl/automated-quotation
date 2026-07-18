/**
 * Shared barcode-scan matching for the product catalogue. A handheld scanner
 * types the product's SKU (or the value encoded in its QR/Code-128 label) then
 * an Enter key. We resolve it to a catalogue product the same way the Products
 * page does: SKU → id → exact name.
 */
export interface ScanProduct {
  id: string;
  sku: string | null;
  name: string;
  unit: string;
}

export function matchScannedProduct(products: ScanProduct[], code: string): ScanProduct | undefined {
  const c = code.trim();
  if (!c) return undefined;
  const lc = c.toLowerCase();
  return (
    products.find((p) => p.sku && p.sku.toLowerCase() === lc) ??
    products.find((p) => p.id === c) ??
    products.find((p) => p.name.toLowerCase() === lc)
  );
}
