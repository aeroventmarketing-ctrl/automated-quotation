"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Printer, Pencil, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatJoNumber, EMPTY_FANS_JO, JO_TYPES, joTypeLabel, joTypeReady, type FansJobOrder } from "@/lib/job-order";
import { saveFansJobOrder, deleteFansJobOrder } from "../actions";

// Option lists taken straight from the template's lookup tables so selections
// always match its VLOOKUPs.
const BLADE_DIAMETERS = ["9", "10.5", "12.25", "13.5", "15", "16.5", "18.25", "20", "22.25", "24.5", "27", "30", "33", "36.5", "40.25", "44.5", "49", "54.5", "60", "66", "73", "83"];
const ROTATIONS = ["Clockwise", "Counterclockwise", "Clockwise & Counterclockwise"];
const MOTOR_HP = ["1/4 HP, 1PH, TECO", "1/2 HP, 1PH, TECO", "3 /4 HP, 1PH, TECO", "1 HP, 1PH, TECO", "1.5 HP, 1PH, TECO", "2 HP, 1PH, TECO", "3 HP, 1PH, TECO", "5 HP, 1PH, TECO", "1/2 HP, 3PH, TECO", "1 HP, 3PH, TECO", "1 1/2 HP, 3PH, TECO", "2 HP, 3PH, TECO", "3 HP, 3PH, TECO", "5 HP, 3PH, TECO", "7 1/2 HP, 3PH, TECO", "10 HP, 3PH, TECO", "15 HP, 3PH, TECO", "20 HP, 3PH, TECO", "25 HP, 3PH, TECO", "30 HP, 3PH, TECO", "40 HP, 3PH, TECO", "50 HP, 3PH, TECO", "60 HP, 3PH, TECO", "75 HP, 3PH, TECO", "100 HP, 3PH, TECO", "125 HP, 3PH, TECO", "150 HP, 3PH, TECO", "175 HP, 3PH, TECO", "200 HP, 3PH, TECO", "250 HP, 3PH, TECO", "300 HP, 3PH, TECO", "1/2 HP, 3PH, Hyundai", "1 HP, 3PH, Hyundai", "1 1/2 HP, 3PH, Hyundai", "2 HP, 3PH, Hyundai", "3 HP, 3PH, Hyundai", "5.5 HP, 3PH, Hyundai", "7 1/2 HP, 3PH, Hyundai", "10 HP, 3PH, Hyundai", "15 HP, 3PH, Hyundai", "20 HP, 3PH, Hyundai", "25 HP, 3PH, Hyundai", "30 HP, 3PH, Hyundai", "40 HP, 3PH, Hyundai", "50 HP, 3PH, Hyundai", "60 HP, 3PH, Hyundai", "75 HP, 3PH, Hyundai", "100 HP, 3PH, Hyundai", "125 HP, 3PH, Hyundai", "150 HP, 3PH, Hyundai", "180 HP, 3PH, Hyundai", "200 HP, 3PH, Hyundai", "270 HP, 3PH, Hyundai", "340 HP, 3PH, Hyundai"];
const ORIENTATIONS = ["Top Horizontal", "Bottom Horizontal", "Upblast", "Downblast", "Top Angular Up", "Top Angular Down", "Bottom Angular Up", "Bottom Angular Down", "Flange Mounted"];
const BLADE_TYPES = ["Backwardly Inclined", "Backward Curved", "Forward Curved", "Airfoil", "Radial"];
const DRIVE_TYPES = ["Belt", "Direct"];
const MOUNTINGS = ["Foot Mounted", "Flange Mounted"];
const ENCLOSURES = ["TEFC", "Explosion Proof"];
const VOLTAGES = ["220", "380", "440"];
const FREQUENCIES = ["60", "50"];
const PROJECTS = ["CEB", "CFAB", "CAB", "CEBCAB", "CFABCAB", "CABSISW"];
const MAKES = ["Standard", "Customized", "Client Design"];
const MOTOR_BRANDS = ["TECO", "Hyundai"];

// Centrifugal Inline option lists (from the Inline template's data validations).
const INLINE_PROJECTS = ["CIEB"];
const INLINE_ORIENTATIONS = ["Foot Mounted", "Ceiling Hung", "Dual Mounted", "Flange Mounted", "With Stand"];
const MOTOR_LOCATIONS = ["12 o'clock facing discharge", "9 o'clock facing discharge", "6 o'clock facing discharge", "3 o'clock facing discharge"];
const INLINE_BLADE_TYPES = ["Backwardly Inclined", "Backward Curved", "Airfoil"];
const INLINE_DRIVE_TYPES = ["Direct", "Belt", "Directly Coupled"];
const INLINE_ENCLOSURES = ["TEFC", "Exproof"];

// Panel Fan option lists (from the Panel Fan template's data validations).
const PANEL_PROJECTS = ["EWF", "FAWF"];
const PANEL_BLADE_DIAMETERS = ["10", "12", "14", "16", "18", "20", "24", "30", "36", "42", "48", "54", "60"];
const PANEL_ORIENTATIONS = ["Exhaust 1", "Exhaust 2", "Supply 1", "Supply 2"];
const PANEL_MOUNTINGS = ["Wall Mounted", "Ceiling Mounted", "With Stand", "Ceiling Hang"];
const PANEL_BLADE_TYPES = ["Kidney Type", "Paddle Type", "Airfoil"];
const PANEL_DRIVE_TYPES = ["Direct", "Belt", "Directly Coupled"];

// A belt-drive JO form is driven by a per-type config so the Centrifugal Blower
// can serve as the reference for every belt-drive type. `fieldC` is the Source
// B79 field — the Centrifugal Blower labels it "Rotation", the Inline labels it
// "Motor Location"; both store into the `rotation` field. Everything shared
// (motor cascade, computed Fan RPM, header) stays common.
type BeltDriveConfig = {
  projects: string[];
  makes: string[];
  uoms: string[];
  bladeDiameters: string[];
  orientations: string[];
  fieldC: { label: string; options: string[] };
  bladeTypes: string[];
  driveTypes: string[];
  voltages: string[];
  frequencies: string[];
  mountings: string[];
  enclosures: string[];
  directCheckbox: boolean;
};

const BELT_DRIVE_CONFIGS: Record<string, BeltDriveConfig> = {
  centrifugal_blower: {
    projects: PROJECTS,
    makes: MAKES,
    uoms: ["pc", "pcs", "set"],
    bladeDiameters: BLADE_DIAMETERS,
    orientations: ORIENTATIONS,
    fieldC: { label: "Rotation", options: ROTATIONS },
    bladeTypes: BLADE_TYPES,
    driveTypes: DRIVE_TYPES,
    voltages: VOLTAGES,
    frequencies: FREQUENCIES,
    mountings: MOUNTINGS,
    enclosures: ENCLOSURES,
    directCheckbox: true,
  },
  centrifugal_inline_blower: {
    projects: INLINE_PROJECTS,
    makes: MAKES,
    uoms: ["pc.", "pcs.", "set"],
    bladeDiameters: BLADE_DIAMETERS,
    orientations: INLINE_ORIENTATIONS,
    fieldC: { label: "Motor Location", options: MOTOR_LOCATIONS },
    bladeTypes: INLINE_BLADE_TYPES,
    driveTypes: INLINE_DRIVE_TYPES,
    voltages: VOLTAGES,
    frequencies: FREQUENCIES,
    mountings: MOUNTINGS,
    enclosures: INLINE_ENCLOSURES,
    directCheckbox: true,
  },
  panel_fan: {
    projects: PANEL_PROJECTS,
    makes: MAKES,
    uoms: ["pc.", "pcs.", "set"],
    bladeDiameters: PANEL_BLADE_DIAMETERS,
    orientations: PANEL_ORIENTATIONS,
    fieldC: { label: "Mounting", options: PANEL_MOUNTINGS },
    bladeTypes: PANEL_BLADE_TYPES,
    driveTypes: PANEL_DRIVE_TYPES,
    voltages: VOLTAGES,
    frequencies: FREQUENCIES,
    mountings: MOUNTINGS,
    enclosures: INLINE_ENCLOSURES,
    directCheckbox: true,
  },
};
const DEFAULT_BELT_CONFIG = BELT_DRIVE_CONFIGS.centrifugal_blower;

// Motor selection is cascading: Brand → Phase → HP. Each MOTOR_HP entry is
// "<hp>, <1PH|3PH>, <brand>"; the HP dropdown shows just the HP but stores the
// full key (the template's VLOOKUP needs it).
const MOTOR_ENTRIES = MOTOR_HP.map((full) => {
  const [hp, phase, brand] = full.split(",").map((s) => s.trim());
  return { full, hp, phase, brand };
});
// Motor RPM per selection (from the template's motor table) — used to preview
// the computed Fan RPM = roundup(motorRpm × motorPulley ÷ fanPulley).
const MOTOR_RPM: Record<string, number> = {
  "1/4 HP, 1PH, TECO": 1715, "1/2 HP, 1PH, TECO": 1750, "3 /4 HP, 1PH, TECO": 1750, "1 HP, 1PH, TECO": 1750, "1.5 HP, 1PH, TECO": 1750, "2 HP, 1PH, TECO": 1750, "3 HP, 1PH, TECO": 1750, "5 HP, 1PH, TECO": 1750, "1/2 HP, 3PH, TECO": 1680, "1 HP, 3PH, TECO": 1710, "1 1/2 HP, 3PH, TECO": 1720, "2 HP, 3PH, TECO": 1715, "3 HP, 3PH, TECO": 1735, "5 HP, 3PH, TECO": 1745, "7 1/2 HP, 3PH, TECO": 1750, "10 HP, 3PH, TECO": 1750, "15 HP, 3PH, TECO": 1760, "20 HP, 3PH, TECO": 1760, "25 HP, 3PH, TECO": 1760, "30 HP, 3PH, TECO": 1765, "40 HP, 3PH, TECO": 1760, "50 HP, 3PH, TECO": 1770, "60 HP, 3PH, TECO": 1765, "75 HP, 3PH, TECO": 1775, "100 HP, 3PH, TECO": 1775, "125 HP, 3PH, TECO": 1770, "150 HP, 3PH, TECO": 1770, "175 HP, 3PH, TECO": 1770, "200 HP, 3PH, TECO": 1775, "250 HP, 3PH, TECO": 1775, "300 HP, 3PH, TECO": 1775,
  "1/2 HP, 3PH, Hyundai": 1660, "1 HP, 3PH, Hyundai": 1668, "1 1/2 HP, 3PH, Hyundai": 1680, "2 HP, 3PH, Hyundai": 1680, "3 HP, 3PH, Hyundai": 1716, "5.5 HP, 3PH, Hyundai": 1728, "7 1/2 HP, 3PH, Hyundai": 1728, "10 HP, 3PH, Hyundai": 1728, "15 HP, 3PH, Hyundai": 1728, "20 HP, 3PH, Hyundai": 1752, "25 HP, 3PH, Hyundai": 1752, "30 HP, 3PH, Hyundai": 1764, "40 HP, 3PH, Hyundai": 1764, "50 HP, 3PH, Hyundai": 1764, "60 HP, 3PH, Hyundai": 1770, "75 HP, 3PH, Hyundai": 1770, "100 HP, 3PH, Hyundai": 1776, "125 HP, 3PH, Hyundai": 1776, "150 HP, 3PH, Hyundai": 1776, "180 HP, 3PH, Hyundai": 1776, "200 HP, 3PH, Hyundai": 1776, "270 HP, 3PH, Hyundai": 1776, "340 HP, 3PH, Hyundai": 1788,
};
const phaseLabel = (tok: string) => (tok === "1PH" ? "Single Phase" : "Three Phase");
const phaseToken = (label: string) => (label === "Single Phase" ? "1PH" : "3PH");
function phasesForBrand(brand: string): string[] {
  const toks = new Set(MOTOR_ENTRIES.filter((e) => e.brand === brand).map((e) => e.phase));
  return ["1PH", "3PH"].filter((t) => toks.has(t)).map(phaseLabel);
}
function hpForBrandPhase(brand: string, phaseLbl: string) {
  const tok = phaseToken(phaseLbl);
  return MOTOR_ENTRIES.filter((e) => e.brand === brand && e.phase === tok);
}
const SELECT_CLS = "h-8 w-full rounded-md border bg-background px-2 text-sm disabled:opacity-50";

/** Derive the template's motor brand + phase alias from a "HP, PH, Brand" string. */
function deriveMotor(hp: string): { brand: string; alias: string } {
  const parts = hp.split(",").map((p) => p.trim());
  const brand = parts[2] ?? "";
  const ph = (parts[1] ?? "").toUpperCase();
  const phase = ph.startsWith("1") ? "1Phase" : "3Phase";
  return { brand, alias: brand ? `${brand}_${phase}` : "" };
}

function todayISO(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

export function FansJobOrderPanel({
  orderId,
  jobOrders,
  baseNo,
  baseYear,
  canManage,
}: {
  orderId: string;
  jobOrders: FansJobOrder[];
  baseNo?: number;
  baseYear?: number;
  canManage: boolean;
}) {
  const router = useRouter();
  const [editIndex, setEditIndex] = useState<number | null>(null); // null = list view; -1 = new
  const [newType, setNewType] = useState<string | null>(null); // type chosen for a new JO
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const year = baseYear ?? new Date().getFullYear();
  const total = jobOrders.length;
  const numberFor = (i: number) => (baseNo != null ? formatJoNumber(baseNo, year, i, total) : "—");

  // New JO: first pick the type, then fill its form.
  if (editIndex === -1 && newType === null) {
    return <JoTypeChooser onPick={(key) => setNewType(key)} onCancel={() => setEditIndex(null)} />;
  }
  if (editIndex !== null) {
    const editing = editIndex >= 0;
    const initial = editing
      ? jobOrders[editIndex]
      : { ...EMPTY_FANS_JO, type: newType ?? EMPTY_FANS_JO.type, date: todayISO() };
    return (
      <JobOrderForm
        orderId={orderId}
        index={editing ? editIndex : null}
        initial={initial}
        onDone={() => { setEditIndex(null); setNewType(null); router.refresh(); }}
        onCancel={() => { setEditIndex(null); setNewType(null); }}
      />
    );
  }

  async function remove(i: number) {
    if (!confirm("Delete this job order?")) return;
    setBusy(true);
    setErr(null);
    try {
      await deleteFansJobOrder(orderId, i);
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2">
      {jobOrders.length === 0 ? (
        <p className="text-xs text-muted-foreground">No Fans &amp; Blowers job order yet.</p>
      ) : (
        <ul className="space-y-2">
          {jobOrders.map((jo, i) => (
            <li key={i} className="flex flex-wrap items-center gap-2 rounded-md border bg-muted/20 p-2 text-xs">
              <span className="font-mono font-semibold">{numberFor(i)}</span>
              <span className="rounded-full bg-[#ED1C24]/10 px-2 py-0.5 font-medium text-[#ED1C24]">{joTypeLabel(jo.type)}</span>
              <span className="text-muted-foreground">
                {[jo.bladeDiameter && `${jo.bladeDiameter}"Ø`, jo.project, jo.quantity && `${jo.quantity} ${jo.uom}`].filter(Boolean).join(" · ")}
              </span>
              <a
                href={`/orders/${orderId}/jo/${i}/xlsx`}
                className="ml-auto inline-flex items-center gap-1.5 rounded-md bg-[#ED1C24] px-3 py-1.5 font-semibold text-white shadow-sm transition-colors hover:bg-[#c2141a]"
              >
                <Printer className="h-3.5 w-3.5" /> Print Job Order
              </a>
              {canManage && (
                <>
                  <button type="button" onClick={() => setEditIndex(i)} className="inline-flex items-center gap-1 rounded-md border border-[#ED1C24] px-2 py-1.5 font-semibold text-[#ED1C24] hover:bg-[#ED1C24]/10">
                    <Pencil className="h-3.5 w-3.5" /> Edit
                  </button>
                  <button type="button" disabled={busy} onClick={() => remove(i)} className="inline-flex items-center gap-1 rounded-md border px-2 py-1.5 text-muted-foreground hover:text-destructive">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
      {canManage && (
        <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => { setEditIndex(-1); setNewType(null); }}>
          <Plus className="mr-1 h-3.5 w-3.5" /> Add Fans &amp; Blowers job order
        </Button>
      )}
      {err && <p className="text-xs text-destructive">{err}</p>}
    </div>
  );
}

/** Step 1 of creating a JO: pick which of the six Fans & Blowers types it is. */
function JoTypeChooser({ onPick, onCancel }: { onPick: (key: string) => void; onCancel: () => void }) {
  return (
    <div className="space-y-3 rounded-md border bg-muted/30 p-3">
      <div className="text-sm font-medium">Select the job order type</div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {JO_TYPES.map((t) => {
          const ready = joTypeReady(t.key);
          return (
            <button
              key={t.key}
              type="button"
              disabled={!ready}
              onClick={() => ready && onPick(t.key)}
              className={
                ready
                  ? "flex items-center justify-between gap-2 rounded-md border border-[#ED1C24] px-3 py-2 text-left text-sm font-semibold text-[#ED1C24] transition-colors hover:bg-[#ED1C24]/10"
                  : "flex items-center justify-between gap-2 rounded-md border border-dashed px-3 py-2 text-left text-sm text-muted-foreground opacity-70"
              }
            >
              <span>{t.label}</span>
              {!ready && <span className="text-[10px] uppercase tracking-wide">Awaiting template</span>}
            </button>
          );
        })}
      </div>
      <p className="text-[11px] text-muted-foreground">
        Only Centrifugal Blower is set up so far. Send the Excel template for any other type and it will be enabled here.
      </p>
      <Button size="sm" variant="outline" className="h-8" onClick={onCancel}>Cancel</Button>
    </div>
  );
}

/** One labelled field. Hoisted to module scope so typing never drops focus. */
function Field({
  label,
  k,
  value,
  onSet,
  type = "text",
  list,
  placeholder,
}: {
  label: string;
  k: keyof FansJobOrder;
  value: string;
  onSet: (k: keyof FansJobOrder, v: string) => void;
  type?: string;
  list?: string[];
  placeholder?: string;
}) {
  return (
    <label className="space-y-1">
      <span className="text-[11px] text-muted-foreground">{label}</span>
      {list ? (
        <select
          className="h-8 w-full rounded-md border bg-background px-2 text-sm"
          value={value}
          onChange={(e) => onSet(k, e.target.value)}
        >
          <option value="">— select —</option>
          {list.map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
      ) : (
        <Input className="h-8" type={type} value={value} placeholder={placeholder} onChange={(e) => onSet(k, e.target.value)} />
      )}
    </label>
  );
}

function JobOrderForm({
  orderId,
  index,
  initial,
  onDone,
  onCancel,
}: {
  orderId: string;
  index: number | null;
  initial: FansJobOrder;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [f, setF] = useState<FansJobOrder>(initial);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const set = (k: keyof FansJobOrder, v: string) => setF((p) => ({ ...p, [k]: v }));
  const fld = (label: string, k: keyof FansJobOrder, opts?: { type?: string; list?: string[]; placeholder?: string }) => (
    <Field label={label} k={k} value={String(f[k] ?? "")} onSet={set} type={opts?.type} list={opts?.list} placeholder={opts?.placeholder} />
  );

  const cfg = BELT_DRIVE_CONFIGS[f.type] ?? DEFAULT_BELT_CONFIG;

  // Direct-drive units carry a "DD" suffix on their project/unit code.
  const projectOptions = f.directDrive ? cfg.projects.map((p) => `${p}DD`) : cfg.projects;
  function toggleDirect(checked: boolean) {
    setF((p) => {
      let project = p.project;
      if (checked && project && !project.endsWith("DD")) project = `${project}DD`;
      else if (!checked && project.endsWith("DD")) project = project.slice(0, -2);
      return { ...p, directDrive: checked, project };
    });
  }

  // Live-computed Fan RPM = roundup(motorRpm × motorPulley ÷ fanPulley).
  const motorRpm = MOTOR_RPM[f.motorHp];
  const mP = Number(String(f.motorPulley).replace(/,/g, ""));
  const fP = Number(String(f.fanPulley).replace(/,/g, ""));
  const fanRpm = motorRpm && mP > 0 && fP > 0 ? Math.ceil((motorRpm * mP) / fP) : null;

  async function save() {
    setBusy(true);
    setErr(null);
    try {
      // Fall back to the motor HP's brand only when Motor Brand was left blank;
      // the engineer's explicit Brand / PH selections win.
      const { brand } = deriveMotor(f.motorHp);
      await saveFansJobOrder(orderId, index, { ...f, motorBrand: f.motorBrand || brand });
      onDone();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed");
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3 rounded-md border bg-muted/30 p-3">
      <div className="text-sm font-medium">
        {index != null ? "Edit" : "New"} {joTypeLabel(f.type)} Job Order
      </div>

      <div className="text-xs font-semibold text-muted-foreground">Header</div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {fld("Project", "project", { list: projectOptions })}
        {cfg.directCheckbox && (
          <div className="space-y-1">
            <span className="text-[11px] text-muted-foreground">Drive type</span>
            <label className="flex h-8 items-center gap-2">
              <input
                type="checkbox"
                className="h-4 w-4 accent-[#ED1C24]"
                checked={f.directDrive}
                onChange={(e) => toggleDirect(e.target.checked)}
              />
              <span className="text-sm font-medium">Direct</span>
            </label>
          </div>
        )}
        {fld("Make", "make", { list: cfg.makes })}
        {fld("Date", "date", { type: "date" })}
        {fld("Target date", "targetDate", { type: "date" })}
        {fld("Quantity", "quantity")}
        {fld("UOM", "uom", { list: cfg.uoms })}
        {fld("Body lead time (days)", "bodyLeadTime")}
        {fld("Blade lead time (days)", "bladeLeadTime")}
      </div>

      <div className="text-xs font-semibold text-muted-foreground">Fan / Blower details</div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {fld("Blade diameter (Ø)", "bladeDiameter", { list: cfg.bladeDiameters })}
        {fld("Orientation", "orientation", { list: cfg.orientations })}
        {fld(cfg.fieldC.label, "rotation", { list: cfg.fieldC.options })}
        {fld("Impeller / blade type", "bladeType", { list: cfg.bladeTypes })}
        {fld("Drive", "driveType", { list: cfg.driveTypes })}
        {fld("Capacity (@ w.g.)", "capacity", { placeholder: '21,338 cfm @ 2" w.g.' })}
        {fld('Test @ 0" w.g.', "capacityAt0", { placeholder: '29,087 cfm @ 0" w.g.' })}
        {fld("RPM (catalogue)", "rpmCatalogue")}
      </div>

      <div className="text-xs font-semibold text-muted-foreground">Motor details</div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <label className="space-y-1">
          <span className="text-[11px] text-muted-foreground">Motor Brand</span>
          <select className={SELECT_CLS} value={f.motorBrand} onChange={(e) => setF((p) => ({ ...p, motorBrand: e.target.value, motorPhAlias: "", motorHp: "" }))}>
            <option value="">— select —</option>
            {MOTOR_BRANDS.map((b) => <option key={b} value={b}>{b}</option>)}
          </select>
        </label>
        <label className="space-y-1">
          <span className="text-[11px] text-muted-foreground">Motor PH</span>
          <select className={SELECT_CLS} value={f.motorPhAlias} disabled={!f.motorBrand} onChange={(e) => setF((p) => ({ ...p, motorPhAlias: e.target.value, motorHp: "" }))}>
            <option value="">— select —</option>
            {phasesForBrand(f.motorBrand).map((ph) => <option key={ph} value={ph}>{ph}</option>)}
          </select>
        </label>
        <label className="space-y-1 sm:col-span-2">
          <span className="text-[11px] text-muted-foreground">Motor HP</span>
          <select className={SELECT_CLS} value={f.motorHp} disabled={!f.motorBrand || !f.motorPhAlias} onChange={(e) => setF((p) => ({ ...p, motorHp: e.target.value }))}>
            <option value="">— select —</option>
            {hpForBrandPhase(f.motorBrand, f.motorPhAlias).map((e) => <option key={e.full} value={e.full}>{e.hp}</option>)}
          </select>
        </label>
        {fld("Voltage", "voltage", { list: cfg.voltages })}
        {fld("Frequency (Hz)", "frequency", { list: cfg.frequencies })}
        {fld("Mounting", "mounting", { list: cfg.mountings })}
        {fld("Enclosure", "enclosure", { list: cfg.enclosures })}
        {fld("Motor pulley (Ø)", "motorPulley")}
        {fld("Fan pulley (Ø)", "fanPulley")}
        <label className="space-y-1">
          <span className="text-[11px] text-muted-foreground">RPM (auto)</span>
          <Input className="h-8 bg-muted/50 font-medium" readOnly value={fanRpm != null ? String(fanRpm) : ""} placeholder="—" title="Computed Fan RPM = roundup(Motor RPM × Motor Pulley ÷ Fan Pulley)" />
        </label>
      </div>

      <div className="text-xs font-semibold text-muted-foreground">Assignment</div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {fld("Assigned personnel (not printed on the JO)", "assignedPersonnel")}
      </div>

      <div className="flex items-center gap-2">
        <Button size="sm" className="h-8" disabled={busy} onClick={save}>{busy ? "Saving…" : index != null ? "Save changes" : "Create job order"}</Button>
        <Button size="sm" variant="outline" className="h-8" disabled={busy} onClick={onCancel}>Cancel</Button>
        {err && <span className="text-xs text-destructive">{err}</span>}
      </div>
    </div>
  );
}
