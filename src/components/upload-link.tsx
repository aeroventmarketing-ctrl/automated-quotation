"use client";

import { FileText, Eye, Download, Trash2 } from "lucide-react";

export interface UploadDoc {
  path: string;
  name: string;
}

/**
 * A single stored-file link with a consistent toolbar across the whole system:
 * the filename (opens the inline "view"), an eye icon (view), a download icon,
 * and — when `onRemove` is given — a trash icon to delete it.
 *
 * `base` is the file API route for this document kind, e.g. "/api/sale-uploads",
 * "/api/purchase-uploads", "/api/cash-uploads", "/api/transfer-uploads". Viewing
 * uses `${base}/view` (renders spreadsheets to HTML, shows PDFs/images inline);
 * download uses the plain route with ?download=1.
 */
export function UploadLink({
  doc,
  base,
  onRemove,
  busy = false,
  size = "sm",
}: {
  doc: UploadDoc;
  base: string;
  onRemove?: () => void;
  busy?: boolean;
  size?: "sm" | "xs";
}) {
  const enc = encodeURIComponent;
  const view = `${base}/view?path=${enc(doc.path)}&name=${enc(doc.name)}`;
  const download = `${base}?path=${enc(doc.path)}&download=1&name=${enc(doc.name)}`;
  const ic = size === "xs" ? "h-3.5 w-3.5" : "h-4 w-4";
  const txt = size === "xs" ? "text-xs" : "text-sm";
  return (
    <span className="inline-flex items-center gap-1.5">
      <a href={view} target="_blank" rel="noopener noreferrer" className={`inline-flex items-center gap-1 ${txt} text-primary underline`}>
        <FileText className={ic} /> {doc.name}
      </a>
      <a href={view} target="_blank" rel="noopener noreferrer" className="text-muted-foreground hover:text-primary" title="View" aria-label="View">
        <Eye className={ic} />
      </a>
      <a href={download} className="text-muted-foreground hover:text-primary" title="Download" aria-label="Download">
        <Download className={ic} />
      </a>
      {onRemove && (
        <button type="button" onClick={onRemove} disabled={busy} className="text-muted-foreground hover:text-destructive disabled:opacity-50" title="Remove" aria-label="Remove">
          <Trash2 className={ic} />
        </button>
      )}
    </span>
  );
}
