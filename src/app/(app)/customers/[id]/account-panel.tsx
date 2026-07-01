"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDate } from "@/lib/utils";
import { isNextControlFlowError } from "@/lib/utils";
import { ArrowRightLeft } from "lucide-react";
import { transferAccount } from "../actions";

export interface AccountHistoryEntry {
  name: string;
  startedAt: string; // ISO
  endedAt: string | null; // ISO or null (current)
}

export function AccountPanel({
  customerId,
  currentOwnerName,
  history,
  salespeople,
  canTransfer,
}: {
  customerId: string;
  currentOwnerName: string | null;
  history: AccountHistoryEntry[];
  salespeople: { id: string; name: string }[];
  canTransfer: boolean;
}) {
  const router = useRouter();
  const [toUserId, setToUserId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onTransfer() {
    if (!toUserId) return;
    setBusy(true);
    setError(null);
    try {
      await transferAccount(customerId, toUserId);
      setToUserId("");
      router.refresh();
    } catch (e) {
      if (isNextControlFlowError(e)) throw e;
      setError(e instanceof Error ? e.message : "Transfer failed");
    } finally {
      setBusy(false);
    }
  }

  // Show the trail newest-first; the current (open) assignment sits on top.
  const trail = [...history].reverse();

  return (
    <div className="space-y-4">
      <div>
        <div className="text-xs text-muted-foreground">Current</div>
        {currentOwnerName ? (
          <Badge variant="secondary" className="mt-1">{currentOwnerName}</Badge>
        ) : (
          <p className="mt-1 text-sm text-muted-foreground">Unassigned</p>
        )}
      </div>

      {canTransfer && salespeople.length > 0 && (
        <div className="space-y-1">
          <div className="text-xs text-muted-foreground">Transfer account to</div>
          <div className="flex items-center gap-2">
            <Select value={toUserId} onChange={(e) => setToUserId(e.target.value)} className="flex-1">
              <option value="">— choose salesperson —</option>
              {salespeople.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </Select>
            <Button size="sm" onClick={onTransfer} disabled={busy || !toUserId}>
              <ArrowRightLeft className="h-4 w-4" />
              {busy ? "Transferring…" : "Transfer"}
            </Button>
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
      )}

      {trail.length > 0 && (
        <div>
          <div className="mb-1 text-xs text-muted-foreground">History</div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Salesperson</TableHead>
                <TableHead>Start date</TableHead>
                <TableHead>End date</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {trail.map((h, i) => (
                <TableRow key={`${h.name}-${h.startedAt}-${i}`}>
                  <TableCell className="font-medium">
                    {h.name}
                    {!h.endedAt && <Badge variant="secondary" className="ml-2">Current</Badge>}
                  </TableCell>
                  <TableCell>{formatDate(new Date(h.startedAt))}</TableCell>
                  <TableCell>{h.endedAt ? formatDate(new Date(h.endedAt)) : "Present"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
