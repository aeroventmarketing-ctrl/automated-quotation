"use client";

import { useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Card, CardContent } from "@/components/ui/card";

/**
 * Duct Material Calculator — estimates how many sheets are consumed fabricating a
 * duct piece, from its developed (flat-pattern) area.
 *
 * Method (auto-selected by material — it sets the longitudinal seam allowance):
 *   - Galvanized Iron            → Lockformer + TDF flanged forming (Pittsburgh
 *                                   lock seam, wider allowance)
 *   - Black Iron / Stainless     → Welding (lap/butt weld, smaller allowance)
 *
 * Per-piece developed area (real inches; 1 in = 25.4 mm):
 *   Straight (rect)   A = (2(W+H) + seam) · L
 *   Straight (round)  A = (πD + seam) · L
 *   Connector (rect)  A = (2(W+H) + seam) · Lc          (short collar length)
 *   Reducer (rect)    A = ((P₁+P₂)/2 + seam) · slant     slant = √(L² + max offset²)
 *   Square→Round      A = ((2(W+H)+πD)/2 + seam) · slant
 *   Elbow 90° (rect)  A = (2(W+H) + seam) · arc          arc = (π/2)·(throatR + W/2)
 *   Offset (rect)     A = (2(W+H) + seam) · √(L² + offset²)
 * Transitions/elbows use a centreline/average-perimeter approximation — good for
 * material estimating; confirm the allowances against your shop's practice.
 */

const MM_PER_IN = 25.4;
const num = (s: string): number | null => {
  if (!s.trim()) return null;
  const n = Number(s);
  return Number.isFinite(n) && n > 0 ? n : null;
};
const r = (n: number, d = 2) => Math.round(n * 10 ** d) / 10 ** d;

type DuctType =
  | "straight_rect"
  | "straight_round"
  | "connector"
  | "reducer"
  | "sq2round"
  | "elbow90"
  | "offset"
  | "y_duct";

const DUCT_TYPES: { value: DuctType; label: string }[] = [
  { value: "straight_rect", label: "Straight Duct — Rectangular" },
  { value: "straight_round", label: "Straight Duct — Round" },
  { value: "connector", label: "Duct Connector (collar)" },
  { value: "reducer", label: "Reducer / Transition (Rect→Rect)" },
  { value: "sq2round", label: "Square to Round" },
  { value: "elbow90", label: "Elbow 90° — Rectangular" },
  { value: "offset", label: "Offset — Rectangular" },
  { value: "y_duct", label: "Y-Duct — two branches (45°)" },
];

const MATERIALS = ["Galvanized Iron", "Black Iron", "Stainless Steel"] as const;
type Material = (typeof MATERIALS)[number];
const methodFor = (m: Material) =>
  m === "Galvanized Iron" ? "Lockformer + TDF flanged forming" : "Welding";
const seamDefaultFor = (m: Material) => (m === "Galvanized Iron" ? 2 : 1); // in, added to perimeter

export function DuctSheetCalculator() {
  const [ductType, setDuctType] = useState<DuctType>("straight_rect");
  const [unit, setUnit] = useState<"in" | "mm">("in");
  const [material, setMaterial] = useState<Material>("Galvanized Iron");
  const [qty, setQty] = useState("1");
  const [seam, setSeam] = useState(String(seamDefaultFor("Galvanized Iron")));
  const [waste, setWaste] = useState("0");
  const [sheetW, setSheetW] = useState("48");
  const [sheetL, setSheetL] = useState("96");

  // Dimension inputs (interpreted per duct type, in the chosen unit).
  const [w, setW] = useState("");
  const [h, setH] = useState("");
  const [l, setL] = useState("");
  const [d, setD] = useState("");
  const [w2, setW2] = useState("");
  const [h2, setH2] = useState("");
  const [offset, setOffset] = useState("");
  const [throat, setThroat] = useState("");
  const [lb, setLb] = useState(""); // Y-Duct branch length

  const method = methodFor(material);

  function onMaterial(m: Material) {
    setMaterial(m);
    setSeam(String(seamDefaultFor(m))); // reset the seam allowance to the method default
  }

  const result = useMemo(() => {
    const toIn = (v: number) => (unit === "mm" ? v / MM_PER_IN : v);
    const seamIn = Number(seam) || 0;
    const q = Math.max(1, Math.floor(Number(qty) || 1));
    const wf = Math.min(0.9, Math.max(0, (Number(waste) || 0) / 100));
    const sW = num(sheetW);
    const sL = num(sheetL);
    if (sW == null || sL == null) return null;
    const usableIn2 = sW * sL * (1 - wf); // sheet dims already in inches

    // Developed area (in²) of one piece, by type.
    let area: number | null = null;
    let detail = "";
    const W = num(w), H = num(h), L = num(l), D = num(d), W2 = num(w2), H2 = num(h2);
    const OFF = num(offset), TH = num(throat), LB = num(lb);

    if (ductType === "straight_rect" || ductType === "connector") {
      if (W == null || H == null || L == null) return null;
      const P = 2 * (toIn(W) + toIn(H));
      area = (P + seamIn) * toIn(L);
      detail = `perimeter ${r(P)} in × length ${r(toIn(L))} in`;
    } else if (ductType === "straight_round") {
      if (D == null || L == null) return null;
      const C = Math.PI * toIn(D);
      area = (C + seamIn) * toIn(L);
      detail = `circumference ${r(C)} in × length ${r(toIn(L))} in`;
    } else if (ductType === "reducer") {
      if (W == null || H == null || W2 == null || H2 == null || L == null) return null;
      const P1 = 2 * (toIn(W) + toIn(H));
      const P2 = 2 * (toIn(W2) + toIn(H2));
      const maxOff = Math.max(Math.abs(toIn(W) - toIn(W2)), Math.abs(toIn(H) - toIn(H2))) / 2;
      const slant = Math.sqrt(toIn(L) ** 2 + maxOff ** 2);
      area = ((P1 + P2) / 2 + seamIn) * slant;
      detail = `avg perimeter ${r((P1 + P2) / 2)} in × slant ${r(slant)} in`;
    } else if (ductType === "sq2round") {
      if (W == null || H == null || D == null || L == null) return null;
      const Pr = 2 * (toIn(W) + toIn(H));
      const Cc = Math.PI * toIn(D);
      const off = Math.max(toIn(W), toIn(H)) / 2;
      const slant = Math.sqrt(toIn(L) ** 2 + off ** 2);
      area = ((Pr + Cc) / 2 + seamIn) * slant;
      detail = `avg perimeter ${r((Pr + Cc) / 2)} in × slant ${r(slant)} in`;
    } else if (ductType === "elbow90") {
      if (W == null || H == null) return null;
      const P = 2 * (toIn(W) + toIn(H));
      const throatR = TH != null ? toIn(TH) : toIn(W); // default throat radius = W
      const arc = (Math.PI / 2) * (throatR + toIn(W) / 2); // 90° centreline arc
      area = (P + seamIn) * arc;
      detail = `perimeter ${r(P)} in × arc ${r(arc)} in (R throat ${r(throatR)} in)`;
    } else if (ductType === "offset") {
      if (W == null || H == null || L == null || OFF == null) return null;
      const P = 2 * (toIn(W) + toIn(H));
      const path = Math.sqrt(toIn(L) ** 2 + toIn(OFF) ** 2);
      area = (P + seamIn) * path;
      detail = `perimeter ${r(P)} in × path ${r(path)} in`;
    } else if (ductType === "y_duct") {
      // Two-branch rectangular Y (45°): sum of the main run + two branch runs, as
      // developed straight panels. Crotch overlap is not deducted (conservative).
      if (W == null || H == null || L == null || W2 == null || H2 == null || LB == null) return null;
      const Pmain = 2 * (toIn(W) + toIn(H));
      const Pbr = 2 * (toIn(W2) + toIn(H2));
      const mainA = (Pmain + seamIn) * toIn(L);
      const brA = (Pbr + seamIn) * toIn(LB);
      area = mainA + 2 * brA;
      detail = `main ${r(mainA / 144)} ft² + 2 × branch ${r(brA / 144)} ft²`;
    }
    if (area == null || !Number.isFinite(area) || area <= 0) return null;

    const totalArea = area * q;
    const sheetsFrac = totalArea / usableIn2;
    return {
      perPieceIn2: area,
      perPieceFt2: area / 144,
      totalFt2: totalArea / 144,
      sheetsFrac,
      sheetsToBuy: Math.ceil(sheetsFrac - 1e-9),
      detail,
      qty: q,
    };
  }, [ductType, unit, qty, seam, waste, sheetW, sheetL, w, h, l, d, w2, h2, offset, throat, lb]);

  const dimUnit = unit;

  return (
    <Card>
      <CardContent className="space-y-4 pt-6">
        {/* Row 1: type, material (→ method), unit, qty */}
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1">
            <Label>Duct type / transition</Label>
            <Select className="w-60" value={ductType} onChange={(e) => setDuctType(e.target.value as DuctType)}>
              {DUCT_TYPES.map((t) => (<option key={t.value} value={t.value}>{t.label}</option>))}
            </Select>
          </div>
          <div className="space-y-1">
            <Label>Material</Label>
            <Select className="w-44" value={material} onChange={(e) => onMaterial(e.target.value as Material)}>
              {MATERIALS.map((m) => (<option key={m} value={m}>{m}</option>))}
            </Select>
          </div>
          <div className="space-y-1">
            <Label>Unit</Label>
            <Select className="w-24" value={unit} onChange={(e) => setUnit(e.target.value as "in" | "mm")}>
              <option value="in">in</option>
              <option value="mm">mm</option>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>Quantity</Label>
            <Input className="w-24" type="number" step="1" min="1" value={qty} onChange={(e) => setQty(e.target.value)} />
          </div>
        </div>

        <p className="text-xs text-muted-foreground">
          Joining method: <b>{method}</b> ({material}). This sets the seam allowance below.
        </p>

        {/* Row 2: dimensions (per type) */}
        <div className="flex flex-wrap items-end gap-3">
          {(ductType === "straight_rect" || ductType === "connector" || ductType === "elbow90" || ductType === "offset") && (
            <>
              <Dim label={`Width A (${dimUnit})`} value={w} onChange={setW} />
              <Dim label={`Height B (${dimUnit})`} value={h} onChange={setH} />
            </>
          )}
          {ductType === "straight_round" && <Dim label={`Diameter Ø (${dimUnit})`} value={d} onChange={setD} />}
          {ductType === "reducer" && (
            <>
              <Dim label={`Large W (${dimUnit})`} value={w} onChange={setW} />
              <Dim label={`Large H (${dimUnit})`} value={h} onChange={setH} />
              <Dim label={`Small W (${dimUnit})`} value={w2} onChange={setW2} />
              <Dim label={`Small H (${dimUnit})`} value={h2} onChange={setH2} />
            </>
          )}
          {ductType === "sq2round" && (
            <>
              <Dim label={`Rect W (${dimUnit})`} value={w} onChange={setW} />
              <Dim label={`Rect H (${dimUnit})`} value={h} onChange={setH} />
              <Dim label={`Round Ø (${dimUnit})`} value={d} onChange={setD} />
            </>
          )}
          {(ductType === "straight_rect" || ductType === "straight_round" || ductType === "connector" || ductType === "reducer" || ductType === "sq2round" || ductType === "offset") && (
            <Dim label={ductType === "connector" ? `Collar length (${dimUnit})` : `Length (${dimUnit})`} value={l} onChange={setL} />
          )}
          {ductType === "offset" && <Dim label={`Offset (${dimUnit})`} value={offset} onChange={setOffset} />}
          {ductType === "elbow90" && <Dim label={`Throat radius (${dimUnit}, blank = W)`} value={throat} onChange={setThroat} wide />}
          {ductType === "y_duct" && (
            <>
              <Dim label={`Main W (${dimUnit})`} value={w} onChange={setW} />
              <Dim label={`Main H (${dimUnit})`} value={h} onChange={setH} />
              <Dim label={`Main length (${dimUnit})`} value={l} onChange={setL} />
              <Dim label={`Branch W (${dimUnit})`} value={w2} onChange={setW2} />
              <Dim label={`Branch H (${dimUnit})`} value={h2} onChange={setH2} />
              <Dim label={`Branch length (${dimUnit})`} value={lb} onChange={setLb} />
            </>
          )}
        </div>

        {/* Row 3: allowances */}
        <div className="flex flex-wrap items-end gap-3 border-t pt-3">
          <Dim label="Seam allowance (in)" value={seam} onChange={setSeam} />
          <Dim label="Waste (%)" value={waste} onChange={setWaste} />
          <Dim label="Sheet width (in)" value={sheetW} onChange={setSheetW} />
          <Dim label="Sheet length (in)" value={sheetL} onChange={setSheetL} />
        </div>

        {result ? (
          <>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Stat label="Developed / piece" value={`${r(result.perPieceFt2, 2)} ft²`} sub={`${Math.round(result.perPieceIn2)} in²`} />
              <Stat label={`Total (${result.qty} pc)`} value={`${r(result.totalFt2, 2)} ft²`} sub="developed area" />
              <Stat label="Sheets used" value={r(result.sheetsFrac, 3).toLocaleString()} sub="fractional" />
              <Stat label="Sheets to buy" value={String(result.sheetsToBuy)} sub="rounded up (whole sheets)" />
            </div>
            <p className="text-xs text-muted-foreground">{result.detail}. One sheet = {sheetW} × {sheetL} in.</p>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">Enter the dimensions to compute the sheets consumed.</p>
        )}
      </CardContent>
    </Card>
  );
}

function Dim({ label, value, onChange, wide }: { label: string; value: string; onChange: (v: string) => void; wide?: boolean }) {
  return (
    <div className="space-y-1">
      <Label>{label}</Label>
      <Input className={wide ? "w-52" : "w-32"} type="number" step="any" value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="rounded-md border p-2">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="font-semibold">{value}</div>
      <div className="text-xs text-muted-foreground">{sub}</div>
    </div>
  );
}
