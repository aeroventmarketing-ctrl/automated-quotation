"use client";

import { useState } from "react";
import type { StorePhoto } from "@/lib/store-product";
import { FanPlaceholder, isBlowerCategory } from "../../fan-placeholder";

/**
 * Product gallery — a large frame plus thumbnails. The frame keeps a fixed
 * aspect ratio so switching images (or a slow load) never shifts the page.
 */
export function Gallery({
  photos,
  name,
  category,
  fit,
}: {
  photos: StorePhoto[];
  name: string;
  category: string;
  fit: "contain" | "cover";
}) {
  const [active, setActive] = useState(0);
  const objectFit = fit === "cover" ? "object-cover" : "object-contain p-8";
  const current = photos[active];

  return (
    <div className="space-y-3">
      <div className="relative aspect-[4/3] overflow-hidden rounded-md border border-[var(--store-line)] bg-gradient-to-br from-[#edf1f4] to-[#d7dee5]">
        {current ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            key={current.path}
            src={`/api/store-image?path=${encodeURIComponent(current.path)}`}
            alt={current.alt || name}
            className={`h-full w-full ${objectFit}`}
            fetchPriority="high"
            decoding="async"
          />
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-5">
            <FanPlaceholder blower={isBlowerCategory(category)} scale={1.6} />
            <span className="text-[10px] uppercase tracking-[0.1em] text-[#6e7d8b]">Photo coming soon</span>
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
              className={`aspect-square overflow-hidden rounded border bg-[#edf1f4] transition-all ${
                i === active ? "border-[var(--store-accent)] ring-1 ring-[var(--store-accent)]" : "border-[var(--store-line)] hover:border-[#8190a2]"
              }`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={`/api/store-image?path=${encodeURIComponent(ph.path)}`}
                alt=""
                className={`h-full w-full ${fit === "cover" ? "object-cover" : "object-contain p-1.5"}`}
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
