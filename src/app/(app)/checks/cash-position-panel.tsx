"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCurrency, formatDateTime } from "@/lib/utils";
import type { CashPosition } from "@/lib/cash-position";
import { saveCashPositionAction } from "../orders/actions";

/**
 * The cash position under the register, laid out as the owner's own sheet:
 * Total First Priority · COB · Remaining COB · COH · Collectibles ·
 * Cash/Gcash/Checking · Remaining Cash · Dispensable Cash · Total Payables ·
 * Deficit.
 *
 * Two of those ten rows are typed in by the owner (COB, and the three cash
 * lines); the rest are derived — from those, and from the checks in the table
 * above, so the panel can never disagree with the register it sits under.
 */
export function CashPositionPanel({ pos, admin }: { pos: CashPosition; admin: boolean }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [f, setF] = useState({
    cob: String(pos.cob), coh: String(pos.coh),
    collectibles: String(pos.collectibles), cashGcashChecking: String(pos.cashGcashChecking),
  });

  const peso = (n: number) => formatCurrency(n, "PHP");

  async function save() {
    setBusy(true);
    setErr(null);
    try {
      const res = await saveCashPositionAction({
        cob: Number(f.cob) || 0, coh: Number(f.coh) || 0,
        collectibles: Number(f.collectibles) || 0, cashGcashChecking: Number(f.cashGcashChecking) || 0,
      });
      if (res.error) { setErr(res.error); return; }
      setEditing(false);
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not save.");
    } finally {
      setBusy(false);
    }
  }

  /** One line of the sheet. `tone` mirrors the owner's own highlighting. */
  const Row = ({ label, value, tone, strong, indent }: {
    label: string; value: number; tone?: string; strong?: boolean; indent?: boolean;
  }) => (
    <div className={`flex items-baseline justify-between gap-4 rounded px-2 py-1 ${tone ?? ""}`}>
      <span className={`${strong ? "font-semibold" : ""} ${indent ? "pl-3 text-muted-foreground" : ""}`}>{label}</span>
      <span className={`tabular-nums ${strong ? "font-semibold" : ""}`}>{peso(value)}</span>
    </div>
  );

  const Field = ({ label, k }: { label: string; k: keyof typeof f }) => (
    <label className="flex items-center justify-between gap-3 px-2 py-1">
      <span className="text-muted-foreground">{label}</span>
      <Input
        className="h-8 w-40 text-right tabular-nums"
        inputMode="decimal"
        value={f[k]}
        onChange={(e) => setF({ ...f, [k]: e.target.value })}
      />
    </label>
  );

  return (
    <Card>
      <CardHeader className="flex-row flex-wrap items-center justify-between gap-2 space-y-0 pb-2">
        <CardTitle className="flex items-center gap-2 text-sm">
          <Wallet className="h-4 w-4 text-muted-foreground" /> Cash position
        </CardTitle>
        {admin && !editing && (
          <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setEditing(true)}>
            <Pencil className="mr-1 h-3.5 w-3.5" /> Edit cash figures
          </Button>
        )}
      </CardHeader>
      <CardContent className="space-y-0.5 text-sm">
        {/* Rule 1 — what the bank can take today. */}
        <Row label="TOTAL FIRST PRIORITY" value={pos.firstPriority} tone="bg-emerald-100 text-emerald-900" strong />

        {editing ? (
          <>
            <Field label="COB — Cash on Bank" k="cob" />
            <Row label="Remaining COB" value={Number(f.cob) - pos.firstPriority} tone="bg-orange-100 text-orange-900" strong />
            <Field label="COH — Cash on Hand" k="coh" />
            <Field label="Collectibles" k="collectibles" />
            <Field label="Cash / Gcash / Checking" k="cashGcashChecking" />
            {err && <p className="px-2 text-xs text-destructive">{err}</p>}
            <div className="flex justify-end gap-1.5 px-2 pt-2">
              <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => { setEditing(false); setErr(null); }}>Cancel</Button>
              <Button size="sm" className="h-7 text-xs" disabled={busy} onClick={save}>{busy ? "Saving…" : "Save"}</Button>
            </div>
          </>
        ) : (
          <>
            <Row label="COB" value={pos.cob} />
            {/* Rule 3 — COB less what clears now. */}
            <Row label="Remaining COB" value={pos.remainingCob} tone="bg-orange-100 text-orange-900" strong />
            <Row label="COH" value={pos.coh} />
            <Row label="Collectibles" value={pos.collectibles} />
            <Row label="Cash / Gcash / Checking" value={pos.cashGcashChecking} />
            {/* Rules 5 and 6 — the same figure, both names, as the sheet shows. */}
            <Row label="Remaining Cash" value={pos.remainingCash} />
            <Row label="Dispensable Cash" value={pos.dispensableCash} strong />
            {/* Rules 7 and 8. */}
            <Row label="Total Payables" value={pos.totalPayables} />
            <Row
              label="Deficit"
              value={pos.deficit}
              strong
              tone={pos.deficit > 0 ? "bg-destructive/10 text-destructive" : "bg-emerald-50 text-emerald-700"}
            />
          </>
        )}
      </CardContent>
      {!editing && (
        <div className="px-6 pb-3 text-xs text-muted-foreground">
          First Priority and Total Payables come from the checks above. COB, COH, Collectibles and
          Cash/Gcash/Checking are entered by hand
          {pos.updatedAt ? ` — last by ${pos.updatedByName || "an admin"} on ${formatDateTime(new Date(pos.updatedAt))}` : " and have not been set yet"}.
        </div>
      )}
    </Card>
  );
}
