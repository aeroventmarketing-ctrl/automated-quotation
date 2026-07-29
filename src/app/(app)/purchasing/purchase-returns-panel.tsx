"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { RotateCcw, Upload, Check } from "lucide-react";
import { UploadLink } from "@/components/upload-link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { PurchaseReturnView } from "@/lib/purchase-chain-row";
import type { SaleDoc } from "@/lib/sale";
import { uploadDocument } from "@/lib/client-upload";
import { returnPurchaseItems, advancePurchaseReturn, removePurchaseReturnProof } from "../orders/actions";


/**
 * "Returns to supplier" panel: lists items disapproved on inspection and sent
 * back for replacement, lets an inspector raise a new return, and tracks each
 * return through its lifecycle — sent to supplier → replaced → checked by
 * purchaser → in transit → warehouse received → plant-manager approved. Every
 * stage is gated to the role that owns it (advancing is re-checked server-side).
 * Shared by the individual chain rows and the combined-PO card. Read-only on the
 * order page.
 */
/** Parse a purchase line "9 pc · ANGLE BAR 2.0 X 25 X 25 (remark)". */
function parseReturnLine(label: string): { qty: string; unit: string; desc: string } {
  const noRemark = label.replace(/\s*\([^)]*\)\s*$/, "").trim();
  const dot = noRemark.indexOf("·");
  if (dot >= 0) {
    const head = noRemark.slice(0, dot).trim(); // "9 pc"
    const m = head.match(/^([\d.]+)\s*(.*)$/);
    return { qty: m?.[1] ?? "", unit: (m?.[2] ?? "").trim(), desc: noRemark.slice(dot + 1).trim() };
  }
  return { qty: "", unit: "", desc: noRemark };
}

export function PurchaseReturnsPanel({
  prId,
  returns,
  canRaiseReturn,
  advanceRoles = [],
  readOnly = false,
  admin = false,
  lineItems = [],
}: {
  prId: string;
  returns: PurchaseReturnView[];
  canRaiseReturn: boolean;
  /** Return-lifecycle roles the viewer holds (purchaser/logistics/warehouse/plant_manager). */
  advanceRoles?: string[];
  readOnly?: boolean;
  admin?: boolean;
  /** The purchase-request lines, so the return can be picked by tick box. */
  lineItems?: string[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  // Tick-box selection of which lines (and how much) are being returned.
  const parsedLines = lineItems.map(parseReturnLine);
  const [picks, setPicks] = useState<{ checked: boolean; qty: string }[]>(() =>
    lineItems.map((l) => ({ checked: false, qty: parseReturnLine(l).qty })),
  );
  const setPick = (i: number, patch: Partial<{ checked: boolean; qty: string }>) =>
    setPicks((ps) => ps.map((p, idx) => (idx === i ? { ...p, ...patch } : p)));

  // Proof/confirm form state (per return being advanced to "warehouse received").
  const [receivingId, setReceivingId] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [proof, setProof] = useState<SaleDoc[]>([]);

  const unresolved = returns.filter((r) => !r.done).length;
  const canAdvance = (r: PurchaseReturnView) =>
    !readOnly && r.awaiting != null && (admin || advanceRoles.includes(r.awaiting.role));

  async function raise() {
    // With line items, compile the ticked rows; otherwise use the free-text box.
    let itemsText = items.trim();
    if (lineItems.length > 0) {
      const chosen = picks
        .map((p, i) => (p.checked ? `${(p.qty || parsedLines[i].qty).trim()} ${parsedLines[i].unit} ${parsedLines[i].desc}`.replace(/\s+/g, " ").trim() : null))
        .filter((s): s is string => !!s);
      if (chosen.length === 0) { setErr("Tick at least one item to return."); return; }
      itemsText = chosen.join("; ");
    }
    if (!itemsText || !reason.trim()) { setErr("Select the item(s) and enter the reason."); return; }
    setBusy("raise"); setErr(null);
    try {
      await returnPurchaseItems(prId, { items: itemsText, reason });
      setItems(""); setReason(""); setOpen(false);
      setPicks(lineItems.map((l) => ({ checked: false, qty: parseReturnLine(l).qty })));
      router.refresh();
    } catch (e) { setErr(e instanceof Error ? e.message : "Failed"); }
    finally { setBusy(null); }
  }

  // Advance a stage that needs no proof (replaced / checked / in transit / approved).
  async function advance(r: PurchaseReturnView) {
    if (!r.awaiting) return;
    setBusy(r.id); setErr(null);
    try {
      await advancePurchaseReturn(prId, r.id, r.awaiting.toStage, { note: note.trim() || undefined });
      setNote("");
      router.refresh();
    } catch (e) { setErr(e instanceof Error ? e.message : "Failed"); }
    finally { setBusy(null); }
  }

  function startReceive(id: string) {
    setReceivingId(id); setNote(""); setProof([]); setErr(null);
  }

  async function uploadProof(file: File) {
    setBusy("upload"); setErr(null);
    try {
      const data = await uploadDocument("/api/purchase-uploads", file, { purchaseRequestId: prId }) as SaleDoc;
      setProof((ps) => [...ps, data]);
    } catch (e) { setErr(e instanceof Error ? e.message : "Upload failed"); }
    finally { setBusy(null); }
  }

  async function confirmReceive(r: PurchaseReturnView) {
    if (!r.awaiting) return;
    if (proof.length === 0) { setErr("Upload proof that the item was replaced."); return; }
    setBusy("receive"); setErr(null);
    try {
      await advancePurchaseReturn(prId, r.id, r.awaiting.toStage, { note: note.trim() || undefined, proof });
      setReceivingId(null); setNote(""); setProof([]);
      router.refresh();
    } catch (e) { setErr(e instanceof Error ? e.message : "Failed"); }
    finally { setBusy(null); }
  }

  if (readOnly && returns.length === 0) return null;

  return (
    <div className="mt-2 space-y-2">
      {returns.length > 0 && (
        <div className="rounded-md border border-amber-500/40 bg-amber-500/5 p-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-amber-700">
            Returns to supplier{unresolved > 0 ? ` · ${unresolved} in progress` : " · all replaced"}
          </p>
          <ul className="mt-1 space-y-2">
            {returns.map((r) => (
              <li key={r.id} className="text-xs">
                <div className="font-medium text-foreground">{r.items}</div>
                <div className="text-muted-foreground">Reason: {r.reason}</div>

                {/* Lifecycle timeline — each completed stage with who + when. */}
                <ol className="mt-1 space-y-0.5">
                  {r.timeline.map((t) => (
                    <li key={t.label} className="flex items-start gap-1 text-emerald-700">
                      <Check className="mt-0.5 h-3 w-3 shrink-0" />
                      <span>
                        <span className="font-medium">{t.label}</span>
                        {t.stamp ? <span className="text-muted-foreground"> — {t.stamp}</span> : null}
                      </span>
                    </li>
                  ))}
                </ol>

                {/* Proof the item was replaced (once attached). */}
                {r.proof.length > 0 && (
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1">
                    <span className="text-muted-foreground">Proof:</span>
                    {r.proof.map((f) => (
                      <UploadLink
                        key={f.path}
                        doc={f}
                        base="/api/purchase-uploads"
                        size="xs"
                        onRemove={admin ? async () => {
                          if (!window.confirm(`Remove proof "${f.name}"?`)) return;
                          try { await removePurchaseReturnProof(prId, r.id, f.path); router.refresh(); }
                          catch (e) { setErr(e instanceof Error ? e.message : "Failed to remove"); }
                        } : undefined}
                      />
                    ))}
                  </div>
                )}

                {/* Next step — status + (for the owning role) the advance control. */}
                {r.done ? (
                  <div className="mt-0.5 font-medium text-emerald-700">✓ Return complete — replacement approved into stock.</div>
                ) : r.awaiting ? (
                  receivingId === r.id ? (
                    // Warehouse-received: proof upload is mandatory.
                    <div className="mt-1 space-y-1.5 rounded-md border bg-background p-2">
                      <div className="font-medium text-foreground">{r.awaiting.advanceLabel}</div>
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                        {proof.map((f) => (
                          <UploadLink
                            key={f.path}
                            doc={f}
                            base="/api/purchase-uploads"
                            size="xs"
                            onRemove={() => setProof((ps) => ps.filter((x) => x.path !== f.path))}
                          />
                        ))}
                        <label className="inline-flex cursor-pointer items-center gap-1 rounded-md border px-2.5 py-1 font-medium hover:bg-accent">
                          <Upload className="h-3.5 w-3.5" /> {busy === "upload" ? "Uploading…" : proof.length ? "Add proof" : "Upload proof"}
                          <input type="file" className="hidden" disabled={busy === "upload"} onChange={(e) => e.target.files?.[0] && uploadProof(e.target.files[0])} />
                        </label>
                      </div>
                      <Input className="h-8" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (optional)" />
                      <div className="flex items-center gap-2">
                        <Button size="sm" className="h-7 text-xs" disabled={busy === "receive"} onClick={() => confirmReceive(r)}>
                          {busy === "receive" ? "Saving…" : "Confirm received"}
                        </Button>
                        <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => { setReceivingId(null); setErr(null); }}>Cancel</Button>
                      </div>
                    </div>
                  ) : (
                    <div className="mt-0.5 flex flex-wrap items-center gap-2">
                      <span className="font-medium text-amber-700">
                        Awaiting: {r.awaiting.advanceLabel} <span className="font-normal text-muted-foreground">({r.awaiting.roleLabel})</span>
                      </span>
                      {canAdvance(r) && (
                        <button
                          type="button"
                          disabled={busy === r.id}
                          onClick={() => (r.awaiting!.requiresProof ? startReceive(r.id) : advance(r))}
                          className="rounded border border-emerald-600/50 px-2 py-0.5 font-medium text-emerald-700 hover:bg-emerald-600/10 disabled:opacity-50"
                        >
                          {busy === r.id ? "Saving…" : r.awaiting.advanceLabel}
                        </button>
                      )}
                    </div>
                  )
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      )}

      {!readOnly && canRaiseReturn && (
        open ? (
          <div className="space-y-2 rounded-md border p-2">
            <div className="text-xs font-medium">Return item(s) to supplier</div>
            {lineItems.length > 0 ? (
              <div className="space-y-1">
                <span className="text-xs text-muted-foreground">Tick the item(s) &amp; quantity being returned</span>
                <div className="space-y-1 rounded-md border p-2">
                  {parsedLines.map((p, i) => (
                    <label key={i} className="flex flex-wrap items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        className="h-4 w-4"
                        checked={picks[i].checked}
                        onChange={(e) => setPick(i, { checked: e.target.checked })}
                      />
                      <Input
                        className="h-7 w-16 text-right"
                        type="number"
                        min={0}
                        step="any"
                        value={picks[i].qty}
                        disabled={!picks[i].checked}
                        onChange={(e) => setPick(i, { qty: e.target.value })}
                      />
                      {p.unit && <span className="text-xs text-muted-foreground">{p.unit}</span>}
                      <span>{p.desc}</span>
                    </label>
                  ))}
                </div>
              </div>
            ) : (
              <label className="block space-y-1">
                <span className="text-xs text-muted-foreground">Item(s) &amp; quantity being returned</span>
                <Input className="h-8" value={items} onChange={(e) => setItems(e.target.value)} placeholder="e.g. 3 pcs GI sheet 24ga — dented" />
              </label>
            )}
            <label className="block space-y-1">
              <span className="text-xs text-muted-foreground">Reason for disapproval</span>
              <Input className="h-8" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. failed quality check / wrong specification" />
            </label>
            <div className="flex items-center gap-2">
              <Button size="sm" className="h-7 text-xs" disabled={busy === "raise"} onClick={raise}>
                {busy === "raise" ? "Saving…" : "Return to supplier"}
              </Button>
              <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => { setOpen(false); setErr(null); }}>Cancel</Button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-md border border-amber-600/50 px-3 py-1.5 text-xs font-semibold text-amber-700 transition-colors hover:bg-amber-600/10"
          >
            <RotateCcw className="h-3.5 w-3.5" /> Return item to supplier
          </button>
        )
      )}
      {err && <p className="text-xs text-destructive">{err}</p>}
    </div>
  );
}
