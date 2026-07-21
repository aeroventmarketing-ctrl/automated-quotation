/**
 * A print-friendly HTML rendering of a Purchase Order — for viewing the PO in
 * the browser (no download). The downloadable version stays the template-based
 * .xlsx (with the BIR 2307); this is a clean read-only view of the PO itself.
 */
import { COMPANY } from "@/lib/config";
import { poLineAmount, poTotals, type PurchaseOrder } from "@/lib/purchase-order";

function esc(s: string): string {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function peso(n: number): string {
  return `₱${n.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtDate(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Manila", year: "numeric", month: "long", day: "numeric" }).format(d);
}

export function renderPurchaseOrderHtml(po: PurchaseOrder): string {
  const totals = poTotals(po);
  const rows = po.lines
    .map((l, i) => {
      const amt = poLineAmount(l);
      return `<tr>
        <td class="c">${i + 1}</td>
        <td>${esc(l.description)}</td>
        <td class="c">${esc([l.qty, l.unit].filter(Boolean).join(" "))}</td>
        <td class="r">${l.unitPrice ? peso(Number(String(l.unitPrice).replace(/,/g, "")) || 0) : "—"}</td>
        <td class="r">${amt ? peso(amt) : "—"}</td>
      </tr>`;
    })
    .join("");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(po.poNumber || "Purchase Order")}</title>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body { margin: 0; background: #f3f4f6; color: #111827; font-family: "Times New Roman", Georgia, serif; }
  .sheet { max-width: 820px; margin: 16px auto; background: #fff; padding: 28px 32px; box-shadow: 0 1px 4px rgba(0,0,0,.15); }
  .brand { text-align: center; border-bottom: 2px solid #ED1C24; padding-bottom: 8px; margin-bottom: 12px; }
  .brand h1 { margin: 0; font-size: 20px; color: #ED1C24; letter-spacing: .5px; }
  .brand .tag { font-size: 10px; font-style: italic; color: #555; }
  .brand .addr { font-size: 10px; color: #444; margin-top: 2px; }
  h2 { text-align: center; font-size: 16px; letter-spacing: 2px; margin: 10px 0 14px; }
  .meta { display: flex; justify-content: space-between; gap: 16px; font-size: 13px; margin-bottom: 12px; }
  .meta .po { font-weight: bold; color: #ED1C24; }
  .sup { border: 1px solid #d1d5db; padding: 8px 10px; font-size: 13px; margin-bottom: 12px; }
  .sup .lbl { font-size: 10px; text-transform: uppercase; letter-spacing: .5px; color: #6b7280; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  th, td { border: 1px solid #d1d5db; padding: 6px 8px; vertical-align: top; }
  th { background: #ED1C24; color: #fff; font-size: 12px; text-align: left; }
  td.c, th.c { text-align: center; }
  td.r, th.r { text-align: right; }
  tbody tr:nth-child(even) td { background: #fafafa; }
  .totals { margin-top: 10px; margin-left: auto; width: 260px; font-size: 13px; }
  .totals div { display: flex; justify-content: space-between; padding: 3px 0; }
  .totals .net { border-top: 1px solid #111; font-weight: bold; margin-top: 4px; padding-top: 6px; }
  .rem { margin-top: 14px; font-size: 12px; }
  .rem .lbl { font-size: 10px; text-transform: uppercase; letter-spacing: .5px; color: #6b7280; }
  .sign { margin-top: 40px; font-size: 12px; }
  .sign .line { border-top: 1px solid #111; width: 220px; padding-top: 4px; }
  .bar { position: sticky; top: 0; background: #111827; color: #fff; padding: 8px 16px; display: flex; gap: 10px; align-items: center; justify-content: space-between; }
  .bar button { background: #ED1C24; color: #fff; border: 0; border-radius: 6px; padding: 8px 14px; font-size: 13px; font-weight: 600; cursor: pointer; font-family: system-ui, sans-serif; }
  .bar .hint { font-size: 12px; color: #cbd5e1; font-family: system-ui, sans-serif; }
  @media print { .bar { display: none; } body { background: #fff; } .sheet { box-shadow: none; margin: 0; max-width: none; } }
</style>
</head>
<body>
  <div class="bar">
    <span class="hint">Viewing ${esc(po.poNumber || "Purchase Order")} — this is a preview; use the .xlsx download for the official PO &amp; 2307.</span>
    <button onclick="window.print()">Print</button>
  </div>
  <div class="sheet">
    <div class="brand">
      <h1>${esc(COMPANY.name)}</h1>
      <div class="tag">${esc(COMPANY.tagline)}</div>
      <div class="addr">${esc(COMPANY.manilaOffice)}</div>
      <div class="addr">${esc(COMPANY.landline)} · ${esc(COMPANY.email)}</div>
    </div>
    <h2>PURCHASE ORDER</h2>
    <div class="meta">
      <div><span class="po">${esc(po.poNumber)}</span></div>
      <div>Date: <b>${esc(fmtDate(po.date))}</b></div>
    </div>
    <div class="sup">
      <div class="lbl">Supplier</div>
      <div><b>${esc(po.supplier.company)}</b></div>
      ${po.supplier.attention ? `<div>${esc(po.supplier.attention)}</div>` : ""}
      ${po.supplier.address ? `<div>${esc(po.supplier.address)}</div>` : ""}
    </div>
    <table>
      <thead>
        <tr><th class="c" style="width:34px">#</th><th>Description</th><th class="c" style="width:90px">Qty</th><th class="r" style="width:110px">Unit price</th><th class="r" style="width:120px">Amount</th></tr>
      </thead>
      <tbody>${rows || `<tr><td colspan="5" class="c" style="color:#888">No lines.</td></tr>`}</tbody>
    </table>
    <div class="totals">
      <div><span>Total amount</span><span>${peso(totals.total)}</span></div>
      ${po.ewtPct > 0 ? `<div><span>Less EWT (${po.ewtPct}%)</span><span>${peso(totals.ewt)}</span></div>` : ""}
      <div class="net"><span>Net amount</span><span>${peso(totals.net)}</span></div>
    </div>
    ${po.remarks ? `<div class="rem"><span class="lbl">Payment terms / remarks</span><div>${esc(po.remarks)}</div></div>` : ""}
    <div class="sign">
      <div class="line">${esc(po.createdByName || "")}<div style="font-size:10px;color:#6b7280">Prepared by</div></div>
    </div>
  </div>
</body>
</html>`;
}
