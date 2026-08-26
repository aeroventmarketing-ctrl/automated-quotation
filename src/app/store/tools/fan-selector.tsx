"use client";

import { useEffect, useState } from "react";
import { DISPLAY } from "@/lib/store-ui";
import { NumField, PickField, ToolCard, Hint } from "./tool-ui";
import { openQuotePanel } from "../ui-store";

/**
 * Public fan selector.
 *
 * Runs against `/api/public/fan-select` — the read-only, CORS-open endpoint
 * built for exactly this page. It uses the SAME selection engine as the staff
 * quotation builder but is deliberately **performance-only**: the response
 * carries no price, no body cost and no internal catalogue id, so nothing here
 * can leak a figure the business hasn't quoted. Price is a conversation, and
 * the CTA under the results starts it.
 *
 * The product dropdown is filled from the endpoint's own GET discovery route
 * rather than a hard-coded list, so a new family reaches the shop without a
 * storefront deploy.
 */

interface Family {
  tag: string;
  label: string;
}

interface FanResult {
  modelCode: string;
  name: string;
  size: string | null;
  rpm: number | null;
  motorHp: number | null;
  motorKw: number | null;
  motorPole: number | null;
  bladeAngle: number | null;
  deliveredAirflow_cfm: number;
  deliveredAirflow_m3hr: number;
  staticPressure_pa: number;
  bhp: number | null;
  power_kw: number | null;
  efficiency: number | null;
  outletVelocity_fpm: number | null;
  confidence: string;
  recommended: boolean;
  summary: string | null;
  warnings: string[] | null;
}

interface SelectResponse {
  duty: { airflow_cfm: number; airflow_m3hr: number; staticPressure_pa: number };
  family: { tag: string; label: string };
  count: number;
  results: FanResult[];
  error?: string;
}

const INWG_PER_PA = 1 / 249.0889;

/** How the duty point reads in the enquiry — CFM and in w.g., as engineers quote it. */
const dutyLabel = (duty: SelectResponse["duty"]) =>
  `${duty.airflow_cfm.toLocaleString()} CFM @ ${(duty.staticPressure_pa * INWG_PER_PA).toFixed(2)} in w.g.`;

/**
 * The line dropped into the quotation dialog's Product / Application field, so
 * Sales sees exactly which model the visitor was looking at and at what duty.
 */
function quoteSubject(duty: SelectResponse["duty"], fan: FanResult | null): string {
  if (!fan) return `Fan selection — ${dutyLabel(duty)}`;
  const spec = [
    fan.rpm != null ? `${Math.round(fan.rpm)} rpm` : null,
    fan.motorHp != null ? `${fan.motorHp} HP` : fan.motorKw != null ? `${fan.motorKw} kW` : null,
  ].filter(Boolean);
  return `${fan.modelCode} — ${dutyLabel(duty)}${spec.length ? ` (${spec.join(", ")})` : ""}`;
}

export function FanSelector() {
  const [families, setFamilies] = useState<Family[]>([]);
  const [airflow, setAirflow] = useState("5000");
  const [airflowUnit, setAirflowUnit] = useState("cfm");
  const [sp, setSp] = useState("2");
  const [spUnit, setSpUnit] = useState("inwg");
  const [tag, setTag] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [data, setData] = useState<SelectResponse | null>(null);
  /** The model the visitor picked — what "Quote this selection" sends. */
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    fetch("/api/public/fan-select")
      .then((r) => r.json())
      .then((j: { families?: Family[] }) => { if (live && Array.isArray(j.families)) setFamilies(j.families); })
      .catch(() => { /* the dropdown just falls back to the centrifugal sweep */ });
    return () => { live = false; };
  }, []);

  async function run() {
    const q = Number(airflow);
    const p = Number(sp);
    if (!Number.isFinite(q) || q <= 0) { setErr("Enter an airflow greater than zero."); return; }
    if (!Number.isFinite(p) || p < 0) { setErr("Enter a static pressure of zero or more."); return; }

    setBusy(true);
    setErr(null);
    try {
      const res = await fetch("/api/public/fan-select", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ airflow: q, airflowUnit, staticPressure: p, pressureUnit: spUnit, tag }),
      });
      const j = (await res.json()) as SelectResponse;
      if (!res.ok) {
        setErr(j.error ?? "Selection failed. Please try again.");
        setData(null);
        setSelected(null);
      } else {
        setData(j);
        // Start on the engine's recommendation; the visitor can move off it.
        setSelected(j.results.find((r) => r.recommended)?.modelCode ?? j.results[0]?.modelCode ?? null);
      }
    } catch {
      setErr("Could not reach the selection service. Please try again.");
      setData(null);
      setSelected(null);
    } finally {
      setBusy(false);
    }
  }

  const chosen = data?.results.find((r) => r.modelCode === selected) ?? null;

  return (
    <ToolCard
      title="Fan Selector"
      intro="Enter a duty point and we'll rank the Aerovent models that meet it, with the speed, motor size and efficiency each would run at. Performance figures only — pricing is quoted per project once the selection is confirmed."
    >
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <NumField label="Airflow" value={airflow} onChange={setAirflow} placeholder="5000" />
        <PickField
          label="Unit"
          value={airflowUnit}
          onChange={setAirflowUnit}
          options={[{ value: "cfm", label: "CFM" }, { value: "m3hr", label: "m³/hr" }]}
        />
        <NumField label="Static pressure" value={sp} onChange={setSp} placeholder="2" />
        <PickField
          label="Unit"
          value={spUnit}
          onChange={setSpUnit}
          options={[{ value: "inwg", label: "in w.g." }, { value: "pa", label: "Pa" }]}
        />
        <PickField
          label="Product"
          value={tag}
          onChange={setTag}
          options={[{ value: "", label: "All centrifugal" }, ...families.map((f) => ({ value: f.tag, label: f.label }))]}
        />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={run}
          disabled={busy}
          className="rounded-[5px] bg-[var(--store-accent)] px-6 py-3.5 text-[14px] font-extrabold text-white transition-colors hover:bg-[var(--store-accent-dark)] disabled:opacity-60"
        >
          {busy ? "Selecting…" : "Run Selection"}
        </button>
        {err && <span className="text-[13px] font-semibold text-[var(--store-accent)]">{err}</span>}
      </div>

      {data && (
        <div className="space-y-4">
          <Hint>
            Duty point <b>{dutyLabel(data.duty)}</b> ({data.duty.staticPressure_pa} Pa) · {data.family.label} ·{" "}
            {data.count} match{data.count === 1 ? "" : "es"}
            {data.results.length > 0 && " · pick a row to quote it"}
          </Hint>

          {data.results.length === 0 ? (
            <div className="border border-dashed border-[#bcc6d0] p-8 text-center text-[13.5px] text-[var(--store-steel)]">
              No standard model covers that duty point. It may need a fabricated unit — send us the requirement and our
              engineers will size one.
              <button
                type="button"
                onClick={() => openQuotePanel(quoteSubject(data.duty, null))}
                className="mx-auto mt-5 block rounded-[5px] bg-[var(--store-accent)] px-5 py-3 text-[13.5px] font-extrabold text-white transition-colors hover:bg-[var(--store-accent-dark)]"
              >
                Request a quotation
              </button>
            </div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[760px] border-collapse text-[13px]">
                  <thead>
                    <tr className="border-b border-[var(--store-line)] text-left text-[10px] font-black uppercase tracking-[0.1em] text-[var(--store-steel)]">
                      <th className="w-9 py-2.5 pr-2"><span className="sr-only">Select</span></th>
                      <th className="py-2.5 pr-3">Model</th>
                      <th className="py-2.5 pr-3">Size</th>
                      <th className="py-2.5 pr-3 text-right">RPM</th>
                      <th className="py-2.5 pr-3 text-right">Motor</th>
                      <th className="py-2.5 pr-3 text-right">Delivered</th>
                      <th className="py-2.5 pr-3 text-right">BHP</th>
                      <th className="py-2.5 pr-3 text-right">Eff.</th>
                      <th className="py-2.5">Fit</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.results.map((r) => (
                      <tr
                        key={r.modelCode}
                        onClick={() => setSelected(r.modelCode)}
                        className={`cursor-pointer border-b border-[#edf0f2] transition-colors ${
                          selected === r.modelCode
                            ? "bg-[var(--store-accent)]/[0.08]"
                            : "hover:bg-[#f8fafb]"
                        }`}
                      >
                        <td
                          className={`py-2.5 pr-2 border-l-[3px] ${
                            selected === r.modelCode ? "border-[var(--store-accent)]" : "border-transparent"
                          }`}
                        >
                          <input
                            type="radio"
                            name="fan-selection"
                            value={r.modelCode}
                            checked={selected === r.modelCode}
                            onChange={() => setSelected(r.modelCode)}
                            aria-label={`Select ${r.modelCode}`}
                            className="h-4 w-4 accent-[var(--store-accent)]"
                          />
                        </td>
                        <td className="py-2.5 pr-3">
                          <span className={`${DISPLAY} text-[16px] leading-none`}>{r.modelCode}</span>
                          {r.recommended && (
                            <span className="ml-2 rounded-[3px] bg-[var(--store-accent)] px-1.5 py-0.5 text-[9px] font-black uppercase tracking-[0.08em] text-white">
                              Recommended
                            </span>
                          )}
                          <div className="mt-0.5 text-[11px] text-[#8a96a5]">{r.name}</div>
                        </td>
                        <td className="py-2.5 pr-3">{r.size ?? "—"}</td>
                        <td className="py-2.5 pr-3 text-right tabular-nums">{r.rpm != null ? Math.round(r.rpm) : "—"}</td>
                        <td className="py-2.5 pr-3 text-right tabular-nums">
                          {r.motorHp != null ? `${r.motorHp} HP` : r.motorKw != null ? `${r.motorKw} kW` : "—"}
                        </td>
                        <td className="py-2.5 pr-3 text-right tabular-nums">
                          {r.deliveredAirflow_cfm.toLocaleString()} cfm
                        </td>
                        <td className="py-2.5 pr-3 text-right tabular-nums">{r.bhp != null ? r.bhp.toFixed(2) : "—"}</td>
                        <td className="py-2.5 pr-3 text-right tabular-nums">
                          {r.efficiency != null ? `${Math.round(r.efficiency * 100)}%` : "—"}
                        </td>
                        <td className="py-2.5 text-[11px] uppercase tracking-wide text-[var(--store-steel)]">
                          {r.confidence.toLowerCase()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-4 rounded border border-[var(--store-line)] bg-[#f8fafb] px-5 py-4">
                <div className="max-w-xl">
                  <p className="text-[13px] leading-relaxed text-[#536275]">
                    {chosen ? (
                      <>
                        Quoting <b className="text-[var(--store-ink)]">{chosen.modelCode}</b> at{" "}
                        {dutyLabel(data.duty)} — pick another row to change it.
                      </>
                    ) : (
                      <>Choose a model above to quote it.</>
                    )}
                  </p>
                  <p className="mt-1 text-[12px] leading-relaxed text-[var(--store-steel)]">
                    Selections are indicative. Send us the application and site conditions and our engineers will
                    confirm the model, accessories and price.
                  </p>
                </div>
                <button
                  type="button"
                  disabled={!chosen}
                  onClick={() => openQuotePanel(quoteSubject(data.duty, chosen))}
                  className="shrink-0 rounded-[5px] bg-[var(--store-ink)] px-5 py-3 text-[13.5px] font-extrabold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
                >
                  Quote this selection →
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </ToolCard>
  );
}
