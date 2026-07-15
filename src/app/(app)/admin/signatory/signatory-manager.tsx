"use client";

import { useRef, useState } from "react";
import Image from "next/image";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { Signatory } from "@/lib/signatory";

type SaveFn = (input: Signatory) => Promise<Signatory>;

/** Read a File into a data URL. */
function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error("Could not read the image."));
    r.readAsDataURL(file);
  });
}

/** Load a data URL into an HTMLImageElement. */
function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new window.Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Could not load the image."));
    img.src = src;
  });
}

/**
 * Convert an uploaded signature to a PNG with a transparent background: draw it
 * to a canvas (scaled down if huge) and knock out near-white pixels to alpha 0,
 * so the signature sits cleanly over the printed name on the 2307.
 */
async function toTransparentPng(file: File): Promise<string> {
  const img = await loadImage(await fileToDataUrl(file));
  const maxW = 900;
  const scale = img.naturalWidth > maxW ? maxW / img.naturalWidth : 1;
  const w = Math.max(1, Math.round(img.naturalWidth * scale));
  const h = Math.max(1, Math.round(img.naturalHeight * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas is not available in this browser.");
  ctx.drawImage(img, 0, 0, w, h);
  const image = ctx.getImageData(0, 0, w, h);
  const d = image.data;
  for (let i = 0; i < d.length; i += 4) {
    // Near-white → fully transparent; light grey → partially transparent (soft edge).
    const min = Math.min(d[i], d[i + 1], d[i + 2]);
    if (min > 240) d[i + 3] = 0;
    else if (min > 200) d[i + 3] = Math.round(d[i + 3] * (1 - (min - 200) / 40));
  }
  ctx.putImageData(image, 0, 0);
  return canvas.toDataURL("image/png");
}

export function SignatoryManager({ signatory, onSave }: { signatory: Signatory; onSave: SaveFn }) {
  const [name, setName] = useState(signatory.name);
  const [designation, setDesignation] = useState(signatory.designation);
  const [signature, setSignature] = useState(signatory.signature);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  async function pickImage(file: File | undefined) {
    setErr(null);
    setOk(false);
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setErr("Please choose an image file (PNG with a transparent background works best).");
      return;
    }
    if (file.size > 5_000_000) {
      setErr("Image is too large. Please use a signature image under ~5 MB.");
      return;
    }
    try {
      setSignature(await toTransparentPng(file));
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not read the image.");
    }
  }

  async function save() {
    setBusy(true);
    setErr(null);
    setOk(false);
    try {
      const saved = await onSave({ name: name.trim(), designation: designation.trim(), signature });
      setName(saved.name);
      setDesignation(saved.designation);
      setSignature(saved.signature);
      setOk(true);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to save.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="max-w-xl space-y-4">
      <label className="block space-y-1">
        <span className="text-xs text-muted-foreground">Printed name</span>
        <Input className="h-9" value={name} placeholder="e.g. MICHELLE COTURA" onChange={(e) => setName(e.target.value)} />
      </label>

      <label className="block space-y-1">
        <span className="text-xs text-muted-foreground">Title / Designation</span>
        <Input className="h-9" value={designation} placeholder="e.g. Accounting Head" onChange={(e) => setDesignation(e.target.value)} />
      </label>

      <div className="space-y-2">
        <span className="text-xs text-muted-foreground">Signature image</span>
        <div className="flex items-center gap-3">
          <div className="flex h-20 w-56 items-center justify-center rounded-md border bg-white">
            {signature ? (
              <Image src={signature} alt="Signature" width={224} height={80} unoptimized className="max-h-20 w-auto object-contain" />
            ) : (
              <span className="text-xs text-muted-foreground">No signature</span>
            )}
          </div>
          <div className="flex flex-col gap-2">
            <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => pickImage(e.target.files?.[0])} />
            <Button size="sm" variant="outline" className="h-8" onClick={() => fileRef.current?.click()}>
              {signature ? "Replace image" : "Upload image"}
            </Button>
            {signature && (
              <Button size="sm" variant="outline" className="h-8" onClick={() => { setSignature(""); setOk(false); }}>
                Remove
              </Button>
            )}
          </div>
        </div>
        <p className="text-[11px] text-muted-foreground">Tip: a PNG with a transparent background sits cleanly over the signature line.</p>
      </div>

      <div className="flex items-center gap-2">
        <Button size="sm" className="h-9" disabled={busy} onClick={save}>{busy ? "Saving…" : "Save signatory"}</Button>
        {ok && <span className="text-xs text-green-600">Saved.</span>}
        {err && <span className="text-xs text-destructive">{err}</span>}
      </div>
    </div>
  );
}
