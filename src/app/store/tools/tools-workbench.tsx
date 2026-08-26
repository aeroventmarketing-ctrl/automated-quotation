"use client";

import { useState } from "react";
import { WRAP } from "@/lib/store-ui";
import { TOOL_TABS, type ToolKey } from "./tools";
import { FanSelector } from "./fan-selector";
import { DuctulatorTool } from "./ductulator-tool";
import { PulleyTool } from "./pulley-tool";
import { FanLawTool } from "./fan-law-tool";

/**
 * The public tools workbench: one tab strip over the four calculators.
 *
 * The active tool is written into the URL (`?tool=…`) with `replaceState`, so a
 * visitor can share or bookmark a specific calculator and the back button still
 * leaves the page rather than cycling tabs. All four are mounted lazily by the
 * conditional below, so opening the page costs one tool's worth of work.
 */
export function ToolsWorkbench({ initial }: { initial: ToolKey }) {
  const [tool, setTool] = useState<ToolKey>(initial);

  function pick(key: ToolKey) {
    setTool(key);
    const url = new URL(window.location.href);
    url.searchParams.set("tool", key);
    window.history.replaceState(null, "", url.toString());
  }

  return (
    <section className={`${WRAP} py-12`}>
      <div role="tablist" aria-label="HVAC tools" className="mb-7 flex flex-wrap gap-2">
        {TOOL_TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={tool === t.key}
            onClick={() => pick(t.key)}
            className={`rounded-[5px] px-5 py-3 text-[13.5px] font-extrabold transition-colors ${
              tool === t.key
                ? "bg-[var(--store-accent)] text-white"
                : "border border-[var(--store-line)] bg-white text-[var(--store-ink)] hover:border-[var(--store-accent)] hover:text-[var(--store-accent)]"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tool === "fan-selector" && <FanSelector />}
      {tool === "ductulator" && <DuctulatorTool />}
      {tool === "pulley" && <PulleyTool />}
      {tool === "fan-law" && <FanLawTool />}
    </section>
  );
}
