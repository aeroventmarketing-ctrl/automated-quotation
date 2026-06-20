"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { formatCurrency } from "@/lib/utils";
import { upsertCatalogueItem, deleteCatalogueItem } from "../actions";

const FAMILIES = ["AXIAL", "CENTRIFUGAL", "PROPELLER", "TUBULAR_INLINE", "CABINET", "ACCESSORY", "SERVICE", "OTHER"];

interface Item {
  id: string;
  modelCode: string;
  family: string;
  name: string;
  description: string;
  sizeLabel: string;
  uom: string;
  active: boolean;
  specsJson: string;
  basePrice: number;
}

const blank: Item = {
  id: "",
  modelCode: "",
  family: "AXIAL",
  name: "",
  description: "",
  sizeLabel: "",
  uom: "unit",
  active: true,
  specsJson: "{}",
  basePrice: 0,
};

export function CatalogueManager({ items }: { items: Item[] }) {
  const router = useRouter();
  const [editing, setEditing] = useState<Item | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    if (!editing) return;
    setBusy(true);
    setError(null);
    try {
      await upsertCatalogueItem({
        id: editing.id || undefined,
        modelCode: editing.modelCode,
        family: editing.family as never,
        name: editing.name,
        description: editing.description,
        sizeLabel: editing.sizeLabel,
        uom: editing.uom,
        specsJson: editing.specsJson,
        active: editing.active,
        basePrice: editing.basePrice,
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
    if (!confirm("Delete this catalogue item? This also removes its prices and rating points.")) return;
    await deleteCatalogueItem(id);
    router.refresh();
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button onClick={() => setEditing({ ...blank })}>+ New catalogue item</Button>
      </div>

      {editing && (
        <Card className="border-primary/40">
          <CardHeader><CardTitle>{editing.id ? "Edit" : "New"} catalogue item</CardTitle></CardHeader>
          <CardContent className="grid gap-3 md:grid-cols-2">
            <div className="space-y-1">
              <Label>Model code *</Label>
              <Input value={editing.modelCode} onChange={(e) => setEditing({ ...editing, modelCode: e.target.value })} />
            </div>
            <div className="space-y-1">
              <Label>Family *</Label>
              <Select value={editing.family} onChange={(e) => setEditing({ ...editing, family: e.target.value })}>
                {FAMILIES.map((f) => (<option key={f} value={f}>{f}</option>))}
              </Select>
            </div>
            <div className="space-y-1 md:col-span-2">
              <Label>Name *</Label>
              <Input value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
            </div>
            <div className="space-y-1 md:col-span-2">
              <Label>Description</Label>
              <Textarea value={editing.description} onChange={(e) => setEditing({ ...editing, description: e.target.value })} rows={2} />
            </div>
            <div className="space-y-1">
              <Label>Size label</Label>
              <Input value={editing.sizeLabel} onChange={(e) => setEditing({ ...editing, sizeLabel: e.target.value })} />
            </div>
            <div className="space-y-1">
              <Label>UOM</Label>
              <Input value={editing.uom} onChange={(e) => setEditing({ ...editing, uom: e.target.value })} />
            </div>
            <div className="space-y-1">
              <Label>Base price (PHP)</Label>
              <Input type="number" step="0.01" value={editing.basePrice} onChange={(e) => setEditing({ ...editing, basePrice: Number(e.target.value) || 0 })} />
            </div>
            <div className="flex items-end gap-2">
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={editing.active} onChange={(e) => setEditing({ ...editing, active: e.target.checked })} />
                Active
              </label>
            </div>
            <div className="space-y-1 md:col-span-2">
              <Label>Specs (JSON)</Label>
              <Textarea className="font-mono text-xs" value={editing.specsJson} onChange={(e) => setEditing({ ...editing, specsJson: e.target.value })} rows={3} />
            </div>
            {error && <p className="text-sm text-destructive md:col-span-2">{error}</p>}
            <div className="flex gap-2 md:col-span-2">
              <Button onClick={save} disabled={busy}>{busy ? "Saving…" : "Save"}</Button>
              <Button variant="outline" onClick={() => setEditing(null)}>Cancel</Button>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="pt-6">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Model</TableHead>
                <TableHead>Family</TableHead>
                <TableHead>Name</TableHead>
                <TableHead className="text-right">Base price</TableHead>
                <TableHead></TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((it) => (
                <TableRow key={it.id}>
                  <TableCell className="font-medium">{it.modelCode}</TableCell>
                  <TableCell><Badge variant="secondary">{it.family}</Badge></TableCell>
                  <TableCell>{it.name}{!it.active && <span className="ml-2 text-xs text-muted-foreground">(inactive)</span>}</TableCell>
                  <TableCell className="text-right">{formatCurrency(it.basePrice)}</TableCell>
                  <TableCell><Button size="sm" variant="ghost" onClick={() => setEditing(it)}>Edit</Button></TableCell>
                  <TableCell><Button size="sm" variant="ghost" onClick={() => remove(it.id)}>Delete</Button></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
