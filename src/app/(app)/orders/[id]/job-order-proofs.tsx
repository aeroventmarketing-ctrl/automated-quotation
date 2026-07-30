"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Upload } from "lucide-react";
import { UploadLink } from "@/components/upload-link";
import type { SaleDoc } from "@/lib/sale";
import { uploadDocument } from "@/lib/client-upload";
import { addJobOrderProof, removeJobOrderProof } from "../actions";

export interface JobProof extends SaleDoc {
  byName?: string;
}

/**
 * Proofing pictures attached to a department's job order. The production head
 * (or admin) uploads one or more pictures — at least one is required before
 * "Mark finished", and more may be added afterwards. Anyone who can see the job
 * order gets the view (eye) / download link. The dept head can remove a proof
 * while the job order is open; an admin can remove any proof at any time.
 */
export function JobOrderProofs({
  orderId,
  deptKey,
  initialProofs,
  canAdd,
  canRemove,
}: {
  orderId: string;
  deptKey: string;
  initialProofs: JobProof[];
  canAdd: boolean;
  canRemove: boolean;
}) {
  const router = useRouter();
  const [proofs, setProofs] = useState<JobProof[]>(initialProofs);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function upload(files: FileList) {
    setBusy(true);
    setErr(null);
    try {
      for (const file of Array.from(files)) {
        const data = (await uploadDocument("/api/sale-uploads", file, { quotationId: orderId })) as SaleDoc;
        await addJobOrderProof(orderId, deptKey, data);
        setProofs((ps) => [...ps, data]);
      }
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setBusy(false);
    }
  }

  async function remove(path: string) {
    setBusy(true);
    setErr(null);
    try {
      await removeJobOrderProof(orderId, deptKey, path);
      setProofs((ps) => ps.filter((x) => x.path !== path));
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  // Nothing to show for a plain viewer with no proofs yet.
  if (!canAdd && !canRemove && proofs.length === 0) return null;

  return (
    <div className="mb-2 space-y-1 rounded-md border bg-muted/20 p-2">
      <div className="text-[11px] font-medium text-muted-foreground">
        Production proof <span className="font-normal">(picture{proofs.length === 1 ? "" : "s"} required before &ldquo;Mark finished&rdquo;)</span>
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        {proofs.map((p) => (
          <span key={p.path} className="inline-flex items-center gap-1.5">
            <UploadLink
              doc={{ path: p.path, name: p.name }}
              base="/api/sale-uploads"
              size="xs"
              busy={busy}
              onRemove={canRemove ? () => remove(p.path) : undefined}
            />
            {p.byName && <span className="text-[10px] text-muted-foreground">· {p.byName}</span>}
          </span>
        ))}
        {proofs.length === 0 && <span className="text-xs text-muted-foreground">No pictures yet.</span>}
        {canAdd && (
          <label className="inline-flex cursor-pointer items-center gap-1 rounded-md border px-2 py-1 text-xs hover:bg-accent">
            <Upload className="h-3.5 w-3.5" /> {busy ? "Uploading…" : proofs.length ? "Add pictures" : "Upload pictures"}
            <input
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              disabled={busy}
              onChange={(e) => {
                if (e.target.files?.length) upload(e.target.files);
                e.target.value = "";
              }}
            />
          </label>
        )}
      </div>
      {err && <p className="text-[11px] text-destructive">{err}</p>}
    </div>
  );
}
