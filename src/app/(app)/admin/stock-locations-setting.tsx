"use client";

import { useState } from "react";
import { X } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/** Admin editor for the warehouse location list used by the Inventory dropdown. */
export function StockLocationsSetting({
  initial,
  onSave,
}: {
  initial: string[];
  onSave: (input: { locations: string[] }) => Promise<string[]>;
}) {
  const [list, setList] = useState<string[]>(initial);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const dirty = JSON.stringify(list) !== JSON.stringify(initial);

  function add() {
    const v = input.trim();
    if (!v || list.includes(v)) { setInput(""); return; }
    setList([...list, v]);
    setInput("");
  }
  function remove(loc: string) {
    setList(list.filter((l) => l !== loc));
  }
  async function save() {
    setBusy(true); setErr(null); setMsg(null);
    try {
      const saved = await onSave({ locations: list });
      setList(saved);
      setMsg("Saved.");
      setTimeout(() => setMsg(null), 1500);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader className="pb-2"><CardTitle className="text-sm">Stock locations</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-muted-foreground">
          Bins/shelves offered as a dropdown for each stock item&apos;s Location (in Inventory). Add the locations your warehouse uses.
        </p>
        {list.length > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            {list.map((loc) => (
              <span key={loc} className="inline-flex items-center gap-1 rounded-full border bg-muted/40 px-2.5 py-1 text-xs">
                {loc}
                <button type="button" className="text-muted-foreground hover:text-destructive" onClick={() => remove(loc)} aria-label={`Remove ${loc}`}>
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">No locations yet — the Inventory Location field stays a free-text box until you add some.</p>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <Input
            className="h-8 w-48"
            placeholder="e.g. A-1-2"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } }}
          />
          <Button size="sm" variant="outline" className="h-8" onClick={add}>Add</Button>
          <Button size="sm" className="h-8" disabled={busy || !dirty} onClick={save}>{busy ? "Saving…" : "Save changes"}</Button>
          {msg && <span className="text-xs text-emerald-600">{msg}</span>}
          {err && <span className="text-xs text-destructive">{err}</span>}
        </div>
      </CardContent>
    </Card>
  );
}
