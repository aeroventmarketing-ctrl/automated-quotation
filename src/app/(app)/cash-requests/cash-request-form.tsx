"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CASH_CATEGORIES } from "@/lib/cash-request";
import { createCashRequest } from "./actions";

interface Line { description: string; amount: string }
const emptyLine = (): Line => ({ description: "", amount: "" });
const peso = (n: number) => "₱" + new Intl.NumberFormat("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
const num = (s: string) => Number(String(s ?? "").replace(/,/g, "").trim()) || 0;

/** Raise a cash request — general money request (advance / reimbursement / expense). */
export function CashRequestForm({ depts }: { depts: { key: string; label: string }[] }) {
  const router = useRouter();
  const [purpose, setPurpose] = useState("");
  const [category, setCategory] = useState<string>(CASH_CATEGORIES[0].key);
  const [dept, setDept] = useState("");
  const [amount, setAmount] = useState("");
  const [lines, setLines] = useState<Line[]>([emptyLine()]);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const linesTotal = useMemo(() => lines.reduce((a, l) => a + num(l.amount), 0), [lines]);
  // The requested amount: the explicit figure, else the sum of the breakdown.
  const effectiveAmount = amount.trim() !== "" ? num(amount) : linesTotal;

  function setLine(i: number, key: keyof Line, value: string) {
    setLines((ls) => ls.map((l, idx) => (idx === i ? { ...l, [key]: value } : l)));
  }

  async function submit() {
    setBusy(true); setErr(null); setMsg(null);
    try {
      await createCashRequest({
        purpose,
        category,
        dept: dept || null,
        amount: amount.trim() !== "" ? amount : undefined,
        lines: lines.filter((l) => l.description.trim() !== "" || l.amount.trim() !== ""),
        note,
      });
      setPurpose(""); setCategory(CASH_CATEGORIES[0].key); setDept(""); setAmount(""); setLines([emptyLine()]); setNote("");
      setMsg("Cash request submitted.");
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader className="pb-2"><CardTitle className="text-sm">New cash request</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-muted-foreground">Request cash from Accounting — a cash advance, reimbursement or expense. Accounting prepares a voucher, the Approver approves &amp; releases the cash, then Accounting hands it to you. You liquidate it afterwards with receipts.</p>

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="space-y-1 text-sm">
            <span className="text-xs text-muted-foreground">What is the cash for?</span>
            <Input value={purpose} onChange={(e) => setPurpose(e.target.value)} placeholder="e.g. Cash advance for delivery fuel & tolls" />
          </label>
          <label className="space-y-1 text-sm">
            <span className="text-xs text-muted-foreground">Type</span>
            <select value={category} onChange={(e) => setCategory(e.target.value)} className="h-9 w-full rounded-md border bg-background px-2 text-sm">
              {CASH_CATEGORIES.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
            </select>
          </label>
          <label className="space-y-1 text-sm">
            <span className="text-xs text-muted-foreground">Department (optional)</span>
            <select value={dept} onChange={(e) => setDept(e.target.value)} className="h-9 w-full rounded-md border bg-background px-2 text-sm">
              <option value="">— none —</option>
              {depts.map((d) => <option key={d.key} value={d.key}>{d.label}</option>)}
            </select>
          </label>
          <label className="space-y-1 text-sm">
            <span className="text-xs text-muted-foreground">Amount (₱){amount.trim() === "" && linesTotal > 0 ? " — leave blank to use the breakdown total" : ""}</span>
            <Input value={amount} onChange={(e) => setAmount(e.target.value)} placeholder={linesTotal > 0 ? linesTotal.toFixed(2) : "0.00"} className="text-right" />
          </label>
        </div>

        <div className="space-y-1">
          <div className="text-xs text-muted-foreground">Breakdown (optional)</div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[420px] border-collapse text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-muted-foreground">
                  <th className="py-1 pr-2 font-medium">Description</th>
                  <th className="w-32 py-1 px-1 text-right font-medium">Amount (₱)</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((l, i) => (
                  <tr key={i} className="border-b last:border-0">
                    <td className="py-1 pr-2"><input value={l.description} onChange={(e) => setLine(i, "description", e.target.value)} className="w-full rounded border bg-background px-2 py-1" placeholder="What this part of the cash is for" /></td>
                    <td className="py-1 px-1"><input value={l.amount} onChange={(e) => setLine(i, "amount", e.target.value)} className="w-full rounded border bg-background px-1 py-1 text-right" placeholder="0.00" /></td>
                  </tr>
                ))}
              </tbody>
              {linesTotal > 0 && (
                <tfoot>
                  <tr className="border-t font-medium">
                    <td className="py-1 pr-2 text-right text-xs text-muted-foreground">Breakdown total</td>
                    <td className="py-1 px-1 text-right tabular-nums">{peso(linesTotal)}</td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
          <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setLines((ls) => [...ls, emptyLine()])}>+ Add line</Button>
        </div>

        <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (optional)" className="h-9" />

        <div className="flex flex-wrap items-center gap-3">
          <Button size="sm" disabled={busy || purpose.trim() === "" || effectiveAmount <= 0} onClick={submit}>
            {busy ? "Submitting…" : `Request ${effectiveAmount > 0 ? peso(effectiveAmount) : "cash"}`}
          </Button>
          {msg && <span className="text-xs text-emerald-600">{msg}</span>}
          {err && <span className="text-xs text-destructive">{err}</span>}
        </div>
      </CardContent>
    </Card>
  );
}
