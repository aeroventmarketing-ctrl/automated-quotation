"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function CancelScheduledButton({ id, onCancel }: { id: string; onCancel: (id: string) => Promise<unknown> }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      disabled={busy}
      onClick={async () => {
        if (!window.confirm("Cancel this scheduled campaign?")) return;
        setBusy(true);
        try { await onCancel(id); router.refresh(); } finally { setBusy(false); }
      }}
      className="text-xs font-medium text-muted-foreground hover:text-destructive disabled:opacity-50"
    >
      {busy ? "…" : "Cancel"}
    </button>
  );
}
