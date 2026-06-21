"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { clearCatalogue } from "../actions";

const SPECS: Record<string, { cols: string; sample: string }> = {
  catalogue: {
    cols: "modelCode, family, name, description, sizeLabel, uom, basePrice, currency, specsJson",
    sample:
      'modelCode,family,name,description,sizeLabel,uom,basePrice,currency,specsJson\nAX-500-D,AXIAL,Axial Fan 500mm,Direct drive,500mm,unit,24500,PHP,"{""drive"":""direct""}"',
  },
  pricelist: {
    cols: "modelCode, variantKey, currency, basePrice, optionsJson, effectiveDate",
    sample:
      'modelCode,variantKey,currency,basePrice,optionsJson,effectiveDate\nAX-500-D,default,PHP,24500,"{""Epoxy coating"":2200}",2026-01-01',
  },
  ratings: {
    cols: "modelCode, rpm, airflow_m3hr, staticPressure_pa, power_kw, efficiency",
    sample:
      "modelCode,rpm,airflow_m3hr,staticPressure_pa,power_kw,efficiency\nAX-500-D,1440,0,300,1.0,0\nAX-500-D,1440,3000,250,1.6,0.62\nAX-500-D,1440,6000,120,2.0,0.5",
  },
};

interface Result {
  inserted: number;
  updated: number;
  errors: { row: number; message: string }[];
}

export default function ImportPage() {
  const router = useRouter();
  const [type, setType] = useState<keyof typeof SPECS>("catalogue");
  const [csv, setCsv] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [clearing, setClearing] = useState(false);
  const [cleared, setCleared] = useState<number | null>(null);

  async function clearAll() {
    if (
      !confirm(
        "Delete ALL catalogue items, their prices, and rating points?\n\nUse this to remove the sample/practice catalog before importing your own. Existing quotations keep their saved details. This cannot be undone.",
      )
    )
      return;
    setClearing(true);
    setError(null);
    setCleared(null);
    try {
      const count = await clearCatalogue();
      setCleared(count);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Clear failed");
    } finally {
      setClearing(false);
    }
  }

  async function run() {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/admin/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type, csv }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Import failed");
      setResult(data);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Import failed");
    } finally {
      setBusy(false);
    }
  }

  async function onFile(file: File) {
    setCsv(await file.text());
  }

  return (
    <div className="space-y-4">
      <Card className="border-destructive/40">
        <CardHeader><CardTitle className="text-destructive">Clear sample catalog</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Remove all catalogue items, prices, and rating points to start from a clean slate
            before importing your own catalog. Existing quotations are unaffected.
          </p>
          <Button variant="destructive" onClick={clearAll} disabled={clearing}>
            {clearing ? "Clearing…" : "Clear all catalogue data"}
          </Button>
          {cleared != null && (
            <p className="text-sm text-emerald-700">Cleared {cleared} catalogue item(s). Ready for import.</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Bulk import (CSV)</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1">
              <label className="text-sm font-medium">Data type</label>
              <Select value={type} onChange={(e) => setType(e.target.value as never)} className="w-48">
                <option value="catalogue">Catalogue</option>
                <option value="pricelist">Pricelist</option>
                <option value="ratings">Rating points</option>
              </Select>
            </div>
            <label className="flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm hover:bg-accent">
              Upload .csv
              <input
                type="file"
                accept=".csv,text/csv"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) onFile(f);
                }}
              />
            </label>
          </div>

          <div className="rounded-md bg-muted/50 p-3 text-xs">
            <div className="font-medium">Columns:</div>
            <code>{SPECS[type].cols}</code>
            <div className="mt-2 font-medium">Sample:</div>
            <pre className="whitespace-pre-wrap">{SPECS[type].sample}</pre>
            <Button
              size="sm"
              variant="outline"
              className="mt-2"
              onClick={() => setCsv(SPECS[type].sample)}
            >
              Load sample into editor
            </Button>
          </div>

          <Textarea
            className="font-mono text-xs"
            rows={10}
            value={csv}
            onChange={(e) => setCsv(e.target.value)}
            placeholder="Paste CSV here (first row = headers)…"
          />
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button onClick={run} disabled={busy || !csv.trim()}>{busy ? "Importing…" : "Run import"}</Button>
        </CardContent>
      </Card>

      {result && (
        <Card>
          <CardHeader><CardTitle>Result</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            <p className="text-emerald-700">Inserted: {result.inserted} · Updated: {result.updated}</p>
            {result.errors.length > 0 ? (
              <div>
                <p className="font-medium text-destructive">Errors ({result.errors.length}):</p>
                <ul className="list-inside list-disc text-destructive">
                  {result.errors.map((er, i) => (
                    <li key={i}>Row {er.row}: {er.message}</li>
                  ))}
                </ul>
              </div>
            ) : (
              <p className="text-muted-foreground">No row errors. 🎉</p>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
