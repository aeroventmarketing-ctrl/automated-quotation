"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type { QuotationStatus } from "@prisma/client";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { QuotationStatusBadge } from "@/components/status-badge";
import { formatCurrency, formatDate } from "@/lib/utils";
import { ArrowUp, ArrowDown, Search } from "lucide-react";
import { QuotationActions } from "./quotation-actions";

export interface QuotationRow {
  id: string;
  quoteNumber: string;
  company: string;
  customerId: string;
  preparedByName: string;
  total: number;
  currency: string;
  createdISO: string;
  status: QuotationStatus;
}

type SortKey = "quote" | "customer" | "prepared" | "total" | "created" | "status";
type SortDir = "asc" | "desc";

const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: "created", label: "Created" },
  { value: "quote", label: "Quote #" },
  { value: "customer", label: "Customer" },
  { value: "prepared", label: "Prepared by" },
  { value: "total", label: "Total" },
  { value: "status", label: "Status" },
];

/** Search box + sort controls shown above and below the table (shared state). */
function Controls({
  query,
  setQuery,
  sortKey,
  setSortKey,
  sortDir,
  setSortDir,
  count,
  total,
}: {
  query: string;
  setQuery: (v: string) => void;
  sortKey: SortKey;
  setSortKey: (v: SortKey) => void;
  sortDir: SortDir;
  setSortDir: (v: SortDir) => void;
  count: number;
  total: number;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="relative flex-1 min-w-[12rem]">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search quote #, customer, prepared by, status…"
          className="pl-8"
        />
      </div>
      <div className="flex items-center gap-2">
        <span className="text-sm text-muted-foreground">Sort by</span>
        <Select value={sortKey} onChange={(e) => setSortKey(e.target.value as SortKey)} className="w-40">
          {SORT_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </Select>
        <Button
          variant="outline"
          size="sm"
          title={sortDir === "asc" ? "Ascending" : "Descending"}
          onClick={() => setSortDir(sortDir === "asc" ? "desc" : "asc")}
        >
          {sortDir === "asc" ? <ArrowUp className="h-4 w-4" /> : <ArrowDown className="h-4 w-4" />}
        </Button>
      </div>
      <span className="ml-auto text-xs text-muted-foreground">
        {count === total ? `${total} total` : `${count} of ${total}`}
      </span>
    </div>
  );
}

export function QuotationsTable({ rows, admin = false }: { rows: QuotationRow[]; admin?: boolean }) {
  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("created");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matched = q
      ? rows.filter((r) =>
          `${r.quoteNumber} ${r.company} ${r.preparedByName} ${r.status}`.toLowerCase().includes(q),
        )
      : rows.slice();
    const dir = sortDir === "asc" ? 1 : -1;
    matched.sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case "quote": cmp = a.quoteNumber.localeCompare(b.quoteNumber); break;
        case "customer": cmp = a.company.localeCompare(b.company); break;
        case "prepared": cmp = a.preparedByName.localeCompare(b.preparedByName); break;
        case "total": cmp = a.total - b.total; break;
        case "status": cmp = a.status.localeCompare(b.status); break;
        case "created": cmp = a.createdISO.localeCompare(b.createdISO); break;
      }
      // Stable tiebreaker so equal keys keep a deterministic order.
      if (cmp === 0) cmp = a.createdISO.localeCompare(b.createdISO);
      return cmp * dir;
    });
    return matched;
  }, [rows, query, sortKey, sortDir]);

  const controls = (
    <Controls
      query={query}
      setQuery={setQuery}
      sortKey={sortKey}
      setSortKey={setSortKey}
      sortDir={sortDir}
      setSortDir={setSortDir}
      count={filtered.length}
      total={rows.length}
    />
  );

  return (
    <div className="space-y-3">
      {controls}
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Quote #</TableHead>
            <TableHead>Customer</TableHead>
            <TableHead>Prepared by</TableHead>
            <TableHead className="text-right">Total</TableHead>
            <TableHead>Created</TableHead>
            <TableHead>Status</TableHead>
            {admin && <TableHead className="text-right">Actions</TableHead>}
          </TableRow>
        </TableHeader>
        <TableBody>
          {filtered.map((q) => (
            <TableRow key={q.id}>
              <TableCell>
                <Link href={`/quotations/${q.id}`} className="font-medium hover:underline">
                  {q.quoteNumber}
                </Link>
              </TableCell>
              <TableCell>
                <Link href={`/customers/${q.customerId}`} className="hover:underline" title="View client profile">
                  {q.company}
                </Link>
              </TableCell>
              <TableCell>{q.preparedByName}</TableCell>
              <TableCell className="text-right">{formatCurrency(q.total, q.currency)}</TableCell>
              <TableCell>{formatDate(new Date(q.createdISO))}</TableCell>
              <TableCell><QuotationStatusBadge status={q.status} /></TableCell>
              {admin && (
                <TableCell>
                  <QuotationActions id={q.id} label={q.quoteNumber} />
                </TableCell>
              )}
            </TableRow>
          ))}
          {filtered.length === 0 && (
            <TableRow>
              <TableCell colSpan={admin ? 7 : 6} className="text-center text-muted-foreground">
                {rows.length === 0
                  ? "No quotations yet. Build one from an inquiry."
                  : "No quotations match your search."}
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
      {controls}
    </div>
  );
}
