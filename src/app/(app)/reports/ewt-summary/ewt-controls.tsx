"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Eye, Download, Upload, Trash2, Printer, FileSpreadsheet, FileText, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { EwtKind, EwtPeriodMode, EwtProof } from "@/lib/ewt-summary";
import { attachEwtProof, attachEwtProofToUnpaid, removeEwtProof, type EwtActionResult } from "./actions";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Monthly / Quarterly, and which one — the template's row 2, "Generation". */
export function PeriodPicker({ mode, periodKey }: { mode: EwtPeriodMode; periodKey: string }) {
  const router = useRouter();
  const year = Number(periodKey.slice(0, 4));
  const sub = mode === "quarter" ? Number(periodKey.slice(6)) : Number(periodKey.slice(5, 7));
  const go = (m: EwtPeriodMode, y: number, s: number) => {
    const key = m === "quarter" ? `${y}-Q${s}` : `${y}-${String(s).padStart(2, "0")}`;
    router.push(`/reports/ewt-summary?mode=${m}&period=${key}`);
  };
  const years = Array.from({ length: 5 }, (_, i) => new Date().getFullYear() - 3 + i);
  const sel = "h-9 rounded-md border bg-background px-2 text-sm";
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-sm text-muted-foreground">Generation</span>
      <select
        className={sel}
        aria-label="Monthly or quarterly"
        value={mode}
        onChange={(e) => {
          const m = e.target.value as EwtPeriodMode;
          go(m, year, m === "quarter" ? Math.ceil(sub / 3) || 1 : (sub - 1) * 3 + 1);
        }}
      >
        <option value="month">Monthly</option>
        <option value="quarter">Quarterly</option>
      </select>
      <select className={sel} aria-label={mode === "quarter" ? "Quarter" : "Month"} value={sub} onChange={(e) => go(mode, year, Number(e.target.value))}>
        {mode === "quarter"
          ? [1, 2, 3, 4].map((q) => <option key={q} value={q}>Q{q}</option>)
          : MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
      </select>
      <select className={sel} aria-label="Year" value={year} onChange={(e) => go(mode, Number(e.target.value), sub)}>
        {years.map((y) => <option key={y} value={y}>{y}</option>)}
      </select>
    </div>
  );
}

/** Excel / PDF for one table, and print for the page. */
export function ExportButtons({ kind, query }: { kind: EwtKind; query: string }) {
  return (
    <div className="flex flex-wrap gap-2 print:hidden">
      <a href={`/reports/ewt-summary/xlsx?table=${kind}&${query}`} className="inline-flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-xs font-medium hover:bg-accent">
        <FileSpreadsheet className="h-3.5 w-3.5" /> Excel
      </a>
      <a href={`/reports/ewt-summary/pdf?table=${kind}&${query}`} className="inline-flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-xs font-medium hover:bg-accent">
        <FileText className="h-3.5 w-3.5" /> PDF
      </a>
    </div>
  );
}

export function PrintButton() {
  return (
    <Button variant="outline" size="sm" className="print:hidden" onClick={() => window.print()}>
      <Printer className="mr-1.5 h-4 w-4" /> Print
    </Button>
  );
}

async function upload(kind: EwtKind, file: File): Promise<{ path: string; name: string; uploadedAt: string }> {
  const fd = new FormData();
  fd.append("file", file);
  fd.append("kind", kind);
  const res = await fetch("/api/ewt-uploads", { method: "POST", body: fd });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Upload failed");
  return data;
}

function useRunner(onDone?: () => void) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const run = async (fn: () => Promise<EwtActionResult>) => {
    setBusy(true);
    setErr(null);
    try {
      const r = await fn();
      if (!r.ok) setErr(r.error);
      else {
        onDone?.();
        router.refresh();
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  };
  return { busy, err, run };
}

const viewHref = (p: EwtProof, download = false) =>
  `/api/ewt-uploads?path=${encodeURIComponent(p.path)}${download ? `&download=1&name=${encodeURIComponent(p.name)}` : ""}`;

/** The POP column: the proof with its eye view, or an upload. */
export function PopCell({ kind, refKey, pop }: { kind: EwtKind; refKey: string; pop: EwtProof | null }) {
  const input = useRef<HTMLInputElement>(null);
  const { busy, err, run } = useRunner();
  const pick = (f: File | undefined) => f && run(async () => attachEwtProof(kind, refKey, await upload(kind, f)));
  return (
    <div className="min-w-[10.5rem] text-xs">
      <input ref={input} type="file" accept="image/*,application/pdf" className="hidden" onChange={(e) => pick(e.target.files?.[0])} />
      {pop ? (
        <div className="space-y-0.5">
          <div className="flex items-center gap-1.5">
            <span className="max-w-[7rem] truncate" title={pop.name}>{pop.name}</span>
            <a href={viewHref(pop)} target="_blank" rel="noopener noreferrer" title="View" aria-label={`View ${pop.name}`} className="text-primary hover:opacity-80"><Eye className="h-3.5 w-3.5" /></a>
            <a href={viewHref(pop, true)} title="Download" aria-label={`Download ${pop.name}`} className="text-primary hover:opacity-80 print:hidden"><Download className="h-3.5 w-3.5" /></a>
          </div>
          <div className="flex items-center gap-2 text-[11px] text-muted-foreground print:hidden">
            {pop.byName && <span>{pop.byName}</span>}
            <button type="button" disabled={busy} onClick={() => input.current?.click()} className="text-primary hover:underline">Replace</button>
            <button
              type="button"
              disabled={busy}
              onClick={() => window.confirm("Remove this proof? The row will read Unpaid again.") && run(() => removeEwtProof(kind, refKey))}
              className="inline-flex items-center text-destructive hover:underline"
              aria-label="Remove proof"
            >
              <Trash2 className="h-3 w-3" />
            </button>
          </div>
        </div>
      ) : (
        <button type="button" disabled={busy} onClick={() => input.current?.click()} className="inline-flex items-center gap-1 rounded-md border px-2 py-1 font-medium hover:bg-accent print:hidden">
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />} Upload
        </button>
      )}
      {err && <div className="mt-0.5 text-[11px] text-destructive">{err}</div>}
    </div>
  );
}

/**
 * One BIR payment covering several rows: the same proof on each of them — every
 * unpaid row of the period, or just the ones ticked. Rows that already carry a
 * proof keep theirs (`attachEwtProofToUnpaid`).
 */
export function AttachToRows({ kind, refKeys, label, onDone }: { kind: EwtKind; refKeys: string[]; label: string; onDone?: () => void }) {
  const input = useRef<HTMLInputElement>(null);
  const { busy, err, run } = useRunner(onDone);
  if (refKeys.length === 0) return null;
  return (
    <div className="print:hidden">
      <input
        ref={input}
        type="file"
        accept="image/*,application/pdf"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) run(async () => attachEwtProofToUnpaid(kind, refKeys, await upload(kind, f)));
        }}
      />
      <Button size="sm" variant="outline" disabled={busy} onClick={() => input.current?.click()}>
        {busy ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Upload className="mr-1.5 h-4 w-4" />}
        {label}
      </Button>
      {err && <div className="mt-1 text-xs text-destructive">{err}</div>}
    </div>
  );
}
