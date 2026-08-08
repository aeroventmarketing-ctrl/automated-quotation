import { FileText, Download, Eye } from "lucide-react";
import { afterPaymentDocTypes, type SaleDoc } from "@/lib/sale";
import type { MultiDeliveryBatch } from "@/lib/delivery-multibatch";

const view = (d: SaleDoc) => `/api/sale-uploads/view?path=${encodeURIComponent(d.path)}&name=${encodeURIComponent(d.name)}`;
const download = (d: SaleDoc) => `/api/sale-uploads?path=${encodeURIComponent(d.path)}&download=1&name=${encodeURIComponent(d.name)}`;

/**
 * Read-only view of each delivery batch's own closing documents (Sales Invoice /
 * OR-CR-AF / Delivery Receipt / BIR 2307), attached by Accounting on the order's
 * multiple-batch delivery. Surfaced on the quotation tab so the documents are
 * visible/downloadable here too, grouped by DR / batch. Server component.
 */
export function BatchDocumentList({ batches, vatInclusive, zeroRated = false }: { batches: MultiDeliveryBatch[]; vatInclusive: boolean; zeroRated?: boolean }) {
  const slots = afterPaymentDocTypes(vatInclusive, zeroRated);
  const withDocs = batches
    .filter((b) => !b.cancelled)
    .map((b) => ({
      b,
      rows: slots
        .map((t) => ({ label: t.label, files: b.docs?.[t.key] ?? [] }))
        .filter((r) => r.files.length > 0),
    }))
    .filter((x) => x.rows.length > 0);
  if (withDocs.length === 0) return null;

  return (
    <div className="space-y-2 rounded-md border p-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Delivery documents by batch</p>
      {withDocs.map(({ b, rows }) => (
        <div key={b.id} className="space-y-1">
          <p className="text-sm font-medium">{b.drNumber ? `DR ${b.drNumber}` : "Batch"}</p>
          <div className="space-y-1 pl-3">
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
      ))}
    </div>
  );
}
