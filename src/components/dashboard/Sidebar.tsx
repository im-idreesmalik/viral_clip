"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import clsx from "clsx";

const NAV = [
  { href: "/dashboard", label: "Videos", icon: "🎬", exact: true },
  { href: "/dashboard/connections", label: "Connections", icon: "🔗" },
  { href: "/dashboard/publishing", label: "Publishing", icon: "📡" },
  { href: "/dashboard/settings", label: "Automation", icon: "⚙️" },
];

export function Sidebar({ user }: { user: { name: string | null; email: string } }) {
  const pathname = usePathname();
  const router = useRouter();

  async function signOut() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  return (
    <aside className="flex w-60 shrink-0 flex-col border-r border-ink-800 bg-ink-900/60 p-4">
      <Link href="/dashboard" className="mb-6 flex items-center gap-2 px-2">
        <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-500 text-lg">
          ✂️
        </span>
        <span className="text-lg font-semibold">ViralCut</span>
      </Link>

      <nav className="flex-1 space-y-1">
        {NAV.map((item) => {
          const active = item.exact ? pathname === item.href : pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={clsx(
                "flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors",
                active ? "bg-brand-500/15 text-brand-100" : "text-ink-100/70 hover:bg-ink-800",
              )}
            >
              <span>{item.icon}</span>
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="mt-4 border-t border-ink-800 pt-4">
        <div className="px-2 text-sm">
          <div className="truncate font-medium">{user.name || "Creator"}</div>
          <div className="truncate text-xs text-ink-100/50">{user.email}</div>
        </div>
        <button onClick={signOut} className="btn-ghost mt-2 w-full justify-start text-sm">
          Sign out
        </button>
      </div>
    </aside>
  );
}
