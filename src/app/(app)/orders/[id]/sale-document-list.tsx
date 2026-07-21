import { FileText, Download, Eye } from "lucide-react";
import { SALE_DOCS_BEFORE_PAYMENTS, afterPaymentDocTypes, deliveryUnsignedDocTypes, type SaleDoc, type SaleRecord } from "@/lib/sale";

const view = (d: SaleDoc) => `/api/sale-uploads/view?path=${encodeURIComponent(d.path)}&name=${encodeURIComponent(d.name)}`;
const download = (d: SaleDoc) => `/api/sale-uploads?path=${encodeURIComponent(d.path)}&download=1&name=${encodeURIComponent(d.name)}`;

/**
 * Read-only list of the sale's documents (PO + every attached slot), shown on
 * the order's Phase 5 card so the closing documents attached on the quotation
 * are visible/downloadable here too. Server component — just links.
 */
export function SaleDocumentList({ sale, vatInclusive, showFinalPayment = false }: { sale: SaleRecord; vatInclusive: boolean; showFinalPayment?: boolean }) {
  const docs = sale.docs ?? {};
  const rows: { label: string; files: SaleDoc[] }[] = [];
  if (sale.po) rows.push({ label: "Purchase Order", files: [sale.po] });
  for (const t of SALE_DOCS_BEFORE_PAYMENTS) {
    const files = [...(docs[t.key] ?? []), ...(t.mergeKeys ?? []).flatMap((k) => docs[k] ?? [])];
    if (files.length) rows.push({ label: t.label, files });
  }
  for (const t of deliveryUnsignedDocTypes(vatInclusive)) {
    if ((docs[t.key] ?? []).length) rows.push({ label: `${t.label} (unsigned)`, files: docs[t.key] });
  }
  for (const t of afterPaymentDocTypes(vatInclusive)) {
    if ((docs[t.key] ?? []).length) rows.push({ label: t.label, files: docs[t.key] });
  }
  if (showFinalPayment && (docs["final_payment"] ?? []).length) rows.push({ label: "Final payment", files: docs["final_payment"] });
  if ((docs["pod"] ?? []).length) rows.push({ label: "Proof of delivery", files: docs["pod"] });
  if (rows.length === 0) return null;

  return (
    <div className="space-y-1.5 rounded-md border p-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Documents</p>
      <div className="space-y-1">
        {rows.map((r) => (
          <div key={r.label} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-sm">
            <span className="min-w-[11rem] font-medium">{r.label}</span>
            <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
              {r.files.map((f) => (
                <span key={f.path} className="inline-flex items-center gap-1.5">
                  <a href={view(f)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-primary underline">
                    <FileText className="h-3.5 w-3.5" /> {f.name}
                  </a>
                  <a href={view(f)} target="_blank" rel="noopener noreferrer" className="text-muted-foreground hover:text-primary" title="View" aria-label="View">
                    <Eye className="h-3.5 w-3.5" />
                  </a>
                  <a href={download(f)} className="text-muted-foreground hover:text-primary" title="Download" aria-label="Download">
                    <Download className="h-3.5 w-3.5" />
                  </a>
                </span>
              ))}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
