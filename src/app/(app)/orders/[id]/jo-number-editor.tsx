"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { setJobOrderNumbering } from "../actions";

type Dept = "fans" | "duct" | "accessories" | "motor";

/**
 * Admin-only inline editor for a department's Job Order numbering. The printed
 * JO number is AFBM-JO<YY><5-digit base seq> (with an a/b/c suffix when the
 * order carries more than one JO), so the two editable values are the base
 * sequence and the year. Saving renumbers every JO in the department at once.
 */
export function JoNumberEditor({
  orderId,
  dept,
  baseNo,
  baseYear,
}: {
  orderId: string;
  dept: Dept;
  baseNo?: number;
  baseYear?: number;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [seq, setSeq] = useState(baseNo != null ? String(baseNo) : "");
  const [year, setYear] = useState(String(baseYear ?? new Date().getFullYear()));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setErr(null);
    try {
      await setJobOrderNumbering(orderId, dept, Number(seq), Number(year));
      setOpen(false);
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed");
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        title="Edit JO number (admin)"
        onClick={() => setOpen(true)}
        className="inline-flex items-center rounded p-0.5 text-muted-foreground hover:text-[#ED1C24]"
      >
        <Pencil className="h-3 w-3" />
      </button>
    );
  }

  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      <span className="font-mono text-muted-foreground">AFBM-JO</span>
      <Input
        className="h-7 w-14 px-1 text-center font-mono text-xs"
        value={year}
        onChange={(e) => setYear(e.target.value.replace(/[^0-9]/g, ""))}
        title="Year"
      />
      <Input
        className="h-7 w-20 px-1 text-center font-mono text-xs"
        value={seq}
        onChange={(e) => setSeq(e.target.value.replace(/[^0-9]/g, ""))}
        title="Base sequence"
      />
      <Button size="sm" className="h-7 px-2 text-xs" disabled={busy} onClick={save}>
        {busy ? "…" : "Save"}
      </Button>
      <Button
        size="sm"
        variant="outline"
        className="h-7 px-2 text-xs"
        disabled={busy}
        onClick={() => {
          setOpen(false);
          setSeq(baseNo != null ? String(baseNo) : "");
          setYear(String(baseYear ?? new Date().getFullYear()));
          setErr(null);
        }}
      >
        Cancel
      </Button>
      {err && <span className="text-[10px] text-destructive">{err}</span>}
    </span>
  );
}
