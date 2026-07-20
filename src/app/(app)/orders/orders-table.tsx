"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { formatCurrency } from "@/lib/utils";
import type { OrderStage, OrderStepKey } from "@/lib/order-workflow";
import { OrderStageActions } from "./order-stage-actions";

export interface OrderRow {
  id: string;
  quoteNumber: string;
  company: string;
  project: string;
  dateMs: number;
  dateText: string;
  currency: string;
  value: number;
  collected: number;
  balance: number;
  arrangement: string;
  status: string;
  sales: string;
  stage: OrderStage;
  stageText: string;
  prodDepts: string[];
  nextStep: OrderStepKey | null;
  nextLabel: string | null;
  canAct: boolean;
  blockedReason: string | null;
  awaiting: string | null;
}

type SortKey = "date" | "value" | "collected" | "balance" | "company" | "status" | "stage" | "sales";
type GroupKey = "none" | "status" | "stage" | "sales" | "company" | "arrangement";

const SORT_OPTIONS: { key: SortKey; label: string }[] = [
  { key: "date", label: "Date" },
  { key: "value", label: "Value" },
  { key: "collected", label: "Collected" },
  { key: "balance", label: "Balance" },
  { key: "company", label: "Client" },
  { key: "status", label: "Status" },
  { key: "stage", label: "Order stage" },
  { key: "sales", label: "Sales" },
];
const GROUP_OPTIONS: { key: GroupKey; label: string }[] = [
  { key: "none", label: "No grouping" },
  { key: "status", label: "Status" },
  { key: "stage", label: "Order stage" },
  { key: "sales", label: "Sales" },
  { key: "company", label: "Client" },
  { key: "arrangement", label: "Terms" },
];

const statusVariant = (s: string): "success" | "warning" | "secondary" => (s === "Paid" ? "success" : s === "Partial" ? "warning" : "secondary");

export function OrdersTable({
  orders,
  progressHidden,
  initialStage,
  initialStageLabel,
  initialDept,
  initialDeptLabel,
}: {
  orders: OrderRow[];
  progressHidden: boolean;
  initialStage?: string;
  initialStageLabel?: string;
  initialDept?: string;
  initialDeptLabel?: string;
}) {
  const [sortKey, setSortKey] = useState<SortKey>("date");
  const [dir, setDir] = useState<"asc" | "desc">("desc");
  const [group, setGroup] = useState<GroupKey>("none");
  const [query, setQuery] = useState("");

  // A drill-down filter from the Management dashboard (a stage or a department).
  const filterLabel = initialStageLabel ?? initialDeptLabel ?? null;
  const base = useMemo(() => {
    return orders.filter((o) => {
      if (initialStage && o.stage !== initialStage) return false;
      if (initialDept && !o.prodDepts.includes(initialDept)) return false;
      return true;
    });
  }, [orders, initialStage, initialDept]);

  // Search across order no., client (company + project), date, and sales.
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return base;
    return base.filter((o) =>
      [o.quoteNumber, o.company, o.project, o.dateText, o.sales].some((f) => (f ?? "").toLowerCase().includes(q)),
    );
  }, [base, query]);

  const groupValue = (o: OrderRow): string => {
    switch (group) {
      case "status": return o.status;
      case "stage": return o.stageText;
      case "sales": return o.sales || "—";
      case "company": return o.company;
      case "arrangement": return o.arrangement || "—";
      default: return "";
    }
  };

  const sorted = useMemo(() => {
    const mul = dir === "asc" ? 1 : -1;
    const cmp = (a: OrderRow, b: OrderRow): number => {
      switch (sortKey) {
        case "value": return (a.value - b.value) * mul;
        case "collected": return (a.collected - b.collected) * mul;
        case "balance": return (a.balance - b.balance) * mul;
        case "company": return a.company.localeCompare(b.company) * mul;
        case "status": return a.status.localeCompare(b.status) * mul;
        case "stage": return a.stageText.localeCompare(b.stageText) * mul;
        case "sales": return (a.sales || "").localeCompare(b.sales || "") * mul;
        default: return (a.dateMs - b.dateMs) * mul;
      }
    };
    return [...filtered].sort(cmp);
  }, [filtered, sortKey, dir]);

  // Build groups (in first-appearance order of the sorted rows).
  const groups = useMemo(() => {
    if (group === "none") return [{ key: "", rows: sorted }];
    const map = new Map<string, OrderRow[]>();
    for (const o of sorted) {
      const k = groupValue(o);
      (map.get(k) ?? map.set(k, []).get(k)!).push(o);
    }
    return [...map.entries()].map(([key, rows]) => ({ key, rows }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sorted, group]);

  const currency = orders[0]?.currency ?? "PHP";

  return (
    <div className="space-y-3">
      {filterLabel && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted-foreground">Showing orders in</span>
          <span className="inline-flex items-center gap-1.5 rounded-full border bg-primary/5 px-2.5 py-1 text-xs font-medium text-primary">
            {initialStageLabel ? "Stage" : "Department"}: {filterLabel}
            <Link href="/orders" className="ml-0.5 rounded-full text-primary/70 hover:text-primary" aria-label="Clear filter" title="Clear filter">✕</Link>
          </span>
          <span className="text-xs text-muted-foreground">{base.length} order{base.length === 1 ? "" : "s"}</span>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative">
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search order, client, date, sales…"
            className="h-8 w-64 rounded-md border bg-background px-3 text-sm"
          />
        </div>
        <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
          Group by
          <select value={group} onChange={(e) => setGroup(e.target.value as GroupKey)} className="h-8 rounded-md border bg-background px-2 text-sm text-foreground">
            {GROUP_OPTIONS.map((g) => <option key={g.key} value={g.key}>{g.label}</option>)}
          </select>
        </label>
        <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
          Sort by
          <select value={sortKey} onChange={(e) => setSortKey(e.target.value as SortKey)} className="h-8 rounded-md border bg-background px-2 text-sm text-foreground">
            {SORT_OPTIONS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
          </select>
        </label>
        <button
          type="button"
          onClick={() => setDir((d) => (d === "asc" ? "desc" : "asc"))}
          className="inline-flex h-8 items-center gap-1 rounded-md border bg-background px-2.5 text-sm hover:bg-accent"
          title={dir === "asc" ? "Ascending" : "Descending"}
        >
          {dir === "asc" ? "↑ Asc" : "↓ Desc"}
        </button>
      </div>

      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Order</TableHead>
              <TableHead>Client</TableHead>
              <TableHead>Date</TableHead>
              <TableHead>Terms</TableHead>
              <TableHead className="text-right">Value</TableHead>
              <TableHead className="text-right">Collected</TableHead>
              <TableHead className="text-right">Balance</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Order stage</TableHead>
              <TableHead>Sales</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sorted.length === 0 ? (
              <TableRow>
                <TableCell colSpan={10} className="py-8 text-center text-sm text-muted-foreground">
                  {query ? <>No orders match &ldquo;{query}&rdquo;{filterLabel ? ` in ${filterLabel}` : ""}.</> : filterLabel ? `No orders in ${filterLabel} right now.` : "No orders."}
                </TableCell>
              </TableRow>
            ) : (
              groups.map((g) => (
                <GroupRows key={g.key} groupKey={g.key} rows={g.rows} showHeader={group !== "none"} currency={currency} progressHidden={progressHidden} />
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

function GroupRows({ groupKey, rows, showHeader, currency, progressHidden }: { groupKey: string; rows: OrderRow[]; showHeader: boolean; currency: string; progressHidden: boolean }) {
  const total = rows.reduce((a, o) => a + o.value, 0);
  return (
    <>
      {showHeader && (
        <TableRow className="bg-muted/40">
          <TableCell colSpan={10} className="py-1.5">
            <span className="text-sm font-semibold">{groupKey || "—"}</span>
            <span className="ml-2 text-xs text-muted-foreground">{rows.length} order{rows.length === 1 ? "" : "s"} · {formatCurrency(total, currency)}</span>
          </TableCell>
        </TableRow>
      )}
      {rows.map((o) => (
        <TableRow key={o.id}>
          <TableCell>
            <Link href={`/quotations/${o.id}`} className="font-medium text-primary hover:underline">{o.quoteNumber}</Link>
          </TableCell>
          <TableCell>
            <div className="font-medium">{o.company}</div>
            {o.project && <div className="text-xs text-muted-foreground">{o.project}</div>}
          </TableCell>
          <TableCell className="whitespace-nowrap text-sm">{o.dateText}</TableCell>
          <TableCell className="text-xs text-muted-foreground">{o.arrangement}</TableCell>
          <TableCell className="text-right tabular-nums">{formatCurrency(o.value, o.currency)}</TableCell>
          <TableCell className="text-right tabular-nums">{formatCurrency(o.collected, o.currency)}</TableCell>
          <TableCell className="text-right tabular-nums">{formatCurrency(o.balance, o.currency)}</TableCell>
          <TableCell><Badge variant={statusVariant(o.status)}>{o.status}</Badge></TableCell>
          <TableCell>
            <OrderStageActions
              orderId={o.id}
              stage={o.stage}
              stageLabel={o.stageText}
              nextStep={o.nextStep}
              nextLabel={o.nextLabel}
              canAct={o.canAct}
              blockedReason={o.blockedReason}
              awaiting={o.awaiting}
              hideStage={progressHidden}
            />
          </TableCell>
          <TableCell className="text-sm text-muted-foreground">{o.sales}</TableCell>
        </TableRow>
      ))}
    </>
  );
}
