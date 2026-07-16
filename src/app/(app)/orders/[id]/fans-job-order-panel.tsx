"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Printer, Pencil, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatJoNumber, EMPTY_FANS_JO, type FansJobOrder } from "@/lib/job-order";
import { saveFansJobOrder, deleteFansJobOrder } from "../actions";

// Option lists taken straight from the template's lookup tables so selections
// always match its VLOOKUPs.
const BLADE_DIAMETERS = ["9", "10.5", "12.25", "13.5", "15", "16.5", "18.25", "20", "22.25", "24.5", "27", "30", "33", "36.5", "40.25", "44.5", "49", "54.5", "60", "66", "73", "83"];
const ROTATIONS = ["Clockwise", "Counterclockwise", "Clockwise & Counterclockwise"];
const MOTOR_HP = ["1/4 HP, 1PH, TECO", "1/2 HP, 1PH, TECO", "3 /4 HP, 1PH, TECO", "1 HP, 1PH, TECO", "1.5 HP, 1PH, TECO", "2 HP, 1PH, TECO", "3 HP, 1PH, TECO", "5 HP, 1PH, TECO", "1/2 HP, 3PH, TECO", "1 HP, 3PH, TECO", "1 1/2 HP, 3PH, TECO", "2 HP, 3PH, TECO", "3 HP, 3PH, TECO", "5 HP, 3PH, TECO", "7 1/2 HP, 3PH, TECO", "10 HP, 3PH, TECO", "15 HP, 3PH, TECO", "20 HP, 3PH, TECO", "25 HP, 3PH, TECO", "30 HP, 3PH, TECO", "40 HP, 3PH, TECO", "50 HP, 3PH, TECO", "60 HP, 3PH, TECO", "75 HP, 3PH, TECO", "100 HP, 3PH, TECO", "125 HP, 3PH, TECO", "150 HP, 3PH, TECO", "175 HP, 3PH, TECO", "200 HP, 3PH, TECO", "250 HP, 3PH, TECO", "300 HP, 3PH, TECO", "1/2 HP, 3PH, Hyundai", "1 HP, 3PH, Hyundai", "1 1/2 HP, 3PH, Hyundai", "2 HP, 3PH, Hyundai", "3 HP, 3PH, Hyundai", "5.5 HP, 3PH, Hyundai", "7 1/2 HP, 3PH, Hyundai", "10 HP, 3PH, Hyundai", "15 HP, 3PH, Hyundai", "20 HP, 3PH, Hyundai", "25 HP, 3PH, Hyundai", "30 HP, 3PH, Hyundai", "40 HP, 3PH, Hyundai", "50 HP, 3PH, Hyundai", "60 HP, 3PH, Hyundai", "75 HP, 3PH, Hyundai", "100 HP, 3PH, Hyundai", "125 HP, 3PH, Hyundai", "150 HP, 3PH, Hyundai", "180 HP, 3PH, Hyundai", "200 HP, 3PH, Hyundai", "270 HP, 3PH, Hyundai", "340 HP, 3PH, Hyundai"];
const ORIENTATIONS = ["Top Horizontal", "Bottom Horizontal", "Up Blast", "Down Blast", "Top Angular Up", "Top Angular Down", "Bottom Angular Up", "Bottom Angular Down"];
const BLADE_TYPES = ["Backwardly Inclined", "Forward Curved", "Radial", "Airfoil", "Radial Tip"];
const DRIVE_TYPES = ["Belt", "Direct"];
const MOUNTINGS = ["Foot Mounted", "Flange Mounted", "Face Mounted"];
const ENCLOSURES = ["TEFC", "ODP", "Explosion Proof"];
const PROJECTS = ["CEB", "CFAB", "CAB", "CEBCAB", "CFABCAB", "CABSISW"];
const MAKES = ["Standard", "Customized", "Client Design"];

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
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const year = baseYear ?? new Date().getFullYear();
  const total = jobOrders.length;
  const numberFor = (i: number) => (baseNo != null ? formatJoNumber(baseNo, year, i, total) : "—");

  if (editIndex !== null) {
    return (
      <JobOrderForm
        orderId={orderId}
        index={editIndex >= 0 ? editIndex : null}
        initial={editIndex >= 0 ? jobOrders[editIndex] : { ...EMPTY_FANS_JO, date: todayISO() }}
        onDone={() => { setEditIndex(null); router.refresh(); }}
        onCancel={() => setEditIndex(null)}
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
        <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => setEditIndex(-1)}>
          <Plus className="mr-1 h-3.5 w-3.5" /> Add Fans &amp; Blowers job order
        </Button>
      )}
      {err && <p className="text-xs text-destructive">{err}</p>}
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
          {value && !list.includes(value) && <option value={value}>{value}</option>}
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

  async function save() {
    setBusy(true);
    setErr(null);
    try {
      // Keep the template's brand/alias in step with the chosen motor HP.
      const { brand, alias } = deriveMotor(f.motorHp);
      await saveFansJobOrder(orderId, index, { ...f, motorBrand: brand || f.motorBrand, motorPhAlias: alias || f.motorPhAlias });
      onDone();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed");
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3 rounded-md border bg-muted/30 p-3">
      <div className="text-sm font-medium">{index != null ? "Edit" : "New"} Fans &amp; Blowers Job Order</div>

      <div className="text-xs font-semibold text-muted-foreground">Header</div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {fld("Project", "project", { list: PROJECTS })}
        <div className="space-y-1">
          <span className="text-[11px] text-muted-foreground">Drive type</span>
          <label className="flex h-8 items-center gap-2">
            <input
              type="checkbox"
              className="h-4 w-4 accent-[#ED1C24]"
              checked={f.directDrive}
              onChange={(e) => setF((p) => ({ ...p, directDrive: e.target.checked }))}
            />
            <span className="text-sm font-medium">Direct</span>
          </label>
        </div>
        {fld("Make", "make", { list: MAKES })}
        {fld("Date", "date", { type: "date" })}
        {fld("Target date", "targetDate", { type: "date" })}
        {fld("Quantity", "quantity")}
        {fld("UOM", "uom", { list: ["pcs.", "set", "unit"] })}
        {fld("Body lead time (days)", "bodyLeadTime")}
        {fld("Blade lead time (days)", "bladeLeadTime")}
      </div>

      <div className="text-xs font-semibold text-muted-foreground">Fan / Blower details</div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {fld("Blade diameter (Ø)", "bladeDiameter", { list: BLADE_DIAMETERS })}
        {fld("Orientation", "orientation", { list: ORIENTATIONS })}
        {fld("Rotation", "rotation", { list: ROTATIONS })}
        {fld("Impeller / blade type", "bladeType", { list: BLADE_TYPES })}
        {fld("Drive", "driveType", { list: DRIVE_TYPES })}
        {fld("RPM (catalogue)", "rpmCatalogue")}
        {fld("Capacity (@ w.g.)", "capacity", { placeholder: '21,338 cfm @ 2" w.g.' })}
        {fld('Test @ 0" w.g.', "capacityAt0", { placeholder: '29,087 cfm @ 0" w.g.' })}
      </div>

      <div className="text-xs font-semibold text-muted-foreground">Motor details</div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <div className="sm:col-span-2">{fld("Motor HP", "motorHp", { list: MOTOR_HP, placeholder: "15 HP, 3PH, Hyundai" })}</div>
        {fld("Voltage", "voltage")}
        {fld("Frequency (Hz)", "frequency")}
        {fld("Mounting", "mounting", { list: MOUNTINGS })}
        {fld("Enclosure", "enclosure", { list: ENCLOSURES })}
        {fld("Motor pulley (Ø)", "motorPulley")}
        {fld("Fan pulley (Ø)", "fanPulley")}
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
