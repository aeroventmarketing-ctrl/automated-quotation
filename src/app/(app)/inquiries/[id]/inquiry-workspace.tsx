"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ConfidenceBadge } from "@/components/status-badge";
import { formatCurrency } from "@/lib/utils";
import { toDutyPoint } from "@/lib/requirement";
import { Sparkles, Cog, AlertTriangle } from "lucide-react";
import type { SelectionResult } from "@/lib/selection";
import type { MatchCandidate } from "@/lib/ai/schemas";
import { createQuotationFromInquiry } from "../../quotations/actions";

interface CatLite {
  id: string;
  modelCode: string;
  name: string;
  family: string;
  sizeLabel: string | null;
  uom: string;
  basePrice: number;
  currency: string;
}
interface ItemLite {
  id: string;
  rawText: string;
  qty: number;
  parsedJson: Record<string, unknown>;
  status: string;
}
interface ItemState {
  included: boolean;
  matchCandidates: MatchCandidate[] | null;
  selectedCatalogueItemId: string | null;
  selectionResults: SelectionResult[] | null;
  chosen: SelectionResult | null;
  engineerConfirmed: boolean;
  loadingMatch: boolean;
  loadingSelect: boolean;
  error: string | null;
}

function initState(): ItemState {
  return {
    included: true,
    matchCandidates: null,
    selectedCatalogueItemId: null,
    selectionResults: null,
    chosen: null,
    engineerConfirmed: false,
    loadingMatch: false,
    loadingSelect: false,
    error: null,
  };
}

export function InquiryWorkspace({
  inquiryId,
  items,
  catalogue,
  templates,
}: {
  inquiryId: string;
  items: ItemLite[];
  catalogue: CatLite[];
  templates: { id: string; name: string }[];
}) {
  const [state, setState] = useState<Record<string, ItemState>>(
    Object.fromEntries(items.map((it) => [it.id, initState()])),
  );
  const [templateId, setTemplateId] = useState(templates[0]?.id ?? "");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const catById = Object.fromEntries(catalogue.map((c) => [c.id, c]));

  function patch(itemId: string, p: Partial<ItemState>) {
    setState((s) => ({ ...s, [itemId]: { ...s[itemId], ...p } }));
  }

  async function runMatch(item: ItemLite) {
    patch(item.id, { loadingMatch: true, error: null });
    try {
      const res = await fetch("/api/ai/match", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requirement: item.parsedJson }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Match failed");
      patch(item.id, { matchCandidates: data.candidates ?? [] });
    } catch (e) {
      patch(item.id, { error: e instanceof Error ? e.message : "Match failed" });
    } finally {
      patch(item.id, { loadingMatch: false });
    }
  }

  async function runSelect(item: ItemLite) {
    patch(item.id, { loadingSelect: true, error: null });
    try {
      const res = await fetch("/api/selection", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requirement: item.parsedJson }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Selection failed");
      patch(item.id, { selectionResults: data.results ?? [] });
    } catch (e) {
      patch(item.id, { error: e instanceof Error ? e.message : "Selection failed" });
    } finally {
      patch(item.id, { loadingSelect: false });
    }
  }

  function chooseSelection(item: ItemLite, sel: SelectionResult) {
    patch(item.id, {
      chosen: sel,
      selectedCatalogueItemId: sel.modelId,
      engineerConfirmed: false,
    });
  }

  async function createQuote() {
    setCreateError(null);
    const lines = items
      .filter((it) => state[it.id].included && state[it.id].selectedCatalogueItemId)
      .map((it) => {
        const st = state[it.id];
        const cat = catById[st.selectedCatalogueItemId!];
        const sizeStr = cat.sizeLabel ? ` (${cat.sizeLabel})` : "";
        return {
          catalogueItemId: cat.id,
          descriptionSnapshot: `${cat.modelCode} — ${cat.name}${sizeStr}`,
          specsSnapshot: {
            requirement: it.parsedJson,
            selection: st.chosen ?? null,
          } as Record<string, unknown>,
          qty: it.qty,
          selectionNote: st.chosen?.selectionNote ?? null,
        };
      });

    if (lines.length === 0) {
      setCreateError("Pick a catalogue model for at least one included item.");
      return;
    }
    // Block low-confidence selections that an engineer hasn't confirmed.
    const unconfirmed = items.filter(
      (it) =>
        state[it.id].included &&
        state[it.id].chosen?.requiresEngineerConfirmation &&
        !state[it.id].engineerConfirmed,
    );
    if (unconfirmed.length > 0) {
      setCreateError(
        "One or more selections are outside the rated envelope and need an engineer to confirm before quoting.",
      );
      return;
    }

    setCreating(true);
    try {
      await createQuotationFromInquiry({ inquiryId, templateId: templateId || undefined, lines });
    } catch (e) {
      setCreateError(e instanceof Error ? e.message : "Failed to create quotation");
      setCreating(false);
    }
  }

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold">Requirements → Match → Select</h2>

      {items.map((item) => {
        const st = state[item.id];
        const p = item.parsedJson as Record<string, unknown>;
        const duty = toDutyPoint(p as never);
        const selectedCat = st.selectedCatalogueItemId ? catById[st.selectedCatalogueItemId] : null;

        return (
          <Card key={item.id}>
            <CardHeader className="pb-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <CardTitle className="text-base">
                    {(p.description as string) || item.rawText.slice(0, 60)}
                  </CardTitle>
                  <p className="mt-1 text-xs text-muted-foreground">{item.rawText}</p>
                </div>
                <label className="flex items-center gap-2 text-xs">
                  <input
                    type="checkbox"
                    checked={st.included}
                    onChange={(e) => patch(item.id, { included: e.target.checked })}
                  />
                  Include in quote
                </label>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Parsed requirement + SI preview */}
              <div className="flex flex-wrap gap-2 text-xs">
                <Badge variant="outline">Qty: {item.qty}</Badge>
                {p.airflow != null && (
                  <Badge variant="outline">
                    Airflow: {String(p.airflow)} {String(p.airflowUnit ?? "")}
                  </Badge>
                )}
                {p.staticPressure != null && (
                  <Badge variant="outline">
                    SP: {String(p.staticPressure)} {String(p.pressureUnit ?? "")}
                  </Badge>
                )}
                {p.application != null && <Badge variant="outline">{String(p.application)}</Badge>}
                {duty && (
                  <Badge variant="secondary">
                    = {Math.round(duty.airflow_m3hr)} m³/hr @ {Math.round(duty.staticPressure_pa)} Pa
                  </Badge>
                )}
              </div>

              {st.error && <p className="text-sm text-destructive">{st.error}</p>}

              <div className="grid gap-4 md:grid-cols-2">
                {/* Catalogue matching */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">1. Catalogue match</span>
                    <Button size="sm" variant="outline" onClick={() => runMatch(item)} disabled={st.loadingMatch}>
                      <Sparkles className="h-3.5 w-3.5" />
                      {st.loadingMatch ? "Matching…" : "AI match"}
                    </Button>
                  </div>
                  {st.matchCandidates?.map((c) => {
                    const cat = catById[c.catalogueItemId];
                    if (!cat) return null;
                    return (
                      <button
                        key={c.catalogueItemId}
                        onClick={() => patch(item.id, { selectedCatalogueItemId: c.catalogueItemId })}
                        className={`w-full rounded-md border p-2 text-left text-xs hover:bg-accent ${
                          st.selectedCatalogueItemId === c.catalogueItemId ? "border-primary bg-accent" : ""
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-medium">{cat.modelCode} — {cat.name}</span>
                          <Badge variant="secondary">{Math.round(c.confidence * 100)}%</Badge>
                        </div>
                        <p className="text-muted-foreground">{c.reason}</p>
                      </button>
                    );
                  })}
                  <div className="space-y-1">
                    <span className="text-xs text-muted-foreground">Or pick manually:</span>
                    <Select
                      value={st.selectedCatalogueItemId ?? ""}
                      onChange={(e) => patch(item.id, { selectedCatalogueItemId: e.target.value || null })}
                    >
                      <option value="">— select catalogue item —</option>
                      {catalogue.map((c) => (
                        <option key={c.id} value={c.id}>{c.modelCode} — {c.name}</option>
                      ))}
                    </Select>
                  </div>
                </div>

                {/* Fan selection */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">2. Fan sizing</span>
                    <Button size="sm" variant="outline" onClick={() => runSelect(item)} disabled={st.loadingSelect || !duty}>
                      <Cog className="h-3.5 w-3.5" />
                      {st.loadingSelect ? "Sizing…" : "Run selection"}
                    </Button>
                  </div>
                  {!duty && (
                    <p className="text-xs text-muted-foreground">
                      Needs both airflow and static pressure to size a fan.
                    </p>
                  )}
                  {st.selectionResults?.length === 0 && (
                    <p className="text-xs text-muted-foreground">No rated models match this duty.</p>
                  )}
                  {st.selectionResults?.slice(0, 4).map((sel) => (
                    <button
                      key={sel.modelId}
                      onClick={() => chooseSelection(item, sel)}
                      className={`w-full rounded-md border p-2 text-left text-xs hover:bg-accent ${
                        st.chosen?.modelId === sel.modelId ? "border-primary bg-accent" : ""
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-medium">{sel.modelCode}</span>
                        <ConfidenceBadge confidence={sel.confidence} />
                      </div>
                      <p className="text-muted-foreground">
                        {sel.rpm} rpm · {sel.motorKw} kW ({sel.motorHp} HP)
                        {sel.efficiency != null ? ` · ${Math.round(sel.efficiency * 100)}% eff` : ""}
                      </p>
                      {sel.warnings.length > 0 && (
                        <p className="mt-1 flex items-start gap-1 text-amber-600">
                          <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                          {sel.warnings[0]}
                        </p>
                      )}
                    </button>
                  ))}

                  {st.chosen?.requiresEngineerConfirmation && (
                    <label className="flex items-start gap-2 rounded-md bg-amber-50 p-2 text-xs text-amber-800">
                      <input
                        type="checkbox"
                        checked={st.engineerConfirmed}
                        onChange={(e) => patch(item.id, { engineerConfirmed: e.target.checked })}
                      />
                      <span>
                        This selection is outside the rated envelope. An engineer must confirm before
                        it can be quoted.
                      </span>
                    </label>
                  )}
                </div>
              </div>

              {selectedCat && (
                <div className="rounded-md bg-muted/50 p-2 text-xs">
                  Selected: <strong>{selectedCat.modelCode}</strong> — {selectedCat.name} ·
                  list price {formatCurrency(selectedCat.basePrice, selectedCat.currency)} / {selectedCat.uom}
                </div>
              )}
            </CardContent>
          </Card>
        );
      })}

      {/* Create quotation */}
      <Card className="border-primary/40">
        <CardContent className="flex flex-wrap items-center justify-between gap-3 pt-6">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium">Template:</span>
            <Select value={templateId} onChange={(e) => setTemplateId(e.target.value)} className="w-56">
              {templates.map((t) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </Select>
          </div>
          <div className="flex items-center gap-3">
            {createError && <span className="text-sm text-destructive">{createError}</span>}
            <Button onClick={createQuote} disabled={creating}>
              {creating ? "Creating…" : "Create draft quotation"}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
