"use client";

import { createContext, useContext } from "react";

/**
 * Whether every user-facing alert is currently suppressed by the "alerts go-live"
 * gate (see src/lib/alert-golive.ts). Computed once, server-side, in the app
 * layout and provided here so purely-presentational alert widgets — chiefly the
 * inline "awaiting approval" badges scattered across the order/purchasing pages —
 * can blank themselves until launch without every call site threading the flag.
 */
const AlertsSuppressedContext = createContext<boolean>(false);

export function AlertSuppressionProvider({ suppressed, children }: { suppressed: boolean; children: React.ReactNode }) {
  return <AlertsSuppressedContext.Provider value={suppressed}>{children}</AlertsSuppressedContext.Provider>;
}

export function useAlertsSuppressed(): boolean {
  return useContext(AlertsSuppressedContext);
}
