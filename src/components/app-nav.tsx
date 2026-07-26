"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { LayoutDashboard, Inbox, FileText, BellRing, ClipboardList, Boxes, Package, ClipboardCheck, ShoppingCart, Wallet, Percent, Gauge, Wrench, Settings, LogOut, UserCog, CalendarDays, ListChecks } from "lucide-react";
import type { Role } from "@prisma/client";
import { DASHBOARD_CONSOLIDATED_ROLES } from "@/lib/dashboard-consolidation";

/** Shown to workflow-role holders and admins (their task list). */
export const MY_DASHBOARD_ITEM = { href: "/my-dashboard", label: "My Dashboard", icon: ListChecks } as const;

export const NAV = [
  { href: "/management", label: "Management Dashboard", icon: Gauge, roles: ["ADMIN"] },
  { href: "/dashboard", label: "Sales Dashboard", icon: LayoutDashboard, roles: ["SALES", "ENGINEER", "ADMIN", "OTHER"] },
  { href: "/inquiries", label: "Inquiries", icon: Inbox, roles: ["SALES", "ENGINEER", "ADMIN"] },
  { href: "/quotations", label: "Quotations", icon: FileText, roles: ["SALES", "ENGINEER", "ADMIN"] },
  { href: "/follow-ups", label: "Follow-ups", icon: BellRing, roles: ["SALES", "ENGINEER", "ADMIN"] },
  { href: "/calendar", label: "Team Calendar", icon: CalendarDays, roles: ["SALES", "ENGINEER", "ADMIN", "OTHER"] },
  { href: "/orders", label: "Orders", icon: ClipboardList, roles: ["SALES", "ENGINEER", "ADMIN", "OTHER"] },
  { href: "/inventory", label: "Inventory", icon: Boxes, roles: ["ENGINEER", "ADMIN", "OTHER"] },
  { href: "/products", label: "Products", icon: Package, roles: ["ENGINEER", "ADMIN", "OTHER"] },
  { href: "/requisitions", label: "Requisitions", icon: ClipboardCheck, roles: ["SALES", "ENGINEER", "ADMIN", "OTHER"] },
  { href: "/purchasing", label: "Purchasing", icon: ShoppingCart, roles: ["SALES", "ENGINEER", "ADMIN", "OTHER"] },
  { href: "/cash-requests", label: "Cash Requests", icon: Wallet, roles: ["SALES", "ENGINEER", "ADMIN", "OTHER"] },
  { href: "/commissions", label: "Commissions", icon: Percent, roles: ["SALES", "ENGINEER", "ADMIN", "OTHER"] },
  { href: "/tools", label: "HVAC Tools", icon: Wrench, roles: ["SALES", "ENGINEER", "ADMIN"] },
  { href: "/admin", label: "Admin", icon: Settings, roles: ["ADMIN"] },
] as const;

/**
 * Per-workflow-role tab overrides on top of the base-role allow-list. `hide`
 * removes a tab the base role would otherwise show; `show` forces a tab on. When
 * a user holds several roles, any role's `show` wins over another role's `hide`.
 */
// Operational production / shop-floor roles. Sales commissions are sales-rep
// payout data (client + money) that these roles don't need — the Commissions
// tab is hidden from them (Accounting keeps it: they compute/pay commissions;
// Sales / Engineer / Admin keep it via their base role).
const SHOPFLOOR_ROLES = new Set<string>([
  "plant_manager",
  "prod_head_fans",
  "prod_head_duct",
  "prod_head_accessories",
  "prod_head_motor",
  "technical_head",
  "quality_inspector",
  "quality_inspector_2",
  "warehouse",
  "logistics",
]);

// The four production line heads. They raise requisitions but don't process
// POs, so the Purchasing tab denies them — hide it (a dead-end otherwise). They
// track their requisition's progress on the Requisitions tab instead.
const PROD_HEAD_ROLES = new Set<string>([
  "prod_head_fans",
  "prod_head_duct",
  "prod_head_accessories",
  "prod_head_motor",
]);

export const NAV_OVERRIDES: Record<string, { hide?: string[]; show?: string[] }> = {
  // Accounting sees Inventory (read-only, like the Plant Manager); Products and
  // the standalone Sales Dashboard stay hidden. Keeps Commissions (payouts).
  accounting: { hide: ["/products", "/dashboard"], show: ["/requisitions"] },
  // Consolidated-dashboard roles: hide the standalone Sales Dashboard tab, plus
  // Commissions for shop-floor roles and Purchasing for the production heads.
  ...Object.fromEntries(
    DASHBOARD_CONSOLIDATED_ROLES.filter((r) => r !== "accounting").map((r) => {
      const hide = ["/dashboard"];
      if (SHOPFLOOR_ROLES.has(r)) hide.push("/commissions");
      if (PROD_HEAD_ROLES.has(r)) hide.push("/purchasing");
      return [r, { hide }];
    }),
  ),
  // The 1st Quality Inspector isn't dashboard-consolidated but is still a
  // shop-floor role — hide Commissions from them too.
  quality_inspector: { hide: ["/commissions"] },
};

/** The nav items visible to a user given their base role + workflow roles. */
export function visibleNav(role: Role, workflowRoles: string[]) {
  const hide = new Set<string>();
  const show = new Set<string>();
  for (const r of workflowRoles) {
    const o = NAV_OVERRIDES[r];
    o?.hide?.forEach((h) => hide.add(h));
    o?.show?.forEach((s) => show.add(s));
  }
  // Admins keep the standalone Sales Dashboard even when they also hold a
  // dashboard-consolidated workflow role (e.g. Accounting / Plant Manager).
  if (role === "ADMIN") hide.delete("/dashboard");
  const items = NAV.filter((n) => {
    const allowed = (n.roles as readonly string[]).includes(role) || show.has(n.href);
    return allowed && !(hide.has(n.href) && !show.has(n.href));
  });
  // Workflow-role holders (and admins) get their personal task dashboard on top.
  // For admins it's presented as the "Production Dashboard".
  const dash = role === "ADMIN" ? { ...MY_DASHBOARD_ITEM, label: "Production Dashboard" } : MY_DASHBOARD_ITEM;
  return workflowRoles.length > 0 || role === "ADMIN" ? [dash, ...items] : items;
}

export function AppNav({ role, name, workflowRoles = [], dashboardAlerts = {} }: { role: Role; name: string; workflowRoles?: string[]; dashboardAlerts?: Record<string, boolean> }) {
  const pathname = usePathname();
  const items = visibleNav(role, workflowRoles);

  return (
    <div className="flex h-full flex-col">
      <div className="px-4 py-4">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/aerovent-logo.jpg"
          alt="Aerovent Fans and Blowers Manufacturing"
          className="h-auto w-full"
        />
        <div className="mt-1 text-[10px] uppercase tracking-wide text-muted-foreground">
          {role}
        </div>
      </div>
      <nav className="flex-1 space-y-1 px-2">
        {items.map((item) => {
          const active = pathname === item.href || pathname.startsWith(item.href + "/");
          const Icon = item.icon;
          const alert = dashboardAlerts[item.href];
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                active
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
              )}
            >
              <Icon className="h-4 w-4" />
              {item.label}
              {/* New-activity indicator — flashes on the dashboard with new items. */}
              {alert && <span className="ml-auto h-2.5 w-2.5 shrink-0 animate-approver-blink rounded-full bg-amber-500" aria-label="New activity" />}
            </Link>
          );
        })}
      </nav>
      <div className="border-t p-3">
        <div className="mb-2 px-2 text-xs text-muted-foreground">{name}</div>
        <Link
          href="/account"
          className="mb-1 flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
        >
          <UserCog className="h-4 w-4" />
          Account
        </Link>
        <form action="/auth/signout" method="post">
          <button
            type="submit"
            className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
          >
            <LogOut className="h-4 w-4" />
            Sign out
          </button>
        </form>
      </div>
    </div>
  );
}
