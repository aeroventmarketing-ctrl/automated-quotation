"use client";

import { useState, type ReactNode } from "react";

/**
 * How many rows a dashboard list shows before it has to be asked for more.
 *
 * The owner, with three screenshots — ORDERS (15), PURCHASING (36), Materials
 * (50 of 58): *"limit to 10 rows only. Put a clickable show more word at the
 * bottom."* A long list is not more informative than a short one; it just
 * pushes the next card off the screen.
 */
export const SHOW_MORE_AFTER = 10;

/**
 * The first {@link SHOW_MORE_AFTER} rows, and a word that reveals the rest.
 *
 * The rows are built on the server and handed over as elements, so this adds no
 * fetching and no second render path — the whole list is already here; the
 * button only decides how much of it is on screen. Each row must carry its own
 * `key`, as it would in any list.
 */
export function ShowMoreList({
  rows,
  as = "div",
  className,
}: {
  rows: ReactNode[];
  /** `ul` when the rows are `li`s, so the markup stays valid. */
  as?: "div" | "ul";
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const hidden = rows.length - SHOW_MORE_AFTER;
  const Container = as;
  return (
    <>
      <Container className={className}>{open ? rows : rows.slice(0, SHOW_MORE_AFTER)}</Container>
      {hidden > 0 && (
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="mt-2 text-xs font-semibold text-primary hover:underline"
          aria-expanded={open}
        >
          {open ? "Show less" : `Show ${hidden} more`}
        </button>
      )}
    </>
  );
}
