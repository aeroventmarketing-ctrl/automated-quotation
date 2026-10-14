"use client";

import { useId } from "react";
import Link from "next/link";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";

/** Form pieces shared by the life-safety calculators (Pressurization, Smoke Exhaust). */

export function Group({ label, children }: { label?: string; children: React.ReactNode }) {
  return (
    <div>
      {label && <div className="mb-1 text-xs font-medium text-muted-foreground">{label}</div>}
      <div className="flex flex-wrap items-end gap-3">{children}</div>
    </div>
  );
}

export function Field({
  label, value, onChange, placeholder, width = "w-28", type = "number",
}: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string; width?: string; type?: "number" | "text";
}) {
  const id = useId();
  return (
    <div className="space-y-1">
      <Label htmlFor={id} className="text-[11px]">{label}</Label>
      <Input id={id} className={width} type={type} step="any" value={value} placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

export function Picker({
  label, value, onChange, options, className = "w-40",
}: {
  label: string; value: string; onChange: (v: string) => void; options: [string, string][]; className?: string;
}) {
  const id = useId();
  return (
    <div className="space-y-1">
      <Label htmlFor={id} className="text-[11px]">{label}</Label>
      <Select id={id} className={className} value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </Select>
    </div>
  );
}

/** Opens the Fan Selector with this duty filled in. */
export function SelectFanLink({ cfm, inwg, label }: { cfm: number; inwg: number; label?: string }) {
  const q = new URLSearchParams({ airflow: String(cfm), airflowUnit: "cfm", pressure: String(inwg), pressureUnit: "inwg" });
  return (
    <Link
      href={`/tools?${q.toString()}`}
      className="inline-flex h-9 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground shadow hover:bg-primary/90"
    >
      {label ?? "Select fan"}
    </Link>
  );
}

export const numOr = (s: string, fallback: number): number => {
  const n = Number(s);
  return s.trim() !== "" && Number.isFinite(n) ? n : fallback;
};

export const fmt0 = (n: number) => n.toLocaleString("en-PH", { maximumFractionDigits: 0 });
export const fmtN = (n: number, d: number) => n.toLocaleString("en-PH", { minimumFractionDigits: d, maximumFractionDigits: d });

/** A field's number, or NaN when blank — the solvers refuse NaN with a reason. */
export const num = (s: string): number => (s.trim() === "" ? NaN : Number(s));
