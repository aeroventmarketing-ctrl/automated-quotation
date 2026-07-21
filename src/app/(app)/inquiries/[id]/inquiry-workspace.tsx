"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AiExtractPanel } from "@/components/intake/ai-extract-panel";
import type { DraftItem } from "@/components/intake/types";
import { addInquiryItems } from "../actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ConfidenceBadge } from "@/components/status-badge";
import { formatCurrency } from "@/lib/utils";
import { toDutyPoint } from "@/lib/requirement";
import { AIRFLOW_UNIT_LABELS, PRESSURE_UNIT_LABELS, normalizeAirflowUnit, normalizePressureUnit } from "@/lib/units";
import { Cog, AlertTriangle } from "lucide-react";
import type { SelectionResult } from "@/lib/selection";
import { isNextControlFlowError } from "@/lib/utils";
import { lookupMotor, computeUnitPrice } from "@/lib/pricing/motors";
import { createQuotationFromInquiry } from "../../quotations/actions";
import { inquiryDocsMissing } from "@/lib/inquiry-docs";
import type { SaleDoc } from "@/lib/sale";
import { InquiryDocsUploader } from "./inquiry-docs-uploader";

interface CatLite {
  id: string;
  modelCode: string;
  name: string;
  family: string;
  sizeLabel: string | null;
  uom: string;
  basePrice: number;
  currency: string;
  description: string | null;
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
  selectedCatalogueItemId: string | null;
  selectionResults: SelectionResult[] | null;
  chosen: SelectionResult | null;
  engineerConfirmed: boolean;
  loadingSelect: boolean;
  error: string | null;
  // Editable duty inputs (seeded from the parsed requirement).
  airflow: string;
  airflowUnit: string;
  staticPressure: string;
  pressureUnit: string;
}

const numOr = (v: unknown): string => (typeof v === "number" && Number.isFinite(v) ? String(v) : "");

function initState(p: Record<string, unknown>): ItemState {
  return {
    included: true,
    selectedCatalogueItemId: null,
    selectionResults: null,
    chosen: null,
    engineerConfirmed: false,
    loadingSelect: false,
    error: null,
    airflow: numOr(p.airflow),
    airflowUnit: normalizeAirflowUnit(p.airflowUnit as string | null | undefined) ?? "cfm",
    staticPressure: numOr(p.staticPressure),
    pressureUnit: normalizePressureUnit(p.pressureUnit as string | null | undefined) ?? "pa",
  };
}

export function InquiryWorkspace({
  inquiryId,
  projectName,
  items,
  catalogue,
  templates,
  initialDocs = {},
  canEditDocs = true,
}: {
  inquiryId: string;
  projectName: string;
  items: ItemLite[];
  catalogue: CatLite[];
  templates: { id: string; name: string }[];
  initialDocs?: Record<string, SaleDoc[]>;
  canEditDocs?: boolean;
}) {
  const [docs, setDocs] = useState<Record<string, SaleDoc[]>>(initialDocs);
  const docsMissing = inquiryDocsMissing(docs);
  const [state, setState] = useState<Record<string, ItemState>>(
    Object.fromEntries(items.map((it) => [it.id, initState(it.parsedJson)])),
  );
  const [templateId, setTemplateId] = useState(templates[0]?.id ?? "");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const router = useRouter();
  const [showImport, setShowImport] = useState(items.length === 0);
  const [importErr, setImportErr] = useState<string | null>(null);

  const catById = Object.fromEntries(catalogue.map((c) => [c.id, c]));

  // Add AI-extracted RFQ items to the inquiry, then reload so they appear below.
  async function addFromRfq(extracted: DraftItem[]) {
    setImportErr(null);
    if (extracted.length === 0) { setImportErr("No line items were found in that RFQ."); return; }
    try {
      await addInquiryItems(inquiryId, extracted.map((d) => ({ rawText: d.rawText, qty: d.qty, parsedJson: d.parsedJson as unknown as Record<string, unknown> })));
      setShowImport(false);
      router.refresh();
    } catch (e) {
      setImportErr(e instanceof Error ? e.message : "Could not add the items.");
    }
  }

  function patch(itemId: string, p: Partial<ItemState>) {
    setState((s) => ({ ...s, [itemId]: { ...s[itemId], ...p } }));
  }

  // Merge the editable duty inputs over the parsed requirement — this drives the
  // fan sizing (and the quote's stored requirement).
  function mergedReq(item: ItemLite): Record<string, unknown> {
    const st = state[item.id];
    const n = (s: string) => (s.trim() === "" ? null : Number(s.replace(/,/g, "")) || null);
    return {
      ...item.parsedJson,
      airflow: n(st.airflow),
      airflowUnit: st.airflowUnit,
      staticPressure: n(st.staticPressure),
      pressureUnit: st.pressureUnit,
    };
  }

  async function runSelect(item: ItemLite) {
    patch(item.id, { loadingSelect: true, error: null });
    try {
      const res = await fetch("/api/selection", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requirement: mergedReq(item) }),
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
      .filter((it) => state[it.id].included)
      .map((it) => {
        const st = state[it.id];
        const req = mergedReq(it);
        const cat = st.selectedCatalogueItemId ? catById[st.selectedCatalogueItemId] : null;
        if (cat) {
          const sizeStr = cat.sizeLabel ? ` (${cat.sizeLabel})` : "";
          return {
            catalogueItemId: cat.id,
            // Prefer the catalogue's full standard description (with its Model: line).
            descriptionSnapshot: cat.description || `${cat.modelCode} — ${cat.name}${sizeStr}`,
            specsSnapshot: {
              requirement: req,
              selection: st.chosen ?? null,
              blowerModel: cat.modelCode,
              bodyPrice: cat.basePrice,
              // Pre-fill the engine's suggested motor HP (engineer picks phase/volts).
              ...(st.chosen ? { motorHp: st.chosen.motorHp } : {}),
            } as Record<string, unknown>,
            qty: it.qty,
            selectionNote: st.chosen?.selectionNote ?? null,
          };
        }
        // No model chosen — carry the requirement through as a manual line (the
        // engineer fills the model & price on the quotation).
        return {
          catalogueItemId: null,
          descriptionSnapshot: (it.rawText && it.rawText.trim()) || String((it.parsedJson.description as string | undefined) ?? "Custom item"),
          specsSnapshot: { requirement: req } as Record<string, unknown>,
          qty: it.qty,
          selectionNote: null,
        };
      });

    if (lines.length === 0) {
      setCreateError("Include at least one item to create the quotation.");
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
      await createQuotationFromInquiry({ inquiryId, templateId: templateId || undefined, projectName: projectName || undefined, vatMode: "INCLUSIVE", discountPct: 0, lines });
    } catch (e) {
      if (isNextControlFlowError(e)) throw e; // let the redirect navigate
      setCreateError(e instanceof Error ? e.message : "Failed to create quotation");
      setCreating(false);
    }
  }

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold">Requirements → Match → Select</h2>

      {/* Generate items from an RFQ — upload a photo/scan or paste text; AI extracts the line items. */}
      <Card>
        <CardHeader className="flex-row items-center justify-between gap-3 pb-2">
          <div>
            <CardTitle className="text-sm">Import from RFQ (AI)</CardTitle>
            <p className="text-xs text-muted-foreground">Upload a photo/scan of the RFQ (or paste its text) and AI turns it into line items you can size and quote.</p>
          </div>
          <Button variant="outline" size="sm" onClick={() => setShowImport((v) => !v)}>
            {showImport ? "Hide" : "Upload RFQ / paste text"}
          </Button>
        </CardHeader>
        {showImport && (
          <CardContent className="pt-0">
            <AiExtractPanel onExtracted={addFromRfq} />
            {importErr && <p className="mt-2 text-sm text-destructive">{importErr}</p>}
          </CardContent>
        )}
      </Card>

      {items.length === 0 && !showImport && (
        <p className="text-sm text-muted-foreground">No line items yet — use “Import from RFQ (AI)” above or add them from the inquiry.</p>
      )}

      {items.map((item) => {
        const st = state[item.id];
        const p = item.parsedJson as Record<string, unknown>;
        const duty = toDutyPoint(mergedReq(item) as never);
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
                {p.application != null && <Badge variant="outline">{String(p.application)}</Badge>}
                {duty && (
                  <Badge variant="secondary">
                    = {Math.round(duty.airflow_m3hr)} m³/hr @ {Math.round(duty.staticPressure_pa)} Pa
                  </Badge>
                )}
              </div>

              {st.error && <p className="text-sm text-destructive">{st.error}</p>}

              <div>
                {/* Fan sizing — enter the duty (volume flow + static pressure) and run selection. */}
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">Fan sizing</span>
                    <Button size="sm" variant="outline" onClick={() => runSelect(item)} disabled={st.loadingSelect || !duty}>
                      <Cog className="h-3.5 w-3.5" />
                      {st.loadingSelect ? "Sizing…" : "Run selection"}
                    </Button>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2">
                    <label className="space-y-1 text-xs text-muted-foreground">
                      <span>Volume flow</span>
                      <div className="flex gap-2">
                        <Input className="h-9" type="number" step="any" min={0} inputMode="decimal" placeholder="0"
                          value={st.airflow} onChange={(e) => patch(item.id, { airflow: e.target.value })} />
                        <Select className="h-9 w-28" value={st.airflowUnit} onChange={(e) => patch(item.id, { airflowUnit: e.target.value })}>
                          {(Object.entries(AIRFLOW_UNIT_LABELS) as [string, string][]).map(([k, label]) => (
                            <option key={k} value={k}>{label}</option>
                          ))}
                        </Select>
                      </div>
                    </label>
                    <label className="space-y-1 text-xs text-muted-foreground">
                      <span>Static pressure</span>
                      <div className="flex gap-2">
                        <Input className="h-9" type="number" step="any" min={0} inputMode="decimal" placeholder="0"
                          value={st.staticPressure} onChange={(e) => patch(item.id, { staticPressure: e.target.value })} />
                        <Select className="h-9 w-28" value={st.pressureUnit} onChange={(e) => patch(item.id, { pressureUnit: e.target.value })}>
                          {(Object.entries(PRESSURE_UNIT_LABELS) as [string, string][]).map(([k, label]) => (
                            <option key={k} value={k}>{label}</option>
                          ))}
                        </Select>
                      </div>
                    </label>
                  </div>

                  {!duty && (
                    <p className="text-xs text-muted-foreground">
                      Enter both volume flow and static pressure to size a fan — or leave them and proceed; the engineer completes the model on the quotation.
                    </p>
                  )}
                  {st.selectionResults?.length === 0 && (
                    <p className="text-xs text-muted-foreground">No rated models match this duty.</p>
                  )}
                  {st.selectionResults?.slice(0, 6).map((sel) => {
                    // Estimated net price for performance-vs-price comparison
                    // (body + suggested motor at 3-phase / 4-pole, +10% if applicable).
                    const body = catById[sel.modelId]?.basePrice ?? 0;
                    const motor = lookupMotor(sel.motorHp, 3, 4);
                    const estNet = body > 0 ? computeUnitPrice(body, motor?.price ?? 0, sel.motorHp, 3) : 0;
                    return (
                    <button
                      key={sel.modelId}
                      onClick={() => chooseSelection(item, sel)}
                      className={`w-full rounded-md border p-2 text-left text-xs hover:bg-accent ${
                        st.chosen?.modelId === sel.modelId ? "border-primary bg-accent" : ""
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-medium">{sel.modelCode}</span>
                        <span className="flex items-center gap-2">
                          {estNet > 0 && <span className="font-medium text-foreground">≈ {formatCurrency(estNet)}</span>}
                          <ConfidenceBadge confidence={sel.confidence} />
                        </span>
                      </div>
                      <p className="text-muted-foreground">
                        {sel.rpm} rpm · {sel.bhp} BHP → {sel.motorHp} HP motor
                        {sel.outletVelocity_fpm != null
                          ? ` · OV ${sel.outletVelocity_fpm}/${sel.ovLimit_fpm} fpm`
                          : ""}
                      </p>
                      {sel.warnings.length > 0 && (
                        <p className="mt-1 flex items-start gap-1 text-amber-600">
                          <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                          {sel.warnings[0]}
                        </p>
                      )}
                    </button>
                    );
                  })}

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

      {/* Required documents before a quotation can be made */}
      <InquiryDocsUploader inquiryId={inquiryId} docs={docs} onChange={setDocs} canEdit={canEditDocs} />

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
            {docsMissing.length > 0 && <span className="text-sm text-amber-600">Attach {docsMissing.join(" and ")} first</span>}
            {createError && <span className="text-sm text-destructive">{createError}</span>}
            <Button onClick={createQuote} disabled={creating || docsMissing.length > 0}>
              {creating ? "Creating…" : "Create draft quotation"}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
