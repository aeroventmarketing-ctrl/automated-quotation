"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type { InquiryStatus } from "@prisma/client";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { InquiryStatusBadge } from "@/components/status-badge";
import { formatDate } from "@/lib/utils";
import { ArrowUp, ArrowDown, Search } from "lucide-react";
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
          placeholder="Search customer, source, status…"
          className="pl-8"
        />
      </div>
      <div className="flex items-center gap-2">
        <span className="text-sm text-muted-foreground">Sort by</span>
        <Select value={sortKey} onChange={(e) => setSortKey(e.target.value as SortKey)} className="w-36">
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

export function InquiriesTable({ rows, admin }: { rows: InquiryRow[]; admin: boolean }) {
  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("created");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matched = q
      ? rows.filter((r) =>
          `${r.company} ${r.createdByName} ${r.source} ${r.status}`.toLowerCase().includes(q),
        )
      : rows.slice();
    const dir = sortDir === "asc" ? 1 : -1;
    matched.sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case "customer": cmp = a.company.localeCompare(b.company); break;
        case "sales": cmp = a.createdByName.localeCompare(b.createdByName); break;
        case "source": cmp = a.source.localeCompare(b.source); break;
        case "items": cmp = a.items - b.items; break;
        case "quotes": cmp = a.quotes - b.quotes; break;
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
          {filtered.map((inq) => (
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
              <TableCell>{formatDate(new Date(inq.createdISO))}</TableCell>
              <TableCell>
                <InquiryStatusBadge status={inq.status} />
              </TableCell>
              <TableCell>
                <InquiryActions id={inq.id} label={inq.company} admin={admin} />
              </TableCell>
            </TableRow>
          ))}
          {filtered.length === 0 && (
            <TableRow>
              <TableCell colSpan={7} className="text-center text-muted-foreground">
                {rows.length === 0 ? "No inquiries yet." : "No inquiries match your search."}
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
      {controls}
    </div>
  );
}
