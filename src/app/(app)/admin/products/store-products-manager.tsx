"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { saveStoreListing, setStoreListed } from "../actions";

export interface StorePhoto {
  path: string;
  alt?: string;
}
export interface StoreRow {
  id: string;
  modelCode: string;
  name: string;
  family: string;
  variants: number;
  aeroquotePrice: number | null;
  websitePrice: number | null;
  quoteOnly: boolean;
  defaultCategory: string;
  storeListed: boolean;
  storeSlug: string | null;
  storeCategory: string | null;
  storeDescription: string | null;
  storePhotos: StorePhoto[];
}

const peso = (n: number | null) =>
  n == null ? "—" : new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP", maximumFractionDigits: 0 }).format(n);

type Filter = "all" | "listed" | "draft" | "quote";

export function StoreProductsManager({ rows }: { rows: StoreRow[] }) {
  const router = useRouter();
  const [filter, setFilter] = useState<Filter>("all");
  const [editing, setEditing] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const shown = rows.filter((r) =>
    filter === "all" ? true : filter === "listed" ? r.storeListed : filter === "draft" ? !r.storeListed && !r.quoteOnly : r.quoteOnly,
  );
  const counts = {
    all: rows.length,
    listed: rows.filter((r) => r.storeListed).length,
    draft: rows.filter((r) => !r.storeListed && !r.quoteOnly).length,
    quote: rows.filter((r) => r.quoteOnly).length,
  };

  async function toggle(row: StoreRow) {
    setBusyId(row.id);
    try {
      await setStoreListed({ id: row.id, on: !row.storeListed });
      router.refresh();
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {(["all", "listed", "draft", "quote"] as Filter[]).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`rounded-full border px-3 py-1 text-xs font-semibold ${filter === f ? "border-primary bg-primary text-primary-foreground" : "text-muted-foreground"}`}
          >
            {f === "all" ? "All" : f === "listed" ? "Listed" : f === "draft" ? "Draft" : "Quote-only"} · {counts[f]}
          </button>
        ))}
      </div>

      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full min-w-[720px] text-sm">
          <thead>
            <tr className="border-b bg-muted/40 text-left text-[11px] uppercase tracking-wide text-muted-foreground">
              <th className="px-3 py-2">Product</th>
              <th className="px-3 py-2">Family</th>
              <th className="px-3 py-2 text-right">Variants</th>
              <th className="px-3 py-2 text-right">AeroQuote</th>
              <th className="px-3 py-2 text-right">Website</th>
              <th className="px-3 py-2">Store</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {shown.map((row) => (
              <RowView
                key={row.id}
                row={row}
                editing={editing === row.id}
                busy={busyId === row.id}
                onToggle={() => toggle(row)}
                onEdit={() => setEditing(editing === row.id ? null : row.id)}
                onClose={() => setEditing(null)}
              />
            ))}
            {shown.length === 0 && (
              <tr>
                <td colSpan={7} className="px-3 py-8 text-center text-sm text-muted-foreground">No products in this view.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function RowView({
  row,
  editing,
  busy,
  onToggle,
  onEdit,
  onClose,
}: {
  row: StoreRow;
  editing: boolean;
  busy: boolean;
  onToggle: () => void;
  onEdit: () => void;
  onClose: () => void;
}) {
  return (
    <>
      <tr className="border-b align-middle">
        <td className="px-3 py-2">
          <div className="font-medium">{row.name}</div>
          <div className="font-mono text-[11px] text-muted-foreground">{row.modelCode}</div>
        </td>
        <td className="px-3 py-2"><span className="rounded border bg-muted px-2 py-0.5 text-[11px] font-semibold">{row.family}</span></td>
        {/* Show the real figures for every family — the price is now what decides
            whether a listed item gets a cart, so it must be visible here. "Quote"
            means no catalogue price, i.e. listing it shows it as quote-on-request. */}
        <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{row.variants || "—"}</td>
        <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{row.aeroquotePrice != null ? peso(row.aeroquotePrice) : "Quote"}</td>
        <td className="px-3 py-2 text-right font-semibold tabular-nums">{row.websitePrice != null ? peso(row.websitePrice) : "Quote"}</td>
        {/* Every product can be listed, including the fabricated families — a
            branded resale fan (Östberg, KDK…) is a fan by TYPE but bought in, so
            family alone can't decide. The badge stays as information: a listed
            item with no catalogue price shows on the store as "Quote on request"
            rather than with a cart. */}
        <td className="px-3 py-2">
          <div className="flex items-center gap-1.5">
            <button
              onClick={onToggle}
              disabled={busy}
              className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-semibold ${row.storeListed ? "border-emerald-300 bg-emerald-50 text-emerald-700" : "text-muted-foreground"}`}
            >
              <span className={`h-1.5 w-1.5 rounded-full ${row.storeListed ? "bg-emerald-600" : "bg-muted-foreground"}`} />
              {busy ? "…" : row.storeListed ? "Listed" : "Draft"}
            </button>
            {row.quoteOnly && (
              <span
                title="Fabricated family — listing it shows it on the store as “Quote on request” unless it has a catalogue price."
                className="inline-flex items-center rounded-full border border-violet-300 bg-violet-50 px-2 py-0.5 text-[11px] font-semibold text-violet-700"
              >
                Quote-only
              </span>
            )}
          </div>
        </td>
        <td className="px-3 py-2 text-right">
          <Button size="sm" variant="outline" className="h-7 text-xs" onClick={onEdit}>{editing ? "Close" : "Edit listing"}</Button>
        </td>
      </tr>
      {editing && (
        <tr className="border-b bg-muted/20">
          <td colSpan={7} className="px-3 py-3">
            <StoreListingEditor row={row} onClose={onClose} />
          </td>
        </tr>
      )}
    </>
  );
}

function StoreListingEditor({ row, onClose }: { row: StoreRow; onClose: () => void }) {
  const router = useRouter();
  const [listed, setListed] = useState(row.storeListed);
  const [slug, setSlug] = useState(row.storeSlug ?? "");
  const [category, setCategory] = useState(row.storeCategory ?? "");
  const [description, setDescription] = useState(row.storeDescription ?? "");
  const [photos, setPhotos] = useState<StorePhoto[]>(row.storePhotos);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function upload(file: File) {
    setUploading(true);
    setMsg(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/store-uploads", { method: "POST", body: fd });
      const data = (await res.json()) as { path?: string; error?: string };
      if (!res.ok || !data.path) throw new Error(data.error || "Upload failed");
      setPhotos((p) => [...p, { path: data.path! }]);
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : "Upload failed" });
    } finally {
      setUploading(false);
    }
  }

  async function save() {
    setBusy(true);
    setMsg(null);
    try {
      await saveStoreListing({ id: row.id, storeListed: listed, storeSlug: slug, storeCategory: category, storeDescription: description, storePhotos: photos });
      setMsg({ ok: true, text: "Saved." });
      router.refresh();
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : "Save failed" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <div className="space-y-3">
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={listed} onChange={(e) => setListed(e.target.checked)} />
          <span className="font-medium">Visible on storefront</span>
        </label>
        {row.quoteOnly && (
          <p className="text-[11px] text-violet-700">
            This is a fabricated family. Listing it is fine — it shows with a cart if it has a catalogue price, and as
            &ldquo;Quote on request&rdquo; if it doesn&rsquo;t.
          </p>
        )}
        <label className="block space-y-1">
          <span className="text-[11px] uppercase tracking-wide text-muted-foreground">URL slug</span>
          <Input className="h-8" value={slug} placeholder={row.modelCode.toLowerCase()} onChange={(e) => setSlug(e.target.value)} />
          <span className="text-[11px] text-muted-foreground">/fans/{slug || "(auto from model code)"}</span>
        </label>
        <label className="block space-y-1">
          <span className="text-[11px] uppercase tracking-wide text-muted-foreground">Category</span>
          <Input className="h-8" value={category} placeholder={row.defaultCategory} onChange={(e) => setCategory(e.target.value)} />
        </label>
        <label className="block space-y-1">
          <span className="text-[11px] uppercase tracking-wide text-muted-foreground">Store description</span>
          <textarea className="min-h-[70px] w-full rounded-md border bg-background px-2 py-1.5 text-sm" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Marketing copy shown on the product page…" />
        </label>
      </div>

      <div className="space-y-3">
        <div>
          <span className="text-[11px] uppercase tracking-wide text-muted-foreground">Photos</span>
          <div className="mt-1 flex flex-wrap gap-2">
            {photos.map((p, i) => (
              <div key={i} className="relative h-16 w-16 overflow-hidden rounded-md border bg-muted">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={`/api/store-uploads?path=${encodeURIComponent(p.path)}`} alt={p.alt || ""} className="h-full w-full object-cover" />
                <button
                  onClick={() => setPhotos((ps) => ps.filter((_, j) => j !== i))}
                  className="absolute right-0 top-0 flex h-4 w-4 items-center justify-center rounded-bl bg-black/60 text-[10px] text-white"
                  aria-label="Remove photo"
                >×</button>
              </div>
            ))}
            <label className="flex h-16 w-16 cursor-pointer items-center justify-center rounded-md border border-dashed text-xs text-muted-foreground hover:bg-muted">
              {uploading ? "…" : "+ Add"}
              <input type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f); e.target.value = ""; }} />
            </label>
          </div>
          <p className="mt-1 text-[11px] text-muted-foreground">The website price is derived from the AeroQuote price (÷ 0.95) — set the price in the Catalogue.</p>
        </div>

        <div className="flex items-center gap-2">
          <Button size="sm" className="h-8" disabled={busy} onClick={save}>{busy ? "Saving…" : "Save listing"}</Button>
          <Button size="sm" variant="outline" className="h-8" onClick={onClose}>Close</Button>
          {msg && <span className={`text-xs ${msg.ok ? "text-emerald-600" : "text-red-600"}`}>{msg.text}</span>}
        </div>
      </div>
    </div>
  );
}
