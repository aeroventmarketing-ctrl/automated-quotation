"use client";

/**
 * Shared client-side file upload for the app's document endpoints
 * (/api/sale-uploads, /api/purchase-uploads).
 *
 * Two problems this solves:
 *  1. Vercel caps a serverless request body at ~4.5 MB. A phone photo is often
 *     larger, so the upload is rejected at the edge with a plain-text
 *     "Request Entity Too Large" — and a bare `res.json()` then throws the
 *     cryptic "Unexpected token 'R' … is not valid JSON". We downscale/re-encode
 *     images in the browser first so they fit, and parse the response safely.
 *  2. Every uploader repeated the same fetch/parse code. This centralises it.
 */

export interface UploadedDoc {
  path: string;
  name: string;
  uploadedAt: string;
}

// Keep well under Vercel's ~4.5 MB request limit (FormData adds overhead).
const MAX_UPLOAD_BYTES = 3_800_000;
// Longest edge for a re-encoded photo — plenty for a document/receipt scan.
const MAX_IMAGE_EDGE = 2000;

function isImage(file: File): boolean {
  return file.type.startsWith("image/") && file.type !== "image/gif";
}

/**
 * Downscale + re-encode an image (JPEG) until it fits under MAX_UPLOAD_BYTES.
 * Returns the original file if it's already small enough, not an image, or if
 * the browser can't process it (falls back to letting the server decide).
 */
async function compressImage(file: File): Promise<File> {
  if (!isImage(file) || file.size <= MAX_UPLOAD_BYTES) return file;
  try {
    const bitmap = await createImageBitmap(file);
    let { width, height } = bitmap;
    const scale = Math.min(1, MAX_IMAGE_EDGE / Math.max(width, height));
    width = Math.max(1, Math.round(width * scale));
    height = Math.max(1, Math.round(height * scale));

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.drawImage(bitmap, 0, 0, width, height);
    bitmap.close?.();

    // Step the JPEG quality down until it fits (or we run out of headroom).
    for (const quality of [0.82, 0.7, 0.6, 0.5, 0.4]) {
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
      if (blob && blob.size <= MAX_UPLOAD_BYTES) {
        const base = file.name.replace(/\.[^.]+$/, "");
        return new File([blob], `${base}.jpg`, { type: "image/jpeg" });
      }
    }
  } catch {
    /* processing failed — fall back to the original file */
  }
  return file;
}

/** Read a JSON body without throwing when the response isn't JSON. */
async function readJsonSafe(res: Response): Promise<Record<string, unknown> | null> {
  try {
    return (await res.json()) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * Upload a file to `endpoint` with the given extra form fields. Compresses large
 * images first, and turns non-JSON / error responses into a clear message.
 * Throws an Error with a human-readable message on failure.
 */
export async function uploadDocument(
  endpoint: string,
  file: File,
  fields: Record<string, string> = {},
): Promise<UploadedDoc> {
  const prepared = await compressImage(file);
  if (prepared.size > MAX_UPLOAD_BYTES) {
    throw new Error("This file is too large to upload (max ~4 MB). Please use a smaller image or a PDF.");
  }
  const fd = new FormData();
  fd.append("file", prepared);
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);

  let res: Response;
  try {
    res = await fetch(endpoint, { method: "POST", body: fd });
  } catch {
    throw new Error("Upload failed — check your connection and try again.");
  }

  if (res.status === 413) {
    throw new Error("This file is too large to upload (max ~4 MB). Please use a smaller image or a PDF.");
  }
  const data = await readJsonSafe(res);
  if (!res.ok || !data) {
    const msg = (data && typeof data.error === "string" && data.error) || null;
    throw new Error(msg || (res.status >= 500 ? "Upload failed — please try again." : "Upload failed."));
  }
  return data as unknown as UploadedDoc;
}
