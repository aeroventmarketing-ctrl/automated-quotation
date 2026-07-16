"use client";

import { useCallback, useEffect, useRef, useState } from "react";

interface Pending {
  id: string;
  code: string;
  company: string;
  action: string;
}

const POLL_MS = 30_000; // re-check for new approvals every 30s
const ALARM_MS = 20_000; // sound + flashing window last 20s

// One shared AudioContext, unlocked on the first user gesture so later alarms
// can play without a fresh interaction (browsers block audio before a gesture).
let sharedCtx: AudioContext | null = null;
function unlockAudio() {
  try {
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!sharedCtx) sharedCtx = new AC();
    if (sharedCtx.state === "suspended") void sharedCtx.resume();
  } catch {
    /* ignore */
  }
}

/** Start a loud pulsing two-tone alarm; returns a stopper. */
function startSound(): () => void {
  unlockAudio();
  const ctx = sharedCtx;
  if (!ctx) return () => {};
  const gain = ctx.createGain();
  gain.gain.value = 0.0001;
  gain.connect(ctx.destination);
  const osc = ctx.createOscillator();
  osc.type = "square";
  osc.connect(gain);
  try {
    osc.start();
  } catch {
    /* already started */
  }
  let hi = true;
  const beep = () => {
    const t = ctx.currentTime;
    osc.frequency.setValueAtTime(hi ? 1040 : 760, t);
    // loud on for ~0.28s, then near-silent
    gain.gain.cancelScheduledValues(t);
    gain.gain.setValueAtTime(0.45, t);
    gain.gain.setValueAtTime(0.45, t + 0.28);
    gain.gain.linearRampToValueAtTime(0.0001, t + 0.34);
    hi = !hi;
  };
  beep();
  const iv = window.setInterval(beep, 400);
  return () => {
    window.clearInterval(iv);
    try {
      const t = ctx.currentTime;
      gain.gain.cancelScheduledValues(t);
      gain.gain.setValueAtTime(0.0001, t);
      osc.stop(t + 0.02);
    } catch {
      /* ignore */
    }
  };
}

export function ApproverAlarm() {
  const [ringing, setRinging] = useState<Pending[] | null>(null);
  const alarmedRef = useRef<Set<string>>(new Set());
  const stopSoundRef = useRef<(() => void) | null>(null);
  const timerRef = useRef<number | null>(null);
  const origTitleRef = useRef<string>("");
  const titleIvRef = useRef<number | null>(null);

  const stop = useCallback(() => {
    if (stopSoundRef.current) {
      stopSoundRef.current();
      stopSoundRef.current = null;
    }
    if (timerRef.current) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    if (titleIvRef.current) {
      window.clearInterval(titleIvRef.current);
      titleIvRef.current = null;
      if (origTitleRef.current) document.title = origTitleRef.current;
    }
    setRinging(null);
  }, []);

  const ring = useCallback((orders: Pending[]) => {
    setRinging(orders);
    stopSoundRef.current = startSound();
    // Flash the tab title too, for attention when the tab isn't focused.
    origTitleRef.current = document.title;
    let on = true;
    titleIvRef.current = window.setInterval(() => {
      document.title = on ? "🔔 Approval needed" : origTitleRef.current;
      on = !on;
    }, 700);
    timerRef.current = window.setTimeout(stop, ALARM_MS);
  }, [stop]);

  // Unlock audio on the first interaction anywhere in the app.
  useEffect(() => {
    const on = () => unlockAudio();
    window.addEventListener("pointerdown", on, { once: true });
    window.addEventListener("keydown", on, { once: true });
    return () => {
      window.removeEventListener("pointerdown", on);
      window.removeEventListener("keydown", on);
    };
  }, []);

  // Poll for orders awaiting this viewer; ring when a new one appears.
  useEffect(() => {
    let active = true;
    async function check() {
      try {
        const res = await fetch("/api/pending-approvals", { cache: "no-store" });
        if (!res.ok || !active) return;
        const data = (await res.json()) as { orders: Pending[] };
        const orders = data.orders ?? [];
        const currentIds = new Set(orders.map((o) => o.id));
        // Drop remembered IDs that are no longer pending (so they can ring again
        // if they come back later).
        for (const id of alarmedRef.current) if (!currentIds.has(id)) alarmedRef.current.delete(id);
        const fresh = orders.filter((o) => !alarmedRef.current.has(o.id));
        if (fresh.length > 0 && !stopSoundRef.current) {
          orders.forEach((o) => alarmedRef.current.add(o.id));
          ring(orders);
        }
      } catch {
        /* ignore network hiccups */
      }
    }
    check();
    const iv = window.setInterval(check, POLL_MS);
    return () => {
      active = false;
      window.clearInterval(iv);
    };
  }, [ring]);

  // Any tap / key / click stops the alarm while it's ringing.
  useEffect(() => {
    if (!ringing) return;
    const onInteract = () => stop();
    window.addEventListener("pointerdown", onInteract, { capture: true });
    window.addEventListener("keydown", onInteract, { capture: true });
    return () => {
      window.removeEventListener("pointerdown", onInteract, { capture: true });
      window.removeEventListener("keydown", onInteract, { capture: true });
    };
  }, [ringing, stop]);

  // Stop the sound if the component unmounts.
  useEffect(() => () => stop(), [stop]);

  if (!ringing) return null;

  return (
    <div
      role="alertdialog"
      aria-label="Approval needed"
      onClick={stop}
      className="fixed inset-0 z-[100] flex items-center justify-center p-4"
      style={{ animation: "approverFlash 0.7s steps(1,end) infinite" }}
    >
      <style>{`
        @keyframes approverFlash {
          0%, 49% { background-color: rgba(237,28,36,0.92); }
          50%, 100% { background-color: rgba(20,20,20,0.92); }
        }
      `}</style>
      <div className="w-full max-w-md rounded-2xl bg-white p-6 text-center shadow-2xl dark:bg-neutral-900">
        <div className="text-5xl">🔔</div>
        <h2 className="mt-2 text-xl font-bold text-[#ED1C24]">Approval needed</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {ringing.length === 1 ? "An order is" : `${ringing.length} orders are`} waiting for your approval.
        </p>
        <ul className="mt-3 max-h-48 space-y-1.5 overflow-y-auto text-left">
          {ringing.map((o) => (
            <li key={o.id} className="rounded-md border bg-muted/30 p-2 text-sm">
              <span className="font-mono font-semibold">{o.code}</span>
              <span className="text-muted-foreground"> · {o.company}</span>
              <div className="text-xs text-muted-foreground">{o.action}</div>
            </li>
          ))}
        </ul>
        <button
          type="button"
          onClick={stop}
          className="mt-4 w-full rounded-md bg-[#ED1C24] px-4 py-2.5 font-semibold text-white hover:bg-[#c2141a]"
        >
          Tap to stop
        </button>
        <p className="mt-2 text-[11px] text-muted-foreground">Tapping anywhere or pressing any key stops the alarm.</p>
      </div>
    </div>
  );
}
