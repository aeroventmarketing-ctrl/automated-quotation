"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Upload, Trash2, ImageIcon, Eye } from "lucide-react";
import type { SaleDoc } from "@/lib/sale";
import { uploadDocument } from "@/lib/client-upload";
import { addJobOrderProof, removeJobOrderProof } from "../actions";

export interface JobProof extends SaleDoc {
  byName?: string;
}

const docView = (p: JobProof) => `/api/sale-uploads/view?path=${encodeURIComponent(p.path)}&name=${encodeURIComponent(p.name)}`;

/**
 * Proofing pictures attached to a department's job order before it can be marked
 * finished. The department's production head uploads one or more pictures (with
 * an eye-view to open each); anyone who can see the job order can view them.
 */
export function JobOrderProofs({
  orderId,
  deptKey,
  initialProofs,
  canEdit,
}: {
  orderId: string;
  deptKey: string;
  initialProofs: JobProof[];
  canEdit: boolean;
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

  // Nothing to show for a viewer who can't edit and has no proofs yet.
  if (!canEdit && proofs.length === 0) return null;

  return (
    <div className="mb-2 space-y-1 rounded-md border bg-muted/20 p-2">
      <div className="text-[11px] font-medium text-muted-foreground">
        Production proof <span className="font-normal">(picture{proofs.length === 1 ? "" : "s"} required before &ldquo;Mark finished&rdquo;)</span>
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        {proofs.map((p) => (
          <div key={p.path} className="flex items-center gap-1">
            <a
              href={docView(p)}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-xs text-primary underline"
              title={p.byName ? `Uploaded by ${p.byName}` : undefined}
            >
              <ImageIcon className="h-3.5 w-3.5" /> {p.name}
            </a>
            <a
              href={docView(p)}
              target="_blank"
              rel="noopener noreferrer"
              className="text-muted-foreground hover:text-primary"
              title="View"
              aria-label="View"
            >
              <Eye className="h-3.5 w-3.5" />
            </a>
            {canEdit && (
              <button
                type="button"
                className="text-muted-foreground hover:text-destructive"
                onClick={() => remove(p.path)}
                disabled={busy}
                aria-label="Remove"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        ))}
        {canEdit && (
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
