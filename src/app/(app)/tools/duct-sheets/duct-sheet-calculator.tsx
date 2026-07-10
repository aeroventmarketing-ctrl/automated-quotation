"use client";

import { useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Card, CardContent } from "@/components/ui/card";

/**
 * Duct Material Calculator — estimates the sheets consumed fabricating a duct
 * piece by (a) developing each piece into flat blank rectangles and (b) actually
 * NESTING those blanks onto a 4 ft × 8 ft (48 × 96 in) sheet with a first-fit
 * shelf packer (each blank tried in both orientations). The area-based estimate
 * is shown alongside as a sanity check.
 *
 * Joining method (auto by material) sets the longitudinal seam allowance added to
 * each blank's wrap dimension:
 *   - Galvanized Iron         → Lockformer + TDF flanged forming (2 in)
 *   - Black Iron / Stainless  → Welding (1 in)
 *
 * Blanks per piece (real inches; 1 in = 25.4 mm):
 *   Straight/Connector (wrap) 1 × (2(W+H)+seam) × L
 *                     (L-halves) 2 × (W+H+seam) × L
 *                     (4 sides) 2 × (W+seam)×L, 2 × (H+seam)×L
 *   Round             1 × (πD+seam) × L
 *   Reducer           2 × (max(W₁,W₂)+seam)×slant, 2 × (max(H₁,H₂)+seam)×slant
 *   Square→Round      1 × ((2(W+H)+πD)/2 + seam) × slant
 *   Elbow 90°         1 × (2(W+H)+seam) × arc      arc = (π/2)(throatR + W/2)
 *   Offset            1 × (2(W+H)+seam) × √(L²+offset²)
 *   Y-Duct            main (2(W+H)+seam)×L + 2 × branch (2(Wb+Hb)+seam)×Lb
 * Fitting blanks use the developed pattern's bounding strip — good for estimating
 * sheet counts; confirm the allowances/cut method against your shop's practice.
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

const RECT_WRAP_TYPES = new Set<DuctType>(["straight_rect", "connector"]);

const MATERIALS = ["Galvanized Iron", "Black Iron", "Stainless Steel"] as const;
type Material = (typeof MATERIALS)[number];
const methodFor = (m: Material) =>
  m === "Galvanized Iron" ? "Lockformer + TDF flanged forming" : "Welding";
const seamDefaultFor = (m: Material) => (m === "Galvanized Iron" ? 2 : 1); // in, added to the wrap

type Cut = "wrap" | "lhalf" | "sides";
type Blank = { w: number; l: number }; // one flat rectangle to cut (inches)

/** Shelf (guillotine) packing of blanks onto SW×SL sheets; both orientations tried. */
function packSheets(blanks: Blank[], SW: number, SL: number) {
  let usedArea = 0;
  let oversized = 0;
  const items: { across: number; along: number }[] = [];
  for (const b of blanks) {
    usedArea += b.w * b.l;
    const s = Math.min(b.w, b.l);
    const L = Math.max(b.w, b.l);
    if (s <= SW && L <= SL) items.push({ across: s, along: L });
    else if (b.w <= SW && b.l <= SL) items.push({ across: b.w, along: b.l });
    else if (b.l <= SW && b.w <= SL) items.push({ across: b.l, along: b.w });
    else oversized++; // won't fit on one sheet in any orientation → must be split/seamed
  }
  items.sort((a, b) => b.across - a.across); // first-fit decreasing by shelf height
  const sheets: { shelves: { h: number; used: number }[]; freeH: number }[] = [];
  for (const it of items) {
    let placed = false;
    for (const sh of sheets) {
      for (const shelf of sh.shelves) {
        if (it.across <= shelf.h && shelf.used + it.along <= SL) {
          shelf.used += it.along;
          placed = true;
          break;
        }
      }
      if (placed) break;
      if (sh.freeH >= it.across) {
        sh.shelves.push({ h: it.across, used: it.along });
        sh.freeH -= it.across;
        placed = true;
        break;
      }
    }
    if (!placed) sheets.push({ shelves: [{ h: it.across, used: it.along }], freeH: SW - it.across });
  }
  const packed = sheets.length;
  const total = packed + oversized;
  const utilization = packed > 0 ? usedArea / (packed * SW * SL) : 0;
  return { total, packed, oversized, utilization, usedArea };
}

// Nesting/offcut waste default per type (%) for the AREA estimate only.
const WASTE_DEFAULT: Record<DuctType, number> = {
  straight_rect: 8, straight_round: 10, connector: 8, reducer: 15,
  sq2round: 15, elbow90: 20, offset: 15, y_duct: 20,
};

export function DuctSheetCalculator() {
  const [ductType, setDuctType] = useState<DuctType>("straight_rect");
  const [unit, setUnit] = useState<"in" | "mm">("in");
  const [material, setMaterial] = useState<Material>("Galvanized Iron");
  const [cut, setCut] = useState<Cut>("wrap");
  const [qty, setQty] = useState("1");
  const [seam, setSeam] = useState(String(seamDefaultFor("Galvanized Iron")));
  const [waste, setWaste] = useState(String(WASTE_DEFAULT.straight_rect));
  const [sheetW, setSheetW] = useState("48");
  const [sheetL, setSheetL] = useState("96");

  const [w, setW] = useState("");
  const [h, setH] = useState("");
  const [l, setL] = useState("");
  const [d, setD] = useState("");
  const [w2, setW2] = useState("");
  const [h2, setH2] = useState("");
  const [offset, setOffset] = useState("");
  const [throat, setThroat] = useState("");
  const [lb, setLb] = useState("");

  const method = methodFor(material);
  const showCut = RECT_WRAP_TYPES.has(ductType);

  function onMaterial(m: Material) {
    setMaterial(m);
    setSeam(String(seamDefaultFor(m)));
  }
  function onDuctType(t: DuctType) {
    setDuctType(t);
    setWaste(String(WASTE_DEFAULT[t]));
  }

  const result = useMemo(() => {
    const toIn = (v: number) => (unit === "mm" ? v / MM_PER_IN : v);
    const seamIn = Number(seam) || 0;
    const q = Math.max(1, Math.floor(Number(qty) || 1));
    const wf = Math.min(0.9, Math.max(0, (Number(waste) || 0) / 100));
    const SW = num(sheetW);
    const SL = num(sheetL);
    if (SW == null || SL == null) return null;

    const P = (a: number, b: number) => 2 * (a + b);
    const W = num(w), H = num(h), L = num(l), D = num(d), W2 = num(w2), H2 = num(h2);
    const OFF = num(offset), TH = num(throat), LB = num(lb);

    // Build the flat blank rectangles for ONE piece.
    let blanks: Blank[] | null = null;
    let detail = "";
    if (ductType === "straight_rect" || ductType === "connector") {
      if (W == null || H == null || L == null) return null;
      const a = toIn(W), b = toIn(H), len = toIn(L);
      if (cut === "wrap") blanks = [{ w: P(a, b) + seamIn, l: len }];
      else if (cut === "lhalf") blanks = [{ w: a + b + seamIn, l: len }, { w: a + b + seamIn, l: len }];
      else blanks = [{ w: a + seamIn, l: len }, { w: a + seamIn, l: len }, { w: b + seamIn, l: len }, { w: b + seamIn, l: len }];
      detail = `${blanks.length} blank(s), ${cut === "wrap" ? "one wrap" : cut === "lhalf" ? "two L-halves" : "four sides"}`;
    } else if (ductType === "straight_round") {
      if (D == null || L == null) return null;
      blanks = [{ w: Math.PI * toIn(D) + seamIn, l: toIn(L) }];
      detail = "1 wrap blank";
    } else if (ductType === "reducer") {
      if (W == null || H == null || W2 == null || H2 == null || L == null) return null;
      const a1 = toIn(W), b1 = toIn(H), a2 = toIn(W2), b2 = toIn(H2), len = toIn(L);
      const off = Math.max(Math.abs(a1 - a2), Math.abs(b1 - b2)) / 2;
      const slant = Math.sqrt(len ** 2 + off ** 2);
      blanks = [
        { w: Math.max(a1, a2) + seamIn, l: slant }, { w: Math.max(a1, a2) + seamIn, l: slant },
        { w: Math.max(b1, b2) + seamIn, l: slant }, { w: Math.max(b1, b2) + seamIn, l: slant },
      ];
      detail = `4 tapered side panels, slant ${r(slant)} in`;
    } else if (ductType === "sq2round") {
      if (W == null || H == null || D == null || L == null) return null;
      const a = toIn(W), b = toIn(H), dia = toIn(D), len = toIn(L);
      const off = Math.max(a, b) / 2;
      const slant = Math.sqrt(len ** 2 + off ** 2);
      blanks = [{ w: (P(a, b) + Math.PI * dia) / 2 + seamIn, l: slant }];
      detail = `1 transition blank, slant ${r(slant)} in`;
    } else if (ductType === "elbow90") {
      if (W == null || H == null) return null;
      const a = toIn(W), b = toIn(H);
      const throatR = TH != null ? toIn(TH) : a;
      const arc = (Math.PI / 2) * (throatR + a / 2);
      blanks = [{ w: P(a, b) + seamIn, l: arc }];
      detail = `1 blank, arc ${r(arc)} in (R throat ${r(throatR)} in)`;
    } else if (ductType === "offset") {
      if (W == null || H == null || L == null || OFF == null) return null;
      const a = toIn(W), b = toIn(H);
      const path = Math.sqrt(toIn(L) ** 2 + toIn(OFF) ** 2);
      blanks = [{ w: P(a, b) + seamIn, l: path }];
      detail = `1 blank, path ${r(path)} in`;
    } else if (ductType === "y_duct") {
      if (W == null || H == null || L == null || W2 == null || H2 == null || LB == null) return null;
      blanks = [
        { w: P(toIn(W), toIn(H)) + seamIn, l: toIn(L) },
        { w: P(toIn(W2), toIn(H2)) + seamIn, l: toIn(LB) },
        { w: P(toIn(W2), toIn(H2)) + seamIn, l: toIn(LB) },
      ];
      detail = "main + 2 branch blanks";
    }
    if (!blanks || blanks.length === 0) return null;
    if (blanks.some((bl) => !(bl.w > 0) || !(bl.l > 0))) return null;

    const perPieceArea = blanks.reduce((s, bl) => s + bl.w * bl.l, 0);
    const allBlanks: Blank[] = [];
    for (let i = 0; i < q; i++) allBlanks.push(...blanks);

    const pack = packSheets(allBlanks, SW, SL);
    const totalArea = perPieceArea * q;
    const usableIn2 = SW * SL * (1 - wf);
    const areaSheets = totalArea / usableIn2;

    return {
      perPieceFt2: perPieceArea / 144,
      totalFt2: totalArea / 144,
      blanksPerPiece: blanks.length,
      totalBlanks: allBlanks.length,
      layoutSheets: pack.total,
      utilization: pack.utilization,
      oversized: pack.oversized,
      areaSheets,
      detail,
      qty: q,
    };
  }, [ductType, unit, qty, seam, waste, sheetW, sheetL, cut, w, h, l, d, w2, h2, offset, throat, lb]);

  const dimUnit = unit;

  return (
    <Card>
      <CardContent className="space-y-4 pt-6">
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1">
            <Label>Duct type / transition</Label>
            <Select className="w-60" value={ductType} onChange={(e) => onDuctType(e.target.value as DuctType)}>
              {DUCT_TYPES.map((t) => (<option key={t.value} value={t.value}>{t.label}</option>))}
            </Select>
          </div>
          <div className="space-y-1">
            <Label>Material</Label>
            <Select className="w-44" value={material} onChange={(e) => onMaterial(e.target.value as Material)}>
              {MATERIALS.map((m) => (<option key={m} value={m}>{m}</option>))}
            </Select>
          </div>
          {showCut && (
            <div className="space-y-1">
              <Label>Cut as</Label>
              <Select className="w-40" value={cut} onChange={(e) => setCut(e.target.value as Cut)}>
                <option value="wrap">One wrap</option>
                <option value="lhalf">Two L-halves</option>
                <option value="sides">Four sides</option>
              </Select>
            </div>
          )}
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

        <div className="flex flex-wrap items-end gap-3 border-t pt-3">
          <Dim label="Seam allowance (in)" value={seam} onChange={setSeam} />
          <Dim label="Waste % (area est.)" value={waste} onChange={setWaste} />
          <Dim label="Sheet width (in)" value={sheetW} onChange={setSheetW} />
          <Dim label="Sheet length (in)" value={sheetL} onChange={setSheetL} />
        </div>

        {result ? (
          <>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Stat label={`Sheets needed (${sheetW}×${sheetL} layout)`} value={String(result.layoutSheets)} sub="nested, rounded up" highlight />
              <Stat label="Sheet utilization" value={`${Math.round(result.utilization * 100)}%`} sub={`${result.totalBlanks} blank(s) nested`} />
              <Stat label="Developed area" value={`${r(result.totalFt2, 2)} ft²`} sub={`${result.qty} pc · ${r(result.perPieceFt2, 2)} ft²/pc`} />
              <Stat label="Area estimate" value={r(result.areaSheets, 2).toLocaleString()} sub="developed ÷ usable sheet" />
            </div>
            {result.oversized > 0 && (
              <p className="text-xs text-amber-600">
                ⚠ {result.oversized} blank(s) are larger than one {sheetW}×{sheetL} sheet — they must be split/seamed
                (try a different cut method or a smaller standard length).
              </p>
            )}
            <p className="text-xs text-muted-foreground">
              {result.detail} per piece. Layout nests blanks on the sheet (both orientations); the area estimate divides
              developed area by the usable sheet (after waste %).
            </p>
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

function Stat({ label, value, sub, highlight }: { label: string; value: string; sub: string; highlight?: boolean }) {
  return (
    <div className={`rounded-md border p-2 ${highlight ? "border-primary/40 bg-primary/5" : ""}`}>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="font-semibold">{value}</div>
      <div className="text-xs text-muted-foreground">{sub}</div>
    </div>
  );
}
