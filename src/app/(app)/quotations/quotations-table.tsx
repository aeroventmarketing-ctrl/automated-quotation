"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { QuotationStatus } from "@prisma/client";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { QuotationStatusBadge } from "@/components/status-badge";
import { formatCurrency, formatDate } from "@/lib/utils";
import { ArrowUp, ArrowDown, Search, ChevronLeft, ChevronRight, Copy } from "lucide-react";
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
  dupCount?: number;
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

export function QuotationsTable({
  rows,
  admin = false,
  total,
  page,
  pageSize,
  query,
  sort,
  dir,
}: {
  rows: QuotationRow[];
  admin?: boolean;
  total: number;
  page: number;
  pageSize: number;
  query: string;
  sort: SortKey;
  dir: SortDir;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  // Local, debounced search box → the `q` URL param (server re-queries).
  const [queryInput, setQueryInput] = useState(query);
  useEffect(() => setQueryInput(query), [query]);

  function setParams(updates: Record<string, string | null>) {
    const sp = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(updates)) {
      if (v == null || v === "") sp.delete(k);
      else sp.set(k, v);
    }
    router.replace(`${pathname}?${sp.toString()}`, { scroll: false });
  }

  useEffect(() => {
    if (queryInput === query) return;
    const t = setTimeout(() => setParams({ q: queryInput || null, page: null }), 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queryInput]);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);

  const controls = (
    <div className="flex flex-wrap items-center gap-2">
      <div className="relative flex-1 min-w-[12rem]">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={queryInput}
          onChange={(e) => setQueryInput(e.target.value)}
          placeholder="Search quote #, customer, prepared by, status…"
          className="pl-8"
        />
      </div>
      <div className="flex items-center gap-2">
        <span className="text-sm text-muted-foreground">Sort by</span>
        <Select
          value={sort}
          onChange={(e) => setParams({ sort: e.target.value, page: null })}
          className="w-40"
        >
          {SORT_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </Select>
        <Button
          variant="outline"
          size="sm"
          title={dir === "asc" ? "Ascending" : "Descending"}
          onClick={() => setParams({ dir: dir === "asc" ? "desc" : "asc", page: null })}
        >
          {dir === "asc" ? <ArrowUp className="h-4 w-4" /> : <ArrowDown className="h-4 w-4" />}
        </Button>
      </div>
      <div className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
        <span>{total === 0 ? "0" : `${from.toLocaleString()}–${to.toLocaleString()}`} of {total.toLocaleString()}</span>
        <Button
          variant="outline"
          size="sm"
          disabled={page <= 1}
          title="Previous page"
          onClick={() => setParams({ page: String(page - 1) })}
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <span className="tabular-nums">{page} / {totalPages}</span>
        <Button
          variant="outline"
          size="sm"
          disabled={page >= totalPages}
          title="Next page"
          onClick={() => setParams({ page: String(page + 1) })}
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
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
          {rows.map((q) => (
            <TableRow key={q.id}>
              <TableCell>
                <Link href={`/quotations/${q.id}`} className="font-medium hover:underline">
                  {q.quoteNumber}
                </Link>
                {!!q.dupCount && (
                  <span
                    title={`${q.dupCount} other quote${q.dupCount > 1 ? "s have" : " has"} the same items`}
                    className="ml-2 inline-flex items-center gap-0.5 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-800 dark:bg-amber-950/40 dark:text-amber-300"
                  >
                    <Copy className="h-3 w-3" /> {q.dupCount}
                  </span>
                )}
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
          {rows.length === 0 && (
            <TableRow>
              <TableCell colSpan={admin ? 7 : 6} className="text-center text-muted-foreground">
                {total === 0 && !query
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
