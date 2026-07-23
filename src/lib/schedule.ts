/**
 * Shared team calendar. Any user may add a schedule (it starts PENDING); an
 * Engineer, Admin or Approver approves or rejects it. Categories carry a colour
 * used across the calendar chips and legend.
 */

export type ScheduleStatus = "PENDING" | "APPROVED" | "REJECTED";

export interface ScheduleCategory {
  key: string;
  label: string;
  color: string; // hex — the chip / dot colour
}

export const SCHEDULE_CATEGORIES: ScheduleCategory[] = [
  { key: "general", label: "General", color: "#64748b" },
  { key: "meeting", label: "Meeting", color: "#4f46e5" },
  { key: "delivery", label: "Delivery", color: "#2563eb" },
  { key: "production", label: "Production", color: "#16a34a" },
  { key: "payment", label: "Payment", color: "#d97706" },
  { key: "maintenance", label: "Maintenance", color: "#0d9488" },
  { key: "other", label: "Other", color: "#7c3aed" },
];

const CAT_BY_KEY = new Map(SCHEDULE_CATEGORIES.map((c) => [c.key, c] as const));
export function scheduleCategory(key: string | null | undefined): ScheduleCategory {
  return CAT_BY_KEY.get(key ?? "") ?? SCHEDULE_CATEGORIES[0];
}

export const SCHEDULE_STATUS_LABEL: Record<ScheduleStatus, string> = {
  PENDING: "Pending approval",
  APPROVED: "Approved",
  REJECTED: "Rejected",
};

/** The row shape the calendar renders (dates as ISO strings, plus permissions). */
export interface ScheduleView {
  id: string;
  title: string;
  details: string | null;
  category: string;
  startAt: string; // ISO
  endAt: string | null; // ISO
  allDay: boolean;
  location: string | null;
  status: ScheduleStatus;
  createdByName: string;
  decidedByName: string | null;
  decidedAt: string | null; // ISO
  decisionNote: string | null;
  isOwner: boolean;
  canEdit: boolean;
  canDecide: boolean;
}
