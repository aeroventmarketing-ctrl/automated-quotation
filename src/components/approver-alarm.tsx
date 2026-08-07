"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

interface Pending {
  id: string;
  code: string;
  company: string;
  action: string;
  anchor: string; // phase-card id to scroll to on the order page (e.g. "phase-2")
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
  const router = useRouter();
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
          unlockAudio();
          ring(orders);
          // Ring each order ONCE: remember every currently-pending order so it
          // doesn't re-fire every poll while it just sits waiting. (Audio may be
          // locked on this first ring — the flashing popup still shows, and any
          // later tap unlocks sound for the NEXT new order.) An order that leaves
          // the pending set is forgotten above, so it can ring again if it returns.
          orders.forEach((o) => alarmedRef.current.add(o.id));
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

  // Silence the alarm and jump straight to the order's pending phase card.
  const goToOrder = useCallback((o: Pending) => {
    stop();
    router.push(`/orders/${o.id}${o.anchor ? `#${o.anchor}` : ""}`);
  }, [router, stop]);

  // Pressing any key dismisses (silences) the alarm without navigating — the tap
  // targets on the dialog handle navigation vs. dismiss explicitly.
  useEffect(() => {
    if (!ringing) return;
    const onKey = () => stop();
    window.addEventListener("keydown", onKey, { capture: true });
    return () => window.removeEventListener("keydown", onKey, { capture: true });
  }, [ringing, stop]);

  // Stop the sound if the component unmounts.
  useEffect(() => () => stop(), [stop]);

  if (!ringing) return null;

  // The order the alarm opens on tap — the most recent of those waiting. Any
  // others stay listed on My Dashboard.
  const primary = ringing[0];

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
      {/* Stop the backdrop's dismiss-on-click from firing for taps on the card. */}
      <div
        className="w-full max-w-md rounded-2xl bg-white p-6 text-center shadow-2xl dark:bg-neutral-900"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="text-5xl">🔔</div>
        <h2 className="mt-2 text-xl font-bold text-[#ED1C24]">Approval needed</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {ringing.length === 1 ? "An order is" : `${ringing.length} orders are`} waiting for your approval.
        </p>
        <div className="mt-3 rounded-md border bg-muted/30 p-2 text-left text-sm">
          <span className="font-mono font-semibold">{primary.code}</span>
          <span className="text-muted-foreground"> · {primary.company}</span>
          <div className="text-xs text-muted-foreground">{primary.action}</div>
        </div>
        {ringing.length > 1 && (
          <p className="mt-1 text-[11px] text-muted-foreground">+{ringing.length - 1} more waiting — see My Dashboard.</p>
        )}
        <button
          type="button"
          onClick={() => goToOrder(primary)}
          className="mt-4 w-full rounded-md bg-[#ED1C24] px-4 py-2.5 font-semibold text-white hover:bg-[#c2141a]"
        >
          Go to order {primary.code}
        </button>
        <button
          type="button"
          onClick={stop}
          className="mt-2 w-full rounded-md border px-4 py-2 text-sm font-medium text-muted-foreground hover:bg-muted"
        >
          Dismiss
        </button>
        <p className="mt-2 text-[11px] text-muted-foreground">Tapping outside or pressing any key dismisses without opening.</p>
      </div>
    </div>
  );
}
