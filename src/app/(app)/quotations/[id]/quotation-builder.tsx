"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { QuotationStatusBadge } from "@/components/status-badge";
import { formatCurrency } from "@/lib/utils";
import { config } from "@/lib/config";
import {
  lookupMotor,
  motorModelCode,
  computeUnitPrice,
  combinedModel,
  hpOptions,
  dynamicBalancingApplies,
  type Voltage,
} from "@/lib/pricing/motors";
import { Download, Send, Check, CornerUpLeft, Trash2, Gauge, Plus } from "lucide-react";
import { PRODUCT_CATEGORIES, typesFor, entryFor } from "@/lib/product-taxonomy";
import { ConfidenceBadge } from "@/components/status-badge";
import type { SelectionResult } from "@/lib/selection";
import { updateQuotationLines, transitionQuotation } from "../actions";

interface CatalogEntry {
  modelCode: string;
  description: string;
  basePrice: number;
  bladeDia: number | null;
}

interface LineSpecs {
  itemLabel: string;
  capacity_cfm: number | null;
  staticPressure_pa: number | null;
  inches: number | null;
  motorHp: number | null;
  motorPh: number | null;
  motorVolts: number | null;
  motorPole: number | null;
  bodyPrice: number | null; // net blower-body price (before motor / VAT)
  blowerModel: string | null; // base catalogue model code, e.g. AV1225CEB
}
interface Line {
  id: string;
  descriptionSnapshot: string;
  qty: number;
  unitPrice: number; // VAT-inclusive
  lineTotal: number;
  selectionNote: string | null;
  specs: LineSpecs;
  rawSpecs: Record<string, unknown>;
}
interface Quote {
  id: string;
  quoteNumber: string;
  status: "DRAFT" | "PENDING_APPROVAL" | "APPROVED" | "SENT";
  currency: string;
  vatMode: "INCLUSIVE" | "EXCLUSIVE";
  discountPct: number;
  headerUnits: { capacity: string; pressure: string; motor: string };
  classification: { category: string; type: string; bladeType: string; drive: string; shape: string; sizeL: string; sizeW: string };
  projectName: string;
  subtotal: number;
  vat: number;
  total: number;
  notes: string | null;
  terms: string | null;
  validUntil: string;
  templateId: string;
  templateName: string;
  customer: string;
  preparedBy: string;
  approvedBy: string | null;
  items: Line[];
}

const numOrNull = (v: string): number | null => (v === "" ? null : Number(v) || 0);
const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;
const voltageKey = (v: number | null): Voltage => (v === 220 ? "220" : v === 440 ? "440" : "380");
/** Replace the "Model:" value in a standard description (no-op if absent). */
function rewriteModelLine(desc: string, combined: string): string {
  if (!combined || !/Model:\s*/i.test(desc)) return desc;
  return desc.replace(/(Model:\s*)([^\n]*)/i, `$1${combined}`);
}

/** Unit options for the quote table headers (from the English & Metric chart). */
const CAPACITY_UNITS = ["cfm", "m³/hr", "m³/min", "m³/sec", "l/s", "l/min"];
const PRESSURE_UNITS = ["in-w.g.", "mm-w.g.", "Pa", "in-Hg", "mm-Hg", "psi", "atm"];
const POWER_UNITS = ["HP", "kW", "W"];

/** Shape / variant options for a Ventilation Accessory type. */
function shapesFor(type: string): string[] {
  if (type === "Bar Grille") return ["Rectangle"];
  if (type === "Jet Nozzle Diffuser" || type === "Vent Cap" || type === "Wind Driven Roof Ventilator") return ["Round"];
  if (type === "Spring Vibration Isolator") return ["Foot Mounted", "Ceiling Mounted"];
  return ["Round", "Square"];
}

/** Label for the variant dropdown (mounting for isolators, otherwise shape). */
function variantLabel(type: string): string {
  return type === "Spring Vibration Isolator" ? "Mounting" : "Shape";
}

/** What the size field(s) mean for this accessory. */
function sizeMode(type: string, shape: string): "capacity" | "diameter" | "lw" {
  if (type === "Spring Vibration Isolator") return "capacity";
  if (shape === "Round") return "diameter";
  return "lw";
}

function selSize(r: SelectionResult): number {
  if (r.sizeLabel) {
    const n = parseFloat(r.sizeLabel);
    if (!Number.isNaN(n)) return n;
  }
  const m = r.modelCode.match(/(\d{3,5})/);
  return m ? parseInt(m[1], 10) / 100 : 0;
}

/** 3 sizes smaller + the recommended (top HIGH) + 3 bigger, in size order. */
function sizeWindow(results: SelectionResult[]): { rec: SelectionResult; list: SelectionResult[] } | null {
  if (results.length === 0) return null;
  const rec = results.find((r) => r.confidence === "HIGH") ?? results[0];
  const bySize = [...results].sort((a, b) => selSize(a) - selSize(b));
  const idx = bySize.findIndex((r) => r.modelId === rec.modelId);
  return { rec, list: bySize.slice(Math.max(0, idx - 3), idx + 4) };
}

export function QuotationBuilder({
  quotation,
  templates,
  canApprove,
  catalog,
}: {
  quotation: Quote;
  templates: { id: string; name: string }[];
  canApprove: boolean;
  catalog: Record<string, CatalogEntry>;
}) {
  const router = useRouter();
  const editable = quotation.status === "DRAFT";

  const [lines, setLines] = useState<Line[]>(quotation.items);
  const [templateId, setTemplateId] = useState(quotation.templateId);
  const [projectName, setProjectName] = useState(quotation.projectName);
  const [vatMode, setVatMode] = useState(quotation.vatMode);
  const [discountPct, setDiscountPct] = useState(quotation.discountPct);
  const [units, setUnits] = useState(quotation.headerUnits);
  const [cls, setCls] = useState(quotation.classification);
  const [notes, setNotes] = useState(quotation.notes ?? "");
  const [terms, setTerms] = useState(quotation.terms ?? "");
  const [validUntil, setValidUntil] = useState(quotation.validUntil);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  // Per-line fan-selector state, keyed by line id.
  const [sel, setSel] = useState<Record<string, { loading: boolean; error: string | null; results: SelectionResult[] | null }>>({});

  const vatRate = config.vatRate;
  const totals = useMemo(() => {
    const gross = lines.reduce((a, l) => a + l.qty * l.unitPrice, 0); // VAT-inclusive
    const net = gross / (1 + vatRate);
    const displayedNet = vatMode === "EXCLUSIVE" ? net : gross;
    const discountAmt = displayedNet * (discountPct / 100);
    return { net, vat: gross - net, gross, displayedNet, discountAmt, finalNet: displayedNet - discountAmt };
  }, [lines, vatRate, vatMode, discountPct]);

  function updateLine(id: string, patch: Partial<Line>) {
    setLines((ls) => ls.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  }
  function updateSpec(id: string, patch: Partial<LineSpecs>) {
    setLines((ls) => ls.map((l) => (l.id === id ? { ...l, specs: { ...l.specs, ...patch } } : l)));
  }

  // Add a line item (saved on "Save changes"; available while DRAFT). Clones the
  // last item with all its details so the new line has the full layout filled in.
  function addLine() {
    const id = `new-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    setLines((ls) => {
      const base = ls[ls.length - 1];
      if (base) {
        return [
          ...ls,
          {
            ...base,
            id,
            selectionNote: base.selectionNote,
            specs: { ...base.specs },
            rawSpecs: { ...base.rawSpecs },
          },
        ];
      }
      return [
        {
          id,
          descriptionSnapshot: "",
          qty: 1,
          unitPrice: 0,
          lineTotal: 0,
          selectionNote: null,
          specs: {
            itemLabel: "", capacity_cfm: null, staticPressure_pa: null, inches: null,
            motorHp: null, motorPh: null, motorVolts: null, motorPole: null,
            bodyPrice: null, blowerModel: null,
          },
          rawSpecs: {},
        },
      ];
    });
  }
  function removeLine(id: string) {
    setLines((ls) => ls.filter((l) => l.id !== id));
    setSel((s) => {
      const { [id]: _drop, ...rest } = s;
      return rest;
    });
  }

  // Body + motor calculator: recompute the (VAT-inclusive) unit price and the
  // combined blower+motor model in the description whenever a motor input changes.
  function applyMotor(id: string, patch: Partial<LineSpecs>) {
    setLines((ls) =>
      ls.map((l) => {
        if (l.id !== id) return l;
        const specs = { ...l.specs, ...patch };
        // 1-phase motors are 220V only — snap voltage so the model code resolves.
        if (specs.motorPh === 1) specs.motorVolts = 220;
        const body = specs.bodyPrice ?? 0;
        const hp = specs.motorHp ?? 0;
        const phase = specs.motorPh ?? 0;
        const pole = specs.motorPole ?? 4;
        // Only auto-price true blower lines (those with a body price).
        if (body <= 0) return { ...l, specs };
        const motor = hp && phase ? lookupMotor(hp, phase, pole) : undefined;
        const net = computeUnitPrice(body, motor?.price ?? 0, hp, phase);
        const gross = round2(net * (1 + vatRate));
        const mModel = motor ? motorModelCode(motor, voltageKey(specs.motorVolts)) : null;
        const combined = combinedModel(specs.blowerModel ?? "", mModel);
        const descriptionSnapshot = specs.blowerModel
          ? rewriteModelLine(l.descriptionSnapshot, combined)
          : l.descriptionSnapshot;
        return { ...l, specs, unitPrice: gross, descriptionSnapshot };
      }),
    );
  }

  // Run the fan selector for a line using its Capacity (CFM) + S.P. (in-w.g.).
  async function runLineSelection(line: Line) {
    const cfm = line.specs.capacity_cfm;
    const sp = line.specs.staticPressure_pa; // stored value is in in-w.g.
    if (!cfm || !sp) {
      setSel((s) => ({ ...s, [line.id]: { loading: false, error: "Enter Capacity (CFM) and S.P. (in-w.g.) first.", results: null } }));
      return;
    }
    setSel((s) => ({ ...s, [line.id]: { loading: true, error: null, results: null } }));
    try {
      const res = await fetch("/api/selection", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          requirement: { airflow: cfm, airflowUnit: "cfm", staticPressure: sp, pressureUnit: "inwg" },
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Selection failed");
      setSel((s) => ({ ...s, [line.id]: { loading: false, error: null, results: data.results ?? [] } }));
    } catch (e) {
      setSel((s) => ({ ...s, [line.id]: { loading: false, error: e instanceof Error ? e.message : "Selection failed", results: null } }));
    }
  }

  // Apply a chosen candidate to a line: fill description, size, body price,
  // base model and suggested motor HP, then recompute the price/model.
  function applyCandidate(lineId: string, r: SelectionResult) {
    const cat = catalog[r.modelId];
    setLines((ls) =>
      ls.map((l) => {
        if (l.id !== lineId) return l;
        const specs: LineSpecs = {
          ...l.specs,
          bodyPrice: cat?.basePrice ?? l.specs.bodyPrice,
          blowerModel: cat?.modelCode ?? l.specs.blowerModel,
          inches: cat?.bladeDia ?? l.specs.inches,
          motorHp: r.motorHp,
        };
        const baseDesc = cat?.description || l.descriptionSnapshot;
        const body = specs.bodyPrice ?? 0;
        const hp = specs.motorHp ?? 0;
        const phase = specs.motorPh ?? 0;
        const pole = specs.motorPole ?? 4;
        const motor = hp && phase ? lookupMotor(hp, phase, pole) : undefined;
        const net = computeUnitPrice(body, motor?.price ?? 0, hp, phase);
        const gross = round2(net * (1 + vatRate));
        const mModel = motor ? motorModelCode(motor, voltageKey(specs.motorVolts)) : null;
        const combined = combinedModel(specs.blowerModel ?? "", mModel);
        return { ...l, specs, unitPrice: gross, descriptionSnapshot: rewriteModelLine(baseDesc, combined) };
      }),
    );
    // Collapse the candidate list once a blower is chosen.
    setSel((s) => ({ ...s, [lineId]: { loading: false, error: null, results: null } }));
  }

  async function save() {
    setBusy(true);
    setMsg(null);
    try {
      await updateQuotationLines(
        quotation.id,
        lines.map((l) => ({
          id: l.id,
          descriptionSnapshot: l.descriptionSnapshot,
          qty: l.qty,
          unitPrice: l.unitPrice,
          selectionNote: l.selectionNote,
          // merge edited flat specs back over anything nested (selection/requirement)
          specsSnapshot: { ...l.rawSpecs, ...l.specs },
        })),
        { templateId, notes, terms, validUntil: validUntil || undefined, projectName, vatMode, discountPct, headerUnits: units, classification: cls },
      );
      setMsg("Saved.");
      router.refresh();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Save failed");
    } finally {
      setBusy(false);
    }
  }

  async function transition(to: string) {
    setBusy(true);
    setMsg(null);
    try {
      await transitionQuotation(quotation.id, to);
      router.refresh();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Action failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold">QUOT NO. {quotation.quoteNumber}</h1>
          <p className="text-sm text-muted-foreground">
            {quotation.customer} · prepared by {quotation.preparedBy}
            {quotation.approvedBy ? ` · approved by ${quotation.approvedBy}` : ""}
          </p>
        </div>
        <QuotationStatusBadge status={quotation.status} />
      </div>

      {/* Workflow + exports */}
      <Card>
        <CardContent className="flex flex-wrap items-center gap-2 pt-6">
          {quotation.status === "DRAFT" && (
            <Button onClick={() => transition("PENDING_APPROVAL")} disabled={busy}>
              <Send className="h-4 w-4" /> Submit for approval
            </Button>
          )}
          {quotation.status === "PENDING_APPROVAL" && (
            <>
              <Button onClick={() => transition("APPROVED")} disabled={busy || !canApprove}>
                <Check className="h-4 w-4" /> Approve
              </Button>
              <Button variant="outline" onClick={() => transition("DRAFT")} disabled={busy}>
                <CornerUpLeft className="h-4 w-4" /> Return to draft
              </Button>
              {!canApprove && <span className="text-xs text-muted-foreground">Approval requires Engineer/Admin.</span>}
            </>
          )}
          {quotation.status === "APPROVED" && (
            <Button onClick={() => transition("SENT")} disabled={busy}>
              <Send className="h-4 w-4" /> Mark as sent
            </Button>
          )}
          <div className="ml-auto flex gap-2">
            <Button asChild>
              <a href={`/api/quotations/${quotation.id}/excel`}>
                <Download className="h-4 w-4" /> Download Excel
              </a>
            </Button>
            <Button variant="outline" asChild>
              <a href={`/api/quotations/${quotation.id}/pdf`} target="_blank" rel="noopener noreferrer">
                <Download className="h-4 w-4" /> PDF
              </a>
            </Button>
          </div>
        </CardContent>
      </Card>

      {msg && <p className="text-sm text-muted-foreground">{msg}</p>}

      {/* Header fields */}
      <Card>
        <CardHeader><CardTitle>Quotation header</CardTitle></CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-3">
          <div className="space-y-1 md:col-span-3">
            <Label>Project</Label>
            <Input value={projectName} onChange={(e) => setProjectName(e.target.value)} disabled={!editable} placeholder="e.g. DG Engineering & Construction Services" />
          </div>
          <div className="space-y-1 md:col-span-3">
            <Label>Table unit labels (red, editable per client)</Label>
            <div className="grid grid-cols-3 gap-2">
              <Select value={units.capacity} disabled={!editable}
                onChange={(e) => setUnits({ ...units, capacity: e.target.value })}>
                <option value="" disabled hidden>Volume Flow</option>
                {(units.capacity && !CAPACITY_UNITS.includes(units.capacity) ? [units.capacity, ...CAPACITY_UNITS] : CAPACITY_UNITS).map((u) => (
                  <option key={u} value={u}>{u}</option>
                ))}
              </Select>
              <Select value={units.pressure} disabled={!editable}
                onChange={(e) => setUnits({ ...units, pressure: e.target.value })}>
                <option value="" disabled hidden>Static Pressure</option>
                {(units.pressure && !PRESSURE_UNITS.includes(units.pressure) ? [units.pressure, ...PRESSURE_UNITS] : PRESSURE_UNITS).map((u) => (
                  <option key={u} value={u}>{u}</option>
                ))}
              </Select>
              <Select value={units.motor} disabled={!editable}
                onChange={(e) => setUnits({ ...units, motor: e.target.value })}>
                <option value="" disabled hidden>Motor Power</option>
                {(units.motor && !POWER_UNITS.includes(units.motor) ? [units.motor, ...POWER_UNITS] : POWER_UNITS).map((u) => (
                  <option key={u} value={u}>{u}</option>
                ))}
              </Select>
            </div>
          </div>
          {/* Discount (left) and VAT presentation (right), inline */}
          <div className="grid gap-4 md:col-span-3 md:grid-cols-2">
            <div className="space-y-1">
              <Label>Discount %</Label>
              <Input type="number" step="0.01" min={0} max={100} value={discountPct} disabled={!editable}
                onChange={(e) => setDiscountPct(Number(e.target.value) || 0)} />
            </div>
            <div className="space-y-1">
              <Label>VAT presentation</Label>
              <Select value={vatMode} onChange={(e) => setVatMode(e.target.value as never)} disabled={!editable}>
                <option value="INCLUSIVE">VAT inclusive</option>
                <option value="EXCLUSIVE">VAT exclusive (÷1.12)</option>
              </Select>
            </div>
          </div>
          <div className="space-y-1">
            <Label>Template (pattern)</Label>
            <Select value={templateId} onChange={(e) => setTemplateId(e.target.value)} disabled={!editable}>
              {templates.map((t) => (<option key={t.id} value={t.id}>{t.name}</option>))}
            </Select>
          </div>
          <div className="space-y-1">
            <Label>Valid until</Label>
            <Input type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} disabled={!editable} />
          </div>
        </CardContent>
      </Card>

      {/* Line items */}
      <Card>
        <CardHeader><CardTitle>Line items</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {/* Product selection workflow: Category → Type → Blade Type → Drive */}
          <div className="space-y-1 rounded-md border p-3">
            <Label>Product selection</Label>
            <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
              <Select
                value={cls.category}
                disabled={!editable}
                onChange={(e) => setCls({ category: e.target.value, type: "", bladeType: "", drive: "", shape: "", sizeL: "", sizeW: "" })}
              >
                <option value="">Category…</option>
                {PRODUCT_CATEGORIES.map((c) => (<option key={c} value={c}>{c}</option>))}
              </Select>
              <Select
                value={cls.type}
                disabled={!editable || !cls.category}
                onChange={(e) => setCls({ ...cls, type: e.target.value, bladeType: "", drive: "", shape: "", sizeL: "", sizeW: "" })}
              >
                <option value="">Type…</option>
                {typesFor(cls.category).map((t) => (<option key={t} value={t}>{t}</option>))}
              </Select>
              {cls.category === "Ventilation Accessories" ? (
                <>
                  <Select
                    value={cls.shape}
                    disabled={!editable || !cls.type}
                    onChange={(e) => setCls({ ...cls, shape: e.target.value })}
                  >
                    <option value="">{variantLabel(cls.type)}…</option>
                    {shapesFor(cls.type).map((s) => (<option key={s} value={s}>{s}</option>))}
                  </Select>
                  {sizeMode(cls.type, cls.shape) === "capacity" ? (
                    <Input
                      className="h-9"
                      type="number"
                      step="any"
                      placeholder="Capacity (kg)"
                      disabled={!editable || !cls.type}
                      value={cls.sizeL}
                      onChange={(e) => setCls({ ...cls, sizeL: e.target.value, sizeW: "" })}
                    />
                  ) : sizeMode(cls.type, cls.shape) === "diameter" ? (
                    <Input
                      className="h-9"
                      type="number"
                      step="any"
                      placeholder="Diameter Ø (mm)"
                      disabled={!editable || !cls.type}
                      value={cls.sizeL}
                      onChange={(e) => setCls({ ...cls, sizeL: e.target.value, sizeW: "" })}
                    />
                  ) : (
                    <>
                      <Input
                        className="h-9"
                        type="number"
                        step="any"
                        placeholder="L (mm)"
                        disabled={!editable || !cls.type}
                        value={cls.sizeL}
                        onChange={(e) => setCls({ ...cls, sizeL: e.target.value })}
                      />
                      <Input
                        className="h-9"
                        type="number"
                        step="any"
                        placeholder="W (mm)"
                        disabled={!editable || !cls.type}
                        value={cls.sizeW}
                        onChange={(e) => setCls({ ...cls, sizeW: e.target.value })}
                      />
                    </>
                  )}
                </>
              ) : (
                <>
                  <Select
                    value={cls.bladeType}
                    disabled={!editable || !cls.type}
                    onChange={(e) => setCls({ ...cls, bladeType: e.target.value })}
                  >
                    <option value="">Blade type…</option>
                    {(entryFor(cls.category, cls.type)?.bladeTypes ?? []).map((b) => (<option key={b} value={b}>{b}</option>))}
                  </Select>
                  <Select
                    value={cls.drive}
                    disabled={!editable || !cls.type}
                    onChange={(e) => setCls({ ...cls, drive: e.target.value })}
                  >
                    <option value="">Drive…</option>
                    {(entryFor(cls.category, cls.type)?.drives ?? []).map((d) => (<option key={d} value={d}>{d}</option>))}
                  </Select>
                </>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              {cls.category === "Ventilation Accessories"
                ? "Category · Type · Shape/Mounting · Size — Round = diameter, Square/Rectangle = L × W (mm), isolator = capacity (kg)."
                : "Product Category · Type · Blade Type · Drive (more details to follow)."}
            </p>
          </div>
          {lines.map((l, idx) => (
            <div key={l.id} className="rounded-lg border p-3">
              {editable && (
                <div className="mb-1 flex items-center justify-between">
                  <span className="text-xs font-medium text-muted-foreground">Item {idx + 1}</span>
                  <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive"
                    onClick={() => removeLine(l.id)}>
                    <Trash2 className="h-4 w-4" /> Remove
                  </Button>
                </div>
              )}
              <div className="grid gap-2 md:grid-cols-12">
                <div className="md:col-span-1">
                  <Label className="text-[10px]">Item</Label>
                  <Input className="h-8" value={l.specs.itemLabel} placeholder={String(idx + 1)} disabled={!editable}
                    onChange={(e) => updateSpec(l.id, { itemLabel: e.target.value })} />
                </div>
                <div className="md:col-span-9">
                  <Label className="text-[10px]">Description (one detail per line)</Label>
                  {editable ? (
                    <Textarea rows={3} value={l.descriptionSnapshot}
                      onChange={(e) => updateLine(l.id, { descriptionSnapshot: e.target.value })} />
                  ) : (
                    <div className="whitespace-pre-wrap text-sm">{l.descriptionSnapshot}</div>
                  )}
                </div>
                <div className="md:col-span-1">
                  <Label className="text-[10px]">Qty</Label>
                  <Input className="h-8 text-right" type="number" min={1} value={l.qty} disabled={!editable}
                    onChange={(e) => updateLine(l.id, { qty: Math.max(1, Number(e.target.value) || 1) })} />
                </div>
                <div className="md:col-span-1">
                  <Label className="text-[10px]">Unit ₱ (incl. VAT)</Label>
                  <Input className="h-8 text-right" type="number" step="0.01" value={l.unitPrice} disabled={!editable}
                    onChange={(e) => updateLine(l.id, { unitPrice: Number(e.target.value) || 0 })} />
                </div>
              </div>

              {/* Table specs (shown in the quote's Capacity / S.P. / Size columns) */}
              <div className="mt-2 grid grid-cols-3 gap-2">
                {([
                  ["capacity_cfm", "Capacity (CFM)"],
                  ["staticPressure_pa", "S.P. (in-w.g.)"],
                  ["inches", "Size (in)"],
                ] as const).map(([key, label]) => (
                  <div key={key}>
                    <Label className="text-[10px]">{label}</Label>
                    <Input className="h-8 text-right" type="number" step="any" disabled={!editable}
                      value={l.specs[key] ?? ""}
                      onChange={(e) => updateSpec(l.id, { [key]: numOrNull(e.target.value) } as Partial<LineSpecs>)} />
                  </div>
                ))}
              </div>

              {/* Per-line fan selector — click a candidate to populate this item */}
              {editable && (
                <div className="mt-2 rounded-md border border-dashed p-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium text-muted-foreground">
                      Fan selector — uses Capacity + S.P. above
                    </span>
                    <Button size="sm" variant="outline" onClick={() => runLineSelection(l)} disabled={sel[l.id]?.loading}>
                      <Gauge className="h-3.5 w-3.5" /> {sel[l.id]?.loading ? "Selecting…" : "Run selection"}
                    </Button>
                  </div>
                  {sel[l.id]?.error && <p className="mt-1 text-xs text-destructive">{sel[l.id]?.error}</p>}
                  {sel[l.id]?.results?.length === 0 && (
                    <p className="mt-1 text-xs text-muted-foreground">No matching fans for this duty.</p>
                  )}
                  {(() => {
                    const w = sel[l.id]?.results ? sizeWindow(sel[l.id]!.results!) : null;
                    if (!w) return null;
                    return (
                      <div className="mt-2 space-y-1">
                        {w.list.map((r) => {
                          const cat = catalog[r.modelId];
                          const motor = lookupMotor(r.motorHp, 3, 4);
                          const est = cat?.basePrice ? round2(computeUnitPrice(cat.basePrice, motor?.price ?? 0, r.motorHp, 3) * (1 + vatRate)) : 0;
                          const isRec = r.modelId === w.rec.modelId;
                          return (
                            <button
                              key={r.modelId}
                              type="button"
                              onClick={() => applyCandidate(l.id, r)}
                              className={`w-full rounded-md border p-2 text-left text-xs hover:bg-accent ${isRec ? "border-primary ring-1 ring-primary" : ""}`}
                            >
                              <div className="flex items-center justify-between">
                                <span className="font-medium">
                                  {r.modelCode}
                                  {isRec && <span className="ml-2 rounded bg-primary px-1.5 py-0.5 text-[10px] font-semibold text-primary-foreground">RECOMMENDED</span>}
                                </span>
                                <span className="flex items-center gap-2">
                                  {est > 0 && <span className="font-medium">≈ {formatCurrency(est, quotation.currency)}</span>}
                                  <ConfidenceBadge confidence={r.confidence} />
                                </span>
                              </div>
                              <p className="text-muted-foreground">
                                {r.rpm} rpm · {r.bhp} BHP → {r.motorHp} HP
                                {r.outletVelocity_fpm != null ? ` · OV ${r.outletVelocity_fpm}/${r.ovLimit_fpm} fpm` : ""}
                              </p>
                            </button>
                          );
                        })}
                      </div>
                    );
                  })()}
                </div>
              )}

              {/* Motor + price calculator */}
              <div className="mt-2 grid grid-cols-2 gap-2 md:grid-cols-6">
                <div>
                  <Label className="text-[10px]">Body ₱ (net)</Label>
                  <Input className="h-8 text-right" type="number" step="0.01" disabled={!editable}
                    value={l.specs.bodyPrice ?? ""}
                    onChange={(e) => applyMotor(l.id, { bodyPrice: numOrNull(e.target.value) })} />
                </div>
                <div>
                  <Label className="text-[10px]">Phase</Label>
                  <Select className="h-8" disabled={!editable} value={l.specs.motorPh ?? ""}
                    onChange={(e) => applyMotor(l.id, { motorPh: numOrNull(e.target.value) })}>
                    <option value="">—</option>
                    <option value="1">1-phase</option>
                    <option value="3">3-phase</option>
                  </Select>
                </div>
                <div>
                  <Label className="text-[10px]">Pole</Label>
                  <Select className="h-8" disabled={!editable} value={l.specs.motorPole ?? 4}
                    onChange={(e) => applyMotor(l.id, { motorPole: numOrNull(e.target.value) })}>
                    <option value="4">4-pole</option>
                    <option value="2">2-pole</option>
                  </Select>
                </div>
                <div>
                  <Label className="text-[10px]">Motor HP</Label>
                  <Select className="h-8" disabled={!editable} value={l.specs.motorHp ?? ""}
                    onChange={(e) => applyMotor(l.id, { motorHp: numOrNull(e.target.value) })}>
                    <option value="">—</option>
                    {hpOptions(l.specs.motorPh ?? 3, l.specs.motorPole ?? 4).map((hp) => (
                      <option key={hp} value={hp}>{hp} HP</option>
                    ))}
                  </Select>
                </div>
                <div>
                  <Label className="text-[10px]">Volts</Label>
                  <Select className="h-8" disabled={!editable} value={l.specs.motorVolts ?? ""}
                    onChange={(e) => applyMotor(l.id, { motorVolts: numOrNull(e.target.value) })}>
                    {l.specs.motorPh === 1 ? (
                      <option value="220">220</option>
                    ) : (
                      <>
                        <option value="">—</option>
                        <option value="220">220</option>
                        <option value="380">380</option>
                        <option value="400">400</option>
                        <option value="440">440</option>
                      </>
                    )}
                  </Select>
                </div>
                <div>
                  <Label className="text-[10px]">Unit ₱ (incl. VAT)</Label>
                  <Input className="h-8 text-right" type="number" step="0.01" value={l.unitPrice} disabled={!editable}
                    onChange={(e) => updateLine(l.id, { unitPrice: Number(e.target.value) || 0 })} />
                </div>
              </div>

              {/* Calculator readout */}
              {(() => {
                const hp = l.specs.motorHp ?? 0;
                const ph = l.specs.motorPh ?? 0;
                const pole = l.specs.motorPole ?? 4;
                const motor = hp && ph ? lookupMotor(hp, ph, pole) : undefined;
                const mModel = motor ? motorModelCode(motor, voltageKey(l.specs.motorVolts)) : null;
                const db = dynamicBalancingApplies(hp, ph);
                const isBlower = !!(l.specs.bodyPrice && l.specs.bodyPrice > 0);
                return (
                  <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
                    {isBlower &&
                      (hp && ph ? (
                        motor ? (
                          <>
                            <span>Motor {mModel ?? "—"}: {formatCurrency(motor.price, quotation.currency)}</span>
                            {db && <span className="text-amber-600">+10% dynamic balancing (3-ph &gt; 10 HP)</span>}
                            {l.specs.blowerModel && <span>Model: <b>{combinedModel(l.specs.blowerModel, mModel)}</b></span>}
                          </>
                        ) : (
                          <span className="text-destructive">No motor priced for {hp} HP / {ph}-ph / {pole}-pole</span>
                        )
                      ) : (
                        <span>Body only — pick HP &amp; phase to add a motor</span>
                      ))}
                    <span className="ml-auto text-foreground">
                      Amount: <b>{formatCurrency(l.qty * l.unitPrice, quotation.currency)}</b>
                    </span>
                  </div>
                );
              })()}
            </div>
          ))}

          {editable && (
            <Button variant="outline" onClick={addLine}>
              <Plus className="h-4 w-4" /> Add item
            </Button>
          )}

          {/* Totals */}
          <div className="flex justify-end">
            <div className="w-80 space-y-1 text-sm">
              <div className="flex justify-between">
                <span>NET AMOUNT (VAT {vatMode === "EXCLUSIVE" ? "exclusive" : "inclusive"})</span>
                <span>{formatCurrency(totals.displayedNet, quotation.currency)}</span>
              </div>
              {discountPct > 0 && (
                <>
                  <div className="flex justify-between"><span>LESS {discountPct}% DISCOUNT</span><span>{formatCurrency(totals.discountAmt, quotation.currency)}</span></div>
                  <div className="flex justify-between border-t pt-1 text-base font-bold"><span>NET AMOUNT</span><span>{formatCurrency(totals.finalNet, quotation.currency)}</span></div>
                </>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Notes + terms */}
      <Card>
        <CardHeader><CardTitle>Spec note &amp; terms</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1">
            <Label>Spec note (shown under the table)</Label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} disabled={!editable} rows={2}
              placeholder="e.g. All units are made of high quality materials. Statically and Dynamically balanced…" />
          </div>
          <div className="space-y-1">
            <Label>Terms &amp; Conditions (page 2) — defaults from the selected pattern</Label>
            <Textarea className="font-mono text-xs" value={terms} onChange={(e) => setTerms(e.target.value)} disabled={!editable} rows={10} />
          </div>
        </CardContent>
      </Card>

      {editable && (
        <Button onClick={save} disabled={busy} size="lg">{busy ? "Saving…" : "Save changes"}</Button>
      )}
    </div>
  );
}
