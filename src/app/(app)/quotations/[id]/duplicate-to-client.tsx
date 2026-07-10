"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { Copy, Search, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { searchCustomers, duplicateQuotationToCustomer } from "../actions";

/**
 * "Duplicate to another client" — copies this quote's line items into a fresh
 * DRAFT for a chosen customer, so an identical RFQ from a different client can be
 * quoted in one click instead of rebuilt.
 */
export function DuplicateToClient({ quotationId }: { quotationId: string }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [results, setResults] = useState<{ id: string; company: string }[]>([]);
  const [searching, setSearching] = useState(false);
  const [pending, startTransition] = useTransition();
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  useEffect(() => {
    const query = q.trim();
    if (!query) { setResults([]); return; }
    setSearching(true);
    const t = setTimeout(async () => {
      try {
        setResults(await searchCustomers(query));
      } finally {
        setSearching(false);
      }
    }, 250);
    return () => clearTimeout(t);
  }, [q]);

  function choose(customerId: string) {
    startTransition(async () => {
      await duplicateQuotationToCustomer(quotationId, customerId);
    });
  }

  return (
    <div className="relative" ref={boxRef}>
      <Button variant="outline" size="sm" onClick={() => setOpen((v) => !v)} disabled={pending}>
        {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Copy className="h-4 w-4" />}
        Duplicate to another client
      </Button>
      {open && (
        <div className="absolute right-0 z-30 mt-1 w-80 rounded-md border bg-background p-2 shadow-lg">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            {/* eslint-disable-next-line jsx-a11y/no-autofocus */}
            <Input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search a client…" className="pl-8" />
          </div>
          <div className="mt-1 max-h-64 overflow-auto">
            {searching && <div className="px-2 py-2 text-sm text-muted-foreground">Searching…</div>}
            {!searching && q.trim() && results.length === 0 && (
              <div className="px-2 py-2 text-sm text-muted-foreground">No client matches “{q.trim()}”.</div>
            )}
            {results.map((c) => (
              <button
                key={c.id}
                type="button"
                disabled={pending}
                onClick={() => choose(c.id)}
                className="block w-full rounded px-2 py-1.5 text-left text-sm hover:bg-muted disabled:opacity-50"
              >
                {c.company}
              </button>
            ))}
          </div>
          <p className="px-2 pt-1 text-[11px] text-muted-foreground">
            Creates a new DRAFT for the chosen client with the same items.
          </p>
        </div>
      )}
    </div>
  );
}
