"use client";

import { useState } from "react";
import Link from "next/link";
import { closePanels, showToast } from "./ui-store";
import { Overlay, CloseButton, Kicker } from "./store-chrome";

/**
 * Request-a-quotation dialog.
 *
 * Unlike the design prototype this posts for real: it submits to the existing
 * public `/api/rfq` intake, so the enquiry lands in the same Inbound RFQ queue
 * as an emailed one and Sales works it with the buttons they already have. The
 * hidden `website` field is the API's honeypot and must stay empty.
 */
export function QuoteDialog({ subject, note }: { subject: string; note: string }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const data = new FormData(form);
    const get = (k: string) => (data.get(k) ?? "").toString().trim();

    // The API takes one free-text `message`; fold the three technical fields
    // into it so nothing the buyer typed is lost.
    const parts = [
      get("product") && `Product / application: ${get("product")}`,
      get("location") && `Project location: ${get("location")}`,
      get("requirements"),
    ].filter(Boolean);

    const body = new FormData();
    body.set("contactName", get("contactName"));
    body.set("company", get("company"));
    body.set("email", get("email"));
    body.set("phone", get("phone"));
    body.set("message", parts.join("\n\n"));
    body.set("website", get("website"));

    setBusy(true);
    setErr(null);
    try {
      const res = await fetch("/api/rfq", { method: "POST", body });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setErr(json.error || "Could not send the request. Please try again.");
        setBusy(false);
        return;
      }
      closePanels();
      showToast("Quotation request sent — our team will be in touch.");
    } catch {
      setErr("Could not send the request. Please check your connection and try again.");
      setBusy(false);
    }
  }

  const field =
    "rounded border border-[var(--store-line)] bg-white px-3 py-3 text-[14px] text-[var(--store-text)] outline-none transition-colors focus:border-[var(--store-accent)]";
  const label = "text-[11px] font-extrabold uppercase tracking-wide text-[var(--store-steel)]";

  return (
    <Overlay labelledBy="quote-dialog-title">
      <div className="absolute inset-0 overflow-y-auto py-[5vh]">
        <div className="relative mx-auto w-[min(660px,calc(100%_-_30px))] rounded-lg bg-white p-8 shadow-[0_18px_60px_rgba(9,20,38,0.12)]">
          <CloseButton />
          <Kicker>Engineering support</Kicker>
          <h2
            id="quote-dialog-title"
            className="mt-2 font-[family-name:var(--font-display)] text-[32px] font-bold uppercase leading-none text-[var(--store-text)]"
          >
            Request a quotation
          </h2>
          <p className="mt-2 text-[13.5px] leading-relaxed text-[var(--store-steel)]">
            Tell us what you need and our technical team will size and price it.
          </p>

          <form onSubmit={submit} className="mt-6">
            {/* Honeypot — real people never see or fill this. */}
            <input
              type="text"
              name="website"
              tabIndex={-1}
              autoComplete="off"
              aria-hidden
              className="absolute left-[-9999px] h-0 w-0 opacity-0"
            />

            <div className="grid gap-3.5 sm:grid-cols-2">
              <label className="flex flex-col gap-1.5">
                <span className={label}>Contact person</span>
                <input name="contactName" required placeholder="Your full name" className={field} />
              </label>
              <label className="flex flex-col gap-1.5">
                <span className={label}>Company</span>
                <input name="company" placeholder="Company name" className={field} />
              </label>
              <label className="flex flex-col gap-1.5">
                <span className={label}>Email</span>
                <input name="email" type="email" required placeholder="name@company.com" className={field} />
              </label>
              <label className="flex flex-col gap-1.5">
                <span className={label}>Phone</span>
                <input name="phone" required placeholder="Mobile or landline" className={field} />
              </label>
              <label className="flex flex-col gap-1.5">
                <span className={label}>Product / application</span>
                <input
                  name="product"
                  defaultValue={subject}
                  // A selection carried in from the Fan Selector is longer than
                  // the field; the whole value is submitted either way, and the
                  // tooltip lets the visitor read it back without scrolling.
                  title={subject || undefined}
                  placeholder="Fan, blower or ventilation need"
                  className={field}
                />
              </label>
              <label className="flex flex-col gap-1.5">
                <span className={label}>Project location</span>
                <input name="location" placeholder="City / Province" className={field} />
              </label>
              <label className="flex flex-col gap-1.5 sm:col-span-2">
                <span className={label}>Technical requirements</span>
                <textarea
                  name="requirements"
                  rows={4}
                  placeholder="Airflow, static pressure, dimensions, quantity and application (if known)"
                  className={`${field} min-h-[90px] resize-y`}
                />
              </label>
            </div>

            <p className="my-4 bg-[#f3f6f8] p-3 text-[11px] leading-relaxed text-[var(--store-steel)]">
              {note} Need to attach drawings or a bill of quantities?{" "}
              <Link href="/rfq" onClick={closePanels} className="font-semibold text-[var(--store-accent)] underline">
                Use the full RFQ form
              </Link>
              .
            </p>

            {err && <p className="mb-3 text-[13px] font-semibold text-[var(--store-accent)]">{err}</p>}

            <button
              type="submit"
              disabled={busy}
              className="flex w-full items-center justify-center rounded-md bg-[var(--store-accent)] px-5 py-4 text-[14px] font-extrabold text-white transition-colors hover:bg-[var(--store-accent-dark)] disabled:opacity-60"
            >
              {busy ? "Sending…" : "Send quotation request →"}
            </button>
          </form>
        </div>
      </div>
    </Overlay>
  );
}
