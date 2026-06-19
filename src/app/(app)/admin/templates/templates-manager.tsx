"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { upsertTemplate, deleteTemplate } from "../actions";

interface T { id: string; name: string; layoutKey: string; active: boolean; configJson: string }

const blank: T = { id: "", name: "", layoutKey: "", active: true, configJson: '{\n  "accent": "#1d4ed8",\n  "showSpecs": true,\n  "showTerms": true\n}' };

export function TemplatesManager({ templates }: { templates: T[] }) {
  const router = useRouter();
  const [editing, setEditing] = useState<T | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    if (!editing) return;
    setBusy(true);
    setError(null);
    try {
      await upsertTemplate({
        id: editing.id || undefined,
        name: editing.name,
        layoutKey: editing.layoutKey,
        configJson: editing.configJson,
        active: editing.active,
      });
      setEditing(null);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    if (!confirm("Delete this template?")) return;
    await deleteTemplate(id);
    router.refresh();
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button onClick={() => setEditing({ ...blank })}>+ New template</Button>
      </div>

      {editing && (
        <Card className="border-primary/40">
          <CardHeader><CardTitle>{editing.id ? "Edit" : "New"} template</CardTitle></CardHeader>
          <CardContent className="grid gap-3 md:grid-cols-2">
            <div className="space-y-1">
              <Label>Name *</Label>
              <Input value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
            </div>
            <div className="space-y-1">
              <Label>Layout key * (unique)</Label>
              <Input value={editing.layoutKey} onChange={(e) => setEditing({ ...editing, layoutKey: e.target.value })} placeholder="e.g. standard" />
            </div>
            <div className="flex items-center gap-2">
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={editing.active} onChange={(e) => setEditing({ ...editing, active: e.target.checked })} />
                Active
              </label>
            </div>
            <div className="space-y-1 md:col-span-2">
              <Label>Config (JSON) — controls accent color & sections (accent, showSpecs, showSelectionNotes, budgetary, showAbcNote, currency)</Label>
              <Textarea className="font-mono text-xs" rows={6} value={editing.configJson} onChange={(e) => setEditing({ ...editing, configJson: e.target.value })} />
            </div>
            {error && <p className="text-sm text-destructive md:col-span-2">{error}</p>}
            <div className="flex gap-2 md:col-span-2">
              <Button onClick={save} disabled={busy}>{busy ? "Saving…" : "Save"}</Button>
              <Button variant="outline" onClick={() => setEditing(null)}>Cancel</Button>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-3 md:grid-cols-2">
        {templates.map((t) => (
          <Card key={t.id}>
            <CardContent className="flex items-center justify-between pt-6">
              <div>
                <div className="font-medium">{t.name} {!t.active && <Badge variant="secondary">inactive</Badge>}</div>
                <div className="text-xs text-muted-foreground">{t.layoutKey}</div>
              </div>
              <div className="flex gap-1">
                <Button size="sm" variant="ghost" onClick={() => setEditing(t)}>Edit</Button>
                <Button size="sm" variant="ghost" onClick={() => remove(t.id)}>Delete</Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
