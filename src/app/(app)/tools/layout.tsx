"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const TABS = [
  { href: "/tools", label: "Fan Selector" },
  { href: "/tools/ductulator", label: "Ductulator" },
];

export default function ToolsLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">HVAC Tools</h1>
      <nav className="flex flex-wrap gap-2 border-b pb-2">
        {TABS.map((t) => {
          const active = t.href === "/tools" ? pathname === "/tools" : pathname.startsWith(t.href);
          return (
            <Link
              key={t.href}
              href={t.href}
              className={cn(
                "rounded-md px-3 py-1.5 text-sm font-medium",
                active ? "bg-primary text-primary-foreground" : "hover:bg-accent",
              )}
            >
              {t.label}
            </Link>
          );
        })}
      </nav>
      {children}
    </div>
  );
}
