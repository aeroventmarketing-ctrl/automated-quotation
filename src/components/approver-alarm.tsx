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

// One shared AudioContext, unlocked (resumed) on any user interaction so alarms
// can play — browsers block audio until the page has a user gesture.
let sharedCtx: AudioContext | null = null;
function getCtx(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!sharedCtx) {
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;
    try {
      sharedCtx = new AC();
    } catch {
      return null;
    }
  }
  return sharedCtx;
}
/** Best-effort resume; returns true once the context is running. */
function unlockAudio(): boolean {
  const ctx = getCtx();
  if (!ctx) return false;
  if (ctx.state !== "running") void ctx.resume().catch(() => {});
  return ctx.state === "running";
}

/** Start a loud two-tone siren; returns a stopper. */
function startSound(): () => void {
  const ctx = getCtx();
  if (!ctx) return () => {};
  void ctx.resume().catch(() => {});
  const master = ctx.createGain();
  master.gain.value = 0.6; // loud, steady (no fragile envelope)
  master.connect(ctx.destination);
  const osc = ctx.createOscillator();
  osc.type = "square";
  osc.frequency.value = 880;
  osc.connect(master);
  try {
    osc.start();
  } catch {
    /* already started */
  }
  // Two-tone siren by sweeping the pitch; keep retrying resume in case the
  // context was still suspended when the alarm began.
  let hi = true;
  const iv = window.setInterval(() => {
    if (ctx.state !== "running") void ctx.resume().catch(() => {});
    osc.frequency.setValueAtTime(hi ? 1046 : 660, ctx.currentTime);
    hi = !hi;
  }, 330);
  return () => {
    window.clearInterval(iv);
    try {
      osc.stop();
    } catch {
      /* ignore */
    }
    try {
      osc.disconnect();
      master.disconnect();
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

  // Keep trying to unlock audio on any interaction until the context is running,
  // so an alarm that fires later can actually sound.
  useEffect(() => {
    const events: (keyof WindowEventMap)[] = ["pointerdown", "touchstart", "keydown", "click"];
    const tryUnlock = () => {
      if (unlockAudio()) detach();
    };
    const detach = () => events.forEach((e) => window.removeEventListener(e, tryUnlock));
    events.forEach((e) => window.addEventListener(e, tryUnlock, { passive: true }));
    return detach;
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
          // Only "remember" these once audio can actually play; if it's still
          // locked (no interaction yet), leave them so the next poll re-rings
          // with sound after the user has tapped once.
          const soundReady = unlockAudio();
          ring(orders);
          if (soundReady) orders.forEach((o) => alarmedRef.current.add(o.id));
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
