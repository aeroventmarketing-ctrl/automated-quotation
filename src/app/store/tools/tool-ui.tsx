"use client";

import { DISPLAY } from "@/lib/store-ui";

/**
 * Storefront-styled form and readout primitives for the public HVAC tools.
 *
 * The staff tools use the ERP's shadcn components; these deliberately don't —
 * they carry the shop's own tokens (`--store-line`, `--store-accent`, the
 * condensed display face) so the tools page reads as part of the storefront
 * rather than a bolted-on admin screen.
 */

export const LABEL = "text-[11px] font-extrabold uppercase tracking-wide text-[#526173]";
export const CONTROL =
  "h-12 w-full rounded border border-[var(--store-line)] bg-white px-3 text-[14px] text-[var(--store-ink)] outline-none transition-colors focus:border-[var(--store-accent)]";

/** A numeric input with its label. */
export function NumField({
  label,
  value,
  onChange,
  placeholder,
  className = "",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  className?: string;
}) {
  return (
    <label className={`flex flex-col gap-1.5 ${className}`}>
      <span className={LABEL}>{label}</span>
      <input
        type="number"
        step="any"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className={CONTROL}
      />
    </label>
  );
}

/** A dropdown with its label. */
export function PickField({
  label,
  value,
  onChange,
  options,
  className = "",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  className?: string;
}) {
  return (
    <label className={`flex flex-col gap-1.5 ${className}`}>
      <span className={LABEL}>{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)} className={CONTROL}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </label>
  );
}

/** One figure in a results row. */
export function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded border border-[var(--store-line)] bg-[#f8fafb] px-3.5 py-3">
      <div className="text-[10px] font-black uppercase tracking-[0.1em] text-[var(--store-steel)]">{label}</div>
      <div className={`${DISPLAY} mt-1 text-[24px] leading-none tabular-nums`}>{value}</div>
      {sub && <div className="mt-1 text-[11px] text-[var(--store-steel)]">{sub}</div>}
    </div>
  );
}

/** The results grid under a tool's inputs. */
export function Stats({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{children}</div>;
}

/** The card each tool sits in, with its title and one-line explanation. */
export function ToolCard({
  title,
  intro,
  children,
}: {
  title: string;
  intro: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-md border border-[var(--store-line)] bg-white p-6 sm:p-8">
      <h2 className={`${DISPLAY} text-[28px] leading-none`}>{title}</h2>
      <p className="mt-2.5 max-w-3xl text-[13.5px] leading-relaxed text-[#536275]">{intro}</p>
      <div className="mt-6 space-y-5">{children}</div>
    </section>
  );
}

/** A muted hint / validation line. */
export function Hint({ children }: { children: React.ReactNode }) {
  return <p className="text-[13px] text-[var(--store-steel)]">{children}</p>;
}

/** A labelled band separating a secondary input group from the main one. */
export function SubGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="border-t border-[#edf0f2] pt-5">
      <div className="mb-3 text-[10px] font-black uppercase tracking-[0.14em] text-[var(--store-steel)]">{label}</div>
      {children}
    </div>
  );
}
