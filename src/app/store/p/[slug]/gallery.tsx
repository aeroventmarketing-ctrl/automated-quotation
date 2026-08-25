"use client";

import { useState } from "react";
import type { StorePhoto } from "@/lib/store-product";

/**
 * Product gallery — a large frame plus thumbnails. The frame keeps a fixed
 * aspect ratio so switching images (or a slow load) never shifts the page.
 */
export function Gallery({ photos, name, fit }: { photos: StorePhoto[]; name: string; fit: "contain" | "cover" }) {
  const [active, setActive] = useState(0);
  const objectFit = fit === "cover" ? "object-cover" : "object-contain";
  const current = photos[active];

  return (
    <div className="space-y-3">
      <div className="relative aspect-[4/3] overflow-hidden rounded-2xl border border-slate-200 bg-gradient-to-b from-slate-50 to-slate-100/60">
        {current ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            key={current.path}
            src={`/api/store-image?path=${encodeURIComponent(current.path)}`}
            alt={current.alt || name}
            className={`h-full w-full ${objectFit} p-8`}
            fetchPriority="high"
            decoding="async"
          />
        ) : (
          <div className="flex h-full items-center justify-center">
            <span className="text-[13px] text-slate-400">No photo yet</span>
          </div>
        )}
      </div>

      {photos.length > 1 && (
        <div className="grid grid-cols-5 gap-2.5">
          {photos.slice(0, 10).map((ph, i) => (
            <button
              key={ph.path}
              type="button"
              onClick={() => setActive(i)}
              aria-label={`View image ${i + 1} of ${name}`}
              aria-current={i === active}
              className={`aspect-square overflow-hidden rounded-lg border bg-slate-50 transition-all ${
                i === active
                  ? "border-[var(--store-accent)] ring-2 ring-[var(--store-accent)]/20"
                  : "border-slate-200 hover:border-slate-300"
              }`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={`/api/store-image?path=${encodeURIComponent(ph.path)}`}
                alt=""
                className={`h-full w-full ${objectFit} p-1.5`}
                loading="lazy"
                decoding="async"
              />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
