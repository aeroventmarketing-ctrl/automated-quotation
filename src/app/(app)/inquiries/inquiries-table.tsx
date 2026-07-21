"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { InquiryStatus } from "@prisma/client";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { InquiryStatusBadge } from "@/components/status-badge";
import { formatDate, formatTime } from "@/lib/utils";
import { ArrowUp, ArrowDown, Search, ChevronLeft, ChevronRight } from "lucide-react";
import { InquiryActions } from "./inquiry-actions";

export interface InquiryRow {
  id: string;
  company: string;
  customerId: string;
  createdByName: string;
  source: string;
  items: number;
  quotes: number;
  createdISO: string;
  status: InquiryStatus;
}

type SortKey = "customer" | "sales" | "source" | "items" | "quotes" | "created" | "status";
type SortDir = "asc" | "desc";

const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: "created", label: "Created" },
  { value: "customer", label: "Customer" },
  { value: "sales", label: "Sales" },
  { value: "source", label: "Source" },
  { value: "items", label: "Items" },
  { value: "quotes", label: "Quotes" },
  { value: "status", label: "Status" },
];

export function InquiriesTable({
  rows,
  admin,
  total,
  page,
  pageSize,
  query,
  sort,
  dir,
}: {
  rows: InquiryRow[];
  admin: boolean;
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

  const [queryInput, setQueryInput] = useState(query);
  // While the box is focused the user is typing; the debounced push below round-
  // trips through the server, which echoes back a (now stale) `query` prop. Adopting
  // it mid-type would clobber the newer text and drop keystrokes — so only sync from
  // the prop when the box is NOT focused (e.g. browser back/forward, cleared filter).
  const focusedRef = useRef(false);
  useEffect(() => {
    if (!focusedRef.current) setQueryInput(query);
  }, [query]);

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
          onFocus={() => { focusedRef.current = true; }}
          onBlur={() => { focusedRef.current = false; }}
          placeholder="Search customer, source, status…"
          className="pl-8"
        />
      </div>
      <div className="flex items-center gap-2">
        <span className="text-sm text-muted-foreground">Sort by</span>
        <Select
          value={sort}
          onChange={(e) => setParams({ sort: e.target.value, page: null })}
          className="w-36"
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
            <TableHead>Customer</TableHead>
            <TableHead>Source</TableHead>
            <TableHead>Items</TableHead>
            <TableHead>Quotes</TableHead>
            <TableHead>Created</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((inq) => (
            <TableRow key={inq.id} className="cursor-pointer">
              <TableCell>
                <Link href={`/customers/${inq.customerId}`} className="font-medium hover:underline" title="View client profile">
                  {inq.company}
                </Link>
                <div className="text-xs text-muted-foreground">by {inq.createdByName}</div>
              </TableCell>
              <TableCell>{inq.source}</TableCell>
              <TableCell>{inq.items}</TableCell>
              <TableCell>{inq.quotes}</TableCell>
              <TableCell>
                <div>{formatDate(new Date(inq.createdISO))}</div>
                <div className="text-xs text-muted-foreground">{formatTime(new Date(inq.createdISO))}</div>
              </TableCell>
              <TableCell>
                <InquiryStatusBadge status={inq.status} />
              </TableCell>
              <TableCell>
                <InquiryActions id={inq.id} label={inq.company} admin={admin} />
              </TableCell>
            </TableRow>
          ))}
          {rows.length === 0 && (
            <TableRow>
              <TableCell colSpan={7} className="text-center text-muted-foreground">
                {total === 0 && !query ? "No inquiries yet." : "No inquiries match your search."}
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
      {controls}
    </div>
  );
}
