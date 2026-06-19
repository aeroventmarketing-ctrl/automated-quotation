"use client";

import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Trash2 } from "lucide-react";
import { AIRFLOW_UNITS, PRESSURE_UNITS, type DraftItem } from "./types";

export function ItemRows({
  items,
  onChange,
}: {
  items: DraftItem[];
  onChange: (items: DraftItem[]) => void;
}) {
  function update(idx: number, patch: Partial<DraftItem>) {
    const next = items.map((it, i) => (i === idx ? { ...it, ...patch } : it));
    onChange(next);
  }
  function updateParsed(idx: number, patch: Partial<DraftItem["parsedJson"]>) {
    update(idx, { parsedJson: { ...items[idx].parsedJson, ...patch } });
  }
  function remove(idx: number) {
    onChange(items.filter((_, i) => i !== idx));
  }

  return (
    <div className="space-y-3">
      {items.map((it, idx) => (
        <div key={idx} className="rounded-lg border p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-sm font-medium">Item {idx + 1}</span>
            <Button type="button" variant="ghost" size="icon" onClick={() => remove(idx)}>
              <Trash2 className="h-4 w-4 text-destructive" />
            </Button>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-1 md:col-span-2">
              <Label className="text-xs">Description</Label>
              <Input
                value={it.parsedJson.description}
                onChange={(e) => updateParsed(idx, { description: e.target.value })}
                placeholder="e.g. Kitchen hood exhaust fan"
              />
            </div>

            <div className="space-y-1">
              <Label className="text-xs">Airflow</Label>
              <div className="flex gap-2">
                <Input
                  type="number"
                  step="any"
                  value={it.parsedJson.airflow ?? ""}
                  onChange={(e) =>
                    updateParsed(idx, { airflow: e.target.value === "" ? null : Number(e.target.value) })
                  }
                />
                <Select
                  className="w-28"
                  value={it.parsedJson.airflowUnit ?? ""}
                  onChange={(e) => updateParsed(idx, { airflowUnit: e.target.value || null })}
                >
                  <option value="">unit</option>
                  {AIRFLOW_UNITS.map((u) => (
                    <option key={u} value={u}>{u}</option>
                  ))}
                </Select>
              </div>
            </div>

            <div className="space-y-1">
              <Label className="text-xs">Static pressure</Label>
              <div className="flex gap-2">
                <Input
                  type="number"
                  step="any"
                  value={it.parsedJson.staticPressure ?? ""}
                  onChange={(e) =>
                    updateParsed(idx, {
                      staticPressure: e.target.value === "" ? null : Number(e.target.value),
                    })
                  }
                />
                <Select
                  className="w-28"
                  value={it.parsedJson.pressureUnit ?? ""}
                  onChange={(e) => updateParsed(idx, { pressureUnit: e.target.value || null })}
                >
                  <option value="">unit</option>
                  {PRESSURE_UNITS.map((u) => (
                    <option key={u} value={u}>{u}</option>
                  ))}
                </Select>
              </div>
            </div>

            <div className="space-y-1">
              <Label className="text-xs">Quantity</Label>
              <Input
                type="number"
                min={1}
                value={it.qty}
                onChange={(e) => {
                  const q = Math.max(1, Number(e.target.value) || 1);
                  update(idx, { qty: q, parsedJson: { ...it.parsedJson, qty: q } });
                }}
              />
            </div>

            <div className="space-y-1">
              <Label className="text-xs">Application</Label>
              <Input
                value={it.parsedJson.application ?? ""}
                onChange={(e) => updateParsed(idx, { application: e.target.value || null })}
                placeholder="e.g. dust collection"
              />
            </div>

            <div className="space-y-1 md:col-span-2">
              <Label className="text-xs">Model / spec text (verbatim)</Label>
              <Input
                value={it.parsedJson.modelText ?? ""}
                onChange={(e) => updateParsed(idx, { modelText: e.target.value || null })}
              />
            </div>

            <div className="space-y-1 md:col-span-2">
              <Label className="text-xs">Original request (raw)</Label>
              <Textarea
                value={it.rawText}
                onChange={(e) => update(idx, { rawText: e.target.value })}
                rows={2}
              />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
