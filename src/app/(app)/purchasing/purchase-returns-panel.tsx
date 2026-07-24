"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { RotateCcw, Upload } from "lucide-react";
import { UploadLink } from "@/components/upload-link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { PurchaseReturnView } from "@/lib/purchase-chain-row";
import type { SaleDoc } from "@/lib/sale";
import { returnPurchaseItems, resolvePurchaseReturn, removePurchaseReturnProof } from "../orders/actions";


/**
 * "Returns to supplier" panel: lists items disapproved on inspection and sent
 * back for replacement, lets an inspector raise a new return, and lets the
 * purchaser/warehouse mark the replacement received — attaching proof that the
 * item was replaced. Shared by the individual chain rows and the combined-PO
 * card. `prId` is the request (or anchor) to act on. Read-only on the order page.
 */
export function PurchaseReturnsPanel({
  prId,
  returns,
  canRaiseReturn,
  canResolveReturn,
  readOnly = false,
  admin = false,
}: {
  prId: string;
  returns: PurchaseReturnView[];
  canRaiseReturn: boolean;
  canResolveReturn: boolean;
  readOnly?: boolean;
  admin?: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  // Resolve form state (per return being closed out).
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [proof, setProof] = useState<SaleDoc[]>([]);

  const unresolved = returns.filter((r) => !r.resolved).length;

  async function raise() {
    if (!items.trim() || !reason.trim()) { setErr("Fill in the item(s) and the reason."); return; }
    setBusy("raise"); setErr(null);
    try {
      await returnPurchaseItems(prId, { items, reason });
      setItems(""); setReason(""); setOpen(false);
      router.refresh();
    } catch (e) { setErr(e instanceof Error ? e.message : "Failed"); }
    finally { setBusy(null); }
  }

  function startResolve(id: string) {
    setResolvingId(id); setNote(""); setProof([]); setErr(null);
  }

  async function uploadProof(file: File) {
    setBusy("upload"); setErr(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("purchaseRequestId", prId);
      const res = await fetch("/api/purchase-uploads", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Upload failed");
      setProof((ps) => [...ps, data as SaleDoc]);
    } catch (e) { setErr(e instanceof Error ? e.message : "Upload failed"); }
    finally { setBusy(null); }
  }

  async function confirmResolve() {
    if (proof.length === 0) { setErr("Upload proof that the item was replaced."); return; }
    setBusy("resolve"); setErr(null);
    try {
      await resolvePurchaseReturn(prId, resolvingId!, note, proof);
      setResolvingId(null); setNote(""); setProof([]);
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
            Returns to supplier{unresolved > 0 ? ` · ${unresolved} awaiting replacement` : " · all resolved"}
          </p>
          <ul className="mt-1 space-y-1.5">
            {returns.map((r) => (
              <li key={r.id} className="text-xs">
                <div className="font-medium text-foreground">{r.items}</div>
                <div className="text-muted-foreground">Reason: {r.reason}</div>
                <div className="text-muted-foreground">Returned by {r.raised}</div>
                {r.resolved ? (
                  <>
                    <div className="text-emerald-700">✓ {r.resolved}</div>
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
                  </>
                ) : !readOnly && canResolveReturn && resolvingId === r.id ? (
                  <div className="mt-1 space-y-1.5 rounded-md border bg-background p-2">
                    <div className="font-medium text-foreground">Replacement received</div>
                    {/* Proof the item was replaced. */}
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
                    <Input className="h-8" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (optional) — e.g. replaced, credited" />
                    <div className="flex items-center gap-2">
                      <Button size="sm" className="h-7 text-xs" disabled={busy === "resolve"} onClick={confirmResolve}>
                        {busy === "resolve" ? "Saving…" : "Confirm replacement"}
                      </Button>
                      <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => { setResolvingId(null); setErr(null); }}>Cancel</Button>
                    </div>
                  </div>
                ) : (
                  <div className="mt-0.5 flex items-center gap-2">
                    <span className="font-medium text-amber-700">Awaiting replacement from supplier</span>
                    {!readOnly && canResolveReturn && (
                      <button
                        type="button"
                        onClick={() => startResolve(r.id)}
                        className="rounded border border-emerald-600/50 px-2 py-0.5 font-medium text-emerald-700 hover:bg-emerald-600/10"
                      >
                        Replacement received
                      </button>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {!readOnly && canRaiseReturn && (
        open ? (
          <div className="space-y-2 rounded-md border p-2">
            <div className="text-xs font-medium">Return item(s) to supplier</div>
            <label className="block space-y-1">
              <span className="text-xs text-muted-foreground">Item(s) &amp; quantity being returned</span>
              <Input className="h-8" value={items} onChange={(e) => setItems(e.target.value)} placeholder="e.g. 3 pcs GI sheet 24ga — dented" />
            </label>
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
