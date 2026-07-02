"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDate, isNextControlFlowError } from "@/lib/utils";
import { Plus, Trash2, MessageSquare, CalendarClock } from "lucide-react";
import { addConversation, deleteConversation } from "../actions";

export interface ConversationView {
  id: string;
  date: string;
  channel: string;
  contactPerson: string;
  message: string;
  quoteNumber: string | null;
  nextFollowUp: string | null;
  loggedById: string;
  loggedByName: string;
  createdAt: string;
}

export interface ConversationBoxData {
  quoteNumber: string | null; // the quotation this box represents (null = general)
  label: string;
  conversations: ConversationView[];
}

const CHANNELS = ["Phone", "Email", "Viber", "Meeting", "SMS", "WhatsApp", "Other"];

const today = () => new Date().toISOString().slice(0, 10);

/** One conversation box, representing a single quotation (or the general box). */
function ConversationBox({
  customerId,
  box,
  defaultContact,
  currentUserId,
  isAdmin,
}: {
  customerId: string;
  box: ConversationBoxData;
  defaultContact: string;
  currentUserId: string | null;
  isAdmin: boolean;
}) {
  const router = useRouter();
  const [date, setDate] = useState(today());
  const [channel, setChannel] = useState("Phone");
  const [contactPerson, setContactPerson] = useState(defaultContact);
  const [nextFollowUp, setNextFollowUp] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onAdd() {
    if (!message.trim()) {
      setError("Message is required.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await addConversation(customerId, {
        date,
        channel,
        contactPerson,
        message,
        quoteNumber: box.quoteNumber ?? "",
        nextFollowUp,
      });
      setMessage("");
      setNextFollowUp("");
      setDate(today());
      router.refresh();
    } catch (e) {
      if (isNextControlFlowError(e)) throw e;
      setError(e instanceof Error ? e.message : "Failed to log conversation");
    } finally {
      setBusy(false);
    }
  }

  async function onDelete(id: string) {
    if (!confirm("Delete this conversation log?")) return;
    try {
      await deleteConversation(customerId, id);
      router.refresh();
    } catch (e) {
      if (isNextControlFlowError(e)) throw e;
      alert(e instanceof Error ? e.message : "Delete failed");
    }
  }

  const sorted = [...box.conversations].sort(
    (a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt),
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          {box.quoteNumber ? <Badge variant="secondary">{box.label}</Badge> : <span>{box.label}</span>}
          <span className="text-xs font-normal text-muted-foreground">
            {sorted.length} conversation{sorted.length === 1 ? "" : "s"}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        {/* New entry */}
        <div className="grid gap-3 rounded-md border p-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="space-y-1">
            <Label>Date</Label>
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label>Channel</Label>
            <Select value={channel} onChange={(e) => setChannel(e.target.value)}>
              {CHANNELS.map((c) => (<option key={c} value={c}>{c}</option>))}
            </Select>
          </div>
          <div className="space-y-1">
            <Label>Spoke with</Label>
            <Input value={contactPerson} onChange={(e) => setContactPerson(e.target.value)} placeholder="Contact person" />
          </div>
          <div className="space-y-1">
            <Label>Next follow-up</Label>
            <Input type="date" value={nextFollowUp} onChange={(e) => setNextFollowUp(e.target.value)} />
          </div>
          <div className="space-y-1 sm:col-span-2 lg:col-span-4">
            <Label>Message / notes</Label>
            <Textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows={2}
              placeholder="What was discussed, client response, next steps…"
            />
          </div>
          <div className="flex items-center gap-3 sm:col-span-2 lg:col-span-4">
            <Button size="sm" onClick={onAdd} disabled={busy}>
              <Plus className="h-4 w-4" />
              {busy ? "Saving…" : "Log conversation"}
            </Button>
            {error && <span className="text-sm text-destructive">{error}</span>}
          </div>
        </div>

        {/* Log */}
        {sorted.length === 0 ? (
          <p className="text-sm text-muted-foreground">No conversations logged yet.</p>
        ) : (
          <ul className="space-y-3">
            {sorted.map((c) => (
              <li key={c.id} className="rounded-md border p-3">
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="font-medium">{formatDate(new Date(c.date))}</span>
                  <Badge variant="outline">{c.channel}</Badge>
                  {c.contactPerson && <span className="text-muted-foreground">with {c.contactPerson}</span>}
                  <span className="ml-auto flex items-center gap-2">
                    {(isAdmin || c.loggedById === currentUserId) && (
                      <Button
                        size="sm"
                        variant="ghost"
                        title="Delete"
                        onClick={() => onDelete(c.id)}
                        className="text-destructive hover:text-destructive"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    )}
                  </span>
                </div>
                <p className="mt-1 flex items-start gap-1.5 text-sm">
                  <MessageSquare className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  <span className="whitespace-pre-wrap">{c.message}</span>
                </p>
                <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                  <span>Logged by {c.loggedByName}</span>
                  {c.nextFollowUp && (
                    <span className="flex items-center gap-1 text-amber-600">
                      <CalendarClock className="h-3.5 w-3.5" />
                      Next follow-up {formatDate(new Date(c.nextFollowUp))}
                    </span>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

export function ConversationPanel({
  customerId,
  boxes,
  defaultContact,
  currentUserId,
  isAdmin,
}: {
  customerId: string;
  boxes: ConversationBoxData[];
  defaultContact: string;
  currentUserId: string | null;
  isAdmin: boolean;
}) {
  return (
    <div className="space-y-3">
      <h2 className="text-lg font-semibold">Conversation history</h2>
      <p className="text-sm text-muted-foreground">
        One box per quotation — log each follow-up under the quote it relates to.
      </p>
      {boxes.map((box) => (
        <ConversationBox
          key={box.quoteNumber ?? "__general__"}
          customerId={customerId}
          box={box}
          defaultContact={defaultContact}
          currentUserId={currentUserId}
          isAdmin={isAdmin}
        />
      ))}
    </div>
  );
}
