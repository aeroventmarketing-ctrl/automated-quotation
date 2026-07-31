"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Paperclip } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import type { InboundRfqItem } from "@/lib/inbound-rfq";

const fmt = (iso: string) => {
  const t = Date.parse(iso);
  return Number.isNaN(t) ? "" : new Date(t).toLocaleString("en-PH", { year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
};

type Tab = "pending" | "handled";

export function InboundReviewQueue({
  items,
  configured,
  onCreate,
  onDismiss,
}: {
  items: InboundRfqItem[];
  configured: boolean;
  onCreate: (itemId: string) => Promise<{ inquiryId: string }>;
  onDismiss: (itemId: string) => Promise<void>;
}) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("pending");
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [created, setCreated] = useState<Record<string, string>>({});

  const pending = items.filter((i) => i.status === "pending");
  const handled = items.filter((i) => i.status !== "pending");
  const shown = tab === "pending" ? pending : handled;

  async function create(id: string) {
    setBusy(id); setErr(null);
    try {
      const { inquiryId } = await onCreate(id);
      setCreated((c) => ({ ...c, [id]: inquiryId }));
      router.refresh();
    } catch (e) { setErr(e instanceof Error ? e.message : "Failed"); }
    finally { setBusy(null); }
  }
  async function dismiss(id: string) {
    if (!window.confirm("Dismiss this message? It won't become an inquiry.")) return;
    setBusy(id); setErr(null);
    try { await onDismiss(id); router.refresh(); }
    catch (e) { setErr(e instanceof Error ? e.message : "Failed"); }
    finally { setBusy(null); }
  }

  return (
    <div className="space-y-3">
      {!configured && (
        <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          Inbound isn&rsquo;t wired up yet — set <code>INBOUND_WEBHOOK_SECRET</code> and point your Resend inbound webhook
          at <code>/api/inbound-email</code>. Until then this queue stays empty.
        </div>
      )}

      <div className="flex flex-wrap gap-1.5">
        {(["pending", "handled"] as Tab[]).map((t) => (
          <button key={t} type="button" onClick={() => setTab(t)}
            className={`rounded-full border px-3 py-1.5 text-sm font-medium transition-colors ${tab === t ? "border-primary bg-primary text-primary-foreground" : "border-border hover:bg-accent"}`}>
            {t === "pending" ? "Pending" : "Handled"}
            <span className={`ml-1.5 text-xs ${tab === t ? "text-primary-foreground/80" : "text-muted-foreground"}`}>{t === "pending" ? pending.length : handled.length}</span>
          </button>
        ))}
      </div>

      {err && <p className="text-sm text-destructive">{err}</p>}

      {shown.length === 0 ? (
        <Card><CardContent className="py-8 text-center text-sm text-muted-foreground">
          {tab === "pending" ? "No inbound RFQs waiting for review." : "Nothing handled yet."}
        </CardContent></Card>
      ) : (
        <div className="space-y-2">
          {shown.map((it) => (
            <Card key={it.id}>
              <CardContent className="space-y-2 pt-6">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="font-medium">{it.fromName || it.fromEmail}</div>
                    <div className="text-xs text-muted-foreground">{it.fromEmail}{it.subject ? ` · ${it.subject}` : ""}</div>
                  </div>
                  <span className="shrink-0 text-xs text-muted-foreground">{fmt(it.receivedAt)}</span>
                </div>

                {it.text && <p className="whitespace-pre-wrap rounded-md bg-muted/40 p-2 text-xs text-foreground/90">{it.text.slice(0, 1200)}</p>}

                {it.attachments.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {it.attachments.map((a, i) => (
                      <a key={i} href={a.url} target="_blank" rel="noreferrer"
                        className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs hover:bg-accent">
                        <Paperclip className="h-3.5 w-3.5" /> {a.name}
                      </a>
                    ))}
                  </div>
                )}

                {it.status === "pending" ? (
                  <div className="flex flex-wrap items-center gap-2">
                    {created[it.id] ? (
                      <Link href={`/inquiries/${created[it.id]}`} className="text-sm font-medium text-primary hover:underline">Inquiry created — open →</Link>
                    ) : (
                      <>
                        <Button size="sm" disabled={busy === it.id} onClick={() => create(it.id)}>{busy === it.id ? "Working…" : "Create inquiry"}</Button>
                        <Button size="sm" variant="outline" disabled={busy === it.id} onClick={() => dismiss(it.id)}>Dismiss</Button>
                      </>
                    )}
                  </div>
                ) : (
                  <div className="text-xs text-muted-foreground">
                    {it.status === "accepted"
                      ? <>Inquiry created{it.inquiryId ? <> — <Link href={`/inquiries/${it.inquiryId}`} className="text-primary hover:underline">open →</Link></> : null}{it.handledByName ? ` · by ${it.handledByName}` : ""}</>
                      : <>Dismissed{it.handledByName ? ` · by ${it.handledByName}` : ""}</>}
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
