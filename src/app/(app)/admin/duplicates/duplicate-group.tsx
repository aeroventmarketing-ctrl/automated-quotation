"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { deleteCustomer, mergeCustomers } from "./actions";

export type DupRecord = {
  id: string;
  company: string;
  contactName: string | null;
  email: string | null;
  phone: string | null;
  inquiryCount: number;
  salesNames: string[];
};

export function DuplicateGroup({
  fieldLabel,
  display,
  records,
  sameSalesperson,
}: {
  fieldLabel: string;
  display: string;
  records: DupRecord[];
  sameSalesperson: boolean;
}) {
  const router = useRouter();
  const [keepId, setKeepId] = useState(records[0]?.id ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function onMerge() {
    setErr(null);
    const others = records.filter((r) => r.id !== keepId).map((r) => r.id);
    const keeper = records.find((r) => r.id === keepId);
    if (
      !window.confirm(
        `Merge ${others.length} record(s) into "${keeper?.company}"? Their inquiries move to the kept record and the duplicates are deleted. This can't be undone.`,
      )
    )
      return;
    setBusy(true);
    try {
      await mergeCustomers(keepId, others);
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Merge failed");
    } finally {
      setBusy(false);
    }
  }

  async function onDelete(r: DupRecord) {
    setErr(null);
    if (
      !window.confirm(
        `Delete "${r.company}"${r.contactName ? ` (${r.contactName})` : ""}? This permanently removes the client${
          r.inquiryCount ? ` and its ${r.inquiryCount} inquiry/quotation record(s)` : ""
        }. This can't be undone.`,
      )
    )
      return;
    setBusy(true);
    try {
      await deleteCustomer(r.id);
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Delete failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">
          {fieldLabel}: <span className="font-bold">{display || "—"}</span>{" "}
          <span className="font-normal text-muted-foreground">· {records.length} records</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {records.map((r) => (
          <div key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border p-2 text-sm">
            <label className="flex items-center gap-1" title="Keep this record when merging">
              <input
                type="radio"
                name={`keep-${display}`}
                checked={keepId === r.id}
                disabled={busy}
                onChange={() => setKeepId(r.id)}
              />
              <span className="text-xs text-muted-foreground">keep</span>
            </label>
            <Link href={`/customers/${r.id}`} className="font-medium hover:underline" target="_blank">
              {r.company}
            </Link>
            <span className="text-muted-foreground">{r.contactName || "—"}</span>
            <span className="text-muted-foreground">{r.email || "—"}</span>
            <span className="text-muted-foreground">{r.phone || "—"}</span>
            <span className="text-xs text-muted-foreground">
              {r.salesNames.length ? r.salesNames.join(", ") : "no salesperson"}
            </span>
            <span className="ml-auto flex items-center gap-3">
              <span className="text-xs text-muted-foreground">
                {r.inquiryCount} inquir{r.inquiryCount === 1 ? "y" : "ies"}
              </span>
              <Button variant="outline" size="sm" disabled={busy} onClick={() => onDelete(r)}>
                Delete
              </Button>
            </span>
          </div>
        ))}

        <div className="flex flex-wrap items-center gap-3 pt-1">
          <Button size="sm" disabled={busy || !sameSalesperson} onClick={onMerge}>
            Merge into kept record
          </Button>
          {!sameSalesperson && (
            <span className="text-xs text-muted-foreground">
              Different sales personnel — merging is disabled. Only same-owner duplicates can be merged.
            </span>
          )}
          {err && <span className="text-xs text-destructive">{err}</span>}
        </div>
      </CardContent>
    </Card>
  );
}
