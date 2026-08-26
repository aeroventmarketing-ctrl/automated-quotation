/**
 * The tool list, in a module with no `"use client"` directive.
 *
 * This matters: every export of a client module is replaced by a client
 * reference at the server/client boundary, so a plain array exported from
 * `tools-workbench.tsx` would reach the server page as an opaque proxy —
 * `TOOL_KEYS.includes(...)` would throw at request time even though the build
 * and the typecheck both pass. Shared constants belong on this side.
 */
export const TOOL_KEYS = ["fan-selector", "ductulator", "pulley", "fan-law"] as const;
export type ToolKey = (typeof TOOL_KEYS)[number];

export const TOOL_TABS: { key: ToolKey; label: string }[] = [
  { key: "fan-selector", label: "Fan Selector" },
  { key: "ductulator", label: "Ductulator" },
  { key: "pulley", label: "Pulley" },
  { key: "fan-law", label: "Fan Law" },
];

/** Narrow an untrusted `?tool=` value to a real tab. */
export const toolKeyFrom = (raw: string | undefined): ToolKey =>
  TOOL_KEYS.includes(raw as ToolKey) ? (raw as ToolKey) : "fan-selector";
