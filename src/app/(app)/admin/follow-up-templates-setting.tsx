"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { FOLLOWUP_PLACEHOLDERS, templateForNudge, type FollowUpTemplate } from "@/lib/follow-up-email";

/**
 * Admin editor for the per-nudge follow-up copy. Each nudge (1, 2, 3 …) gets its
 * own subject + message; the branded design (greeting, "View your quotation"
 * button, signature, opt-out) is applied automatically around the message. The
 * number of editable nudges follows the follow-up cadence's "Max nudges".
 */
export function FollowUpTemplatesSetting({
  count,
  templates,
  onSave,
}: {
  count: number;
  templates: FollowUpTemplate[];
  onSave: (input: { templates: FollowUpTemplate[] }) => Promise<FollowUpTemplate[]>;
}) {
  const n = Math.max(1, count);
  const seed = Array.from({ length: n }, (_, i) => {
    const t = templateForNudge(templates, i + 1);
    return { subject: t.subject, body: t.body };
  });
  const [rows, setRows] = useState<FollowUpTemplate[]>(seed);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  function update(i: number, field: "subject" | "body", value: string) {
    setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, [field]: value } : r)));
  }

  async function save() {
    setBusy(true);
    setMsg(null);
    try {
      const saved = await onSave({ templates: rows });
      setRows(Array.from({ length: n }, (_, i) => {
        const t = templateForNudge(saved, i + 1);
        return { subject: t.subject, body: t.body };
      }));
      setMsg({ ok: true, text: "Saved. New follow-ups will use this copy." });
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : "Failed to save" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">Follow-up email content (per nudge)</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-xs text-muted-foreground">
          Write a different message for each nudge in the cadence. The greeting, the
          <strong> View your quotation</strong> button, your signature and the opt-out line are added
          automatically — you only edit the subject and the message. Use the
          <strong> Preview nudge</strong> control above to email any nudge to yourself.
        </p>
        <div className="rounded-md border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
          <span className="font-medium text-foreground">Placeholders</span> (auto-filled per client):{" "}
          {FOLLOWUP_PLACEHOLDERS.map((p) => (
            <code key={p} className="mx-0.5 rounded bg-background px-1 py-0.5 text-[11px]">{p}</code>
          ))}
        </div>

        {rows.map((r, i) => (
          <div key={i} className="space-y-2 rounded-md border p-3">
            <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Nudge #{i + 1}</div>
            <div className="space-y-1">
              <Label htmlFor={`fu-subj-${i}`} className="text-xs">Subject</Label>
              <Input id={`fu-subj-${i}`} value={r.subject} onChange={(e) => update(i, "subject", e.target.value)} placeholder="e.g. Following up on your quotation {quoteNumber}" className="h-9" />
            </div>
            <div className="space-y-1">
              <Label htmlFor={`fu-body-${i}`} className="text-xs">Message</Label>
              <Textarea id={`fu-body-${i}`} value={r.body} onChange={(e) => update(i, "body", e.target.value)} rows={5} placeholder="Write this nudge's message. Separate paragraphs with a blank line." />
            </div>
          </div>
        ))}

        <div className="flex items-center gap-3">
          <Button onClick={save} disabled={busy} size="sm">{busy ? "Saving…" : "Save follow-up content"}</Button>
          {msg && <span className={`text-xs ${msg.ok ? "text-emerald-600" : "text-destructive"}`}>{msg.text}</span>}
        </div>
      </CardContent>
    </Card>
  );
}
