"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { MessageSquare, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatDateTime } from "@/lib/utils";
import type { OrderConversation } from "@/lib/order-workflow";
import { addOrderConversation, deleteOrderConversation } from "../actions";

/** yyyy-MM-ddTHH:mm in local time, for the datetime-local input default. */
function nowLocalInput(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Sales' log of conversations with production heads about this order. */
export function ConversationLog({
  orderId,
  conversations,
  canLog,
  jobOrderRemarks = [],
}: {
  orderId: string;
  conversations: OrderConversation[];
  canLog: boolean;
  /** Notes captured on job orders (e.g. duct "Center Reducer / Flat bottom"),
   * surfaced here as remarks sales can reference or add to a conversation. */
  jobOrderRemarks?: { label: string; note: string }[];
}) {
  const router = useRouter();
  const [at, setAt] = useState(nowLocalInput());
  const [withName, setWithName] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const sorted = [...conversations].sort((a, b) => (a.at < b.at ? 1 : -1));

  async function add() {
    setBusy(true);
    setErr(null);
    try {
      // Convert the local datetime-local value to an ISO instant.
      const iso = at ? new Date(at).toISOString() : new Date().toISOString();
      await addOrderConversation(orderId, { at: iso, withName, message });
      setMessage("");
      setWithName("");
      setAt(nowLocalInput());
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    if (!window.confirm("Remove this conversation note?")) return;
    setBusy(true);
    setErr(null);
    try {
      await deleteOrderConversation(orderId, id);
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground">
        <MessageSquare className="h-3.5 w-3.5" /> Conversation log
      </div>

      {jobOrderRemarks.length > 0 && (
        <div className="space-y-1 rounded-md border border-dashed bg-muted/20 p-2">
          <div className="text-[11px] font-semibold text-muted-foreground">Job order remarks</div>
          {jobOrderRemarks.map((rmk, i) => (
            <div key={i} className="flex flex-wrap items-center gap-2 text-xs">
              <span className="font-mono text-muted-foreground">{rmk.label}</span>
              <span>{rmk.note}</span>
              {canLog && (
                <button
                  type="button"
                  onClick={() => setMessage((m) => (m.trim() ? `${m}\n${rmk.label}: ${rmk.note}` : `${rmk.label}: ${rmk.note}`))}
                  className="text-[11px] font-medium text-[#ED1C24] hover:underline"
                >
                  Add to conversation
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {sorted.length === 0 ? (
        <p className="text-sm text-muted-foreground">No conversations logged yet.</p>
      ) : (
        <div className="space-y-2">
          {sorted.map((c) => (
            <div key={c.id} className="rounded-md border p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-xs text-muted-foreground">
                  <span className="font-medium text-foreground/80">{formatDateTime(new Date(c.at))}</span>
                  {c.withName && <span> · with <span className="font-medium text-foreground/80">{c.withName}</span></span>}
                </div>
                {canLog && (
                  <button type="button" onClick={() => remove(c.id)} disabled={busy}
                    className="text-muted-foreground hover:text-destructive" aria-label="Remove">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
              <p className="mt-1 whitespace-pre-wrap text-sm">{c.message}</p>
              {c.loggedByName && <p className="mt-1 text-[11px] text-muted-foreground">Logged by {c.loggedByName}</p>}
            </div>
          ))}
        </div>
      )}

      {canLog && (
        <div className="space-y-2 rounded-md border bg-muted/20 p-3">
          <div className="grid gap-2 sm:grid-cols-2">
            <label className="space-y-1">
              <span className="text-xs text-muted-foreground">Date &amp; time</span>
              <Input className="h-8" type="datetime-local" value={at} onChange={(e) => setAt(e.target.value)} />
            </label>
            <label className="space-y-1">
              <span className="text-xs text-muted-foreground">Talked to</span>
              <Input className="h-8" placeholder="e.g. production head's name" value={withName} onChange={(e) => setWithName(e.target.value)} />
            </label>
          </div>
          <textarea
            className="min-h-[64px] w-full rounded-md border bg-background px-3 py-2 text-sm"
            placeholder="What was discussed…"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
          />
          <div className="flex items-center gap-2">
            <Button size="sm" disabled={busy || message.trim() === ""} onClick={add}>
              {busy ? "Saving…" : "Add conversation"}
            </Button>
            {err && <span className="text-xs text-destructive">{err}</span>}
          </div>
        </div>
      )}
    </div>
  );
}
