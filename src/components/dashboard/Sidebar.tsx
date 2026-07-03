"use client";

import Link, { useLinkStatus } from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import clsx from "clsx";
import { BrandMark } from "@/components/BrandMark";

/** Spinner shown on a nav item while its route is loading (Next useLinkStatus). */
function NavSpinner() {
  const { pending } = useLinkStatus();
  if (!pending) return null;
  return (
    <span className="ml-auto h-3.5 w-3.5 shrink-0 animate-spin rounded-full border-2 border-ink-600 border-t-brand-600" />
  );
}

/** Material Symbols icon. */
function Icon({ name, className }: { name: string; className?: string }) {
  return <span className={clsx("material-symbols-outlined", className)}>{name}</span>;
}

const NAV = [
  { href: "/dashboard", label: "Videos", icon: "video_library", exact: true },
  { href: "/dashboard/connections", label: "Connections", icon: "hub" },
  { href: "/dashboard/publishing", label: "Publishing", icon: "send" },
  { href: "/dashboard/generic", label: "Generic", icon: "movie" },
  { href: "/dashboard/settings", label: "Settings", icon: "settings" },
];

export function Sidebar({ user }: { user: { name: string | null; email: string } }) {
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);

  async function signOut() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  const brand = (
    <Link
      href="/dashboard"
      onClick={() => setOpen(false)}
      className="flex items-center gap-2 rounded-lg px-1 py-1"
    >
      <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand-gradient text-white shadow-glow-sm">
        <BrandMark className="h-5 w-5" />
      </span>
      <span>
        <span className="block text-lg font-semibold leading-none tracking-tight text-ink-100">ViralCut</span>
        <span className="block font-geist text-[10px] uppercase tracking-widest text-ink-400">Creator Suite</span>
      </span>
    </Link>
  );

  const nav = (
    <nav className="flex-1 space-y-1">
      {NAV.map((item) => {
        const active = item.exact ? pathname === item.href : pathname.startsWith(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={() => setOpen(false)}
            className={clsx(
              "group flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all",
              active
                ? "bg-brand-500/12 text-brand-700 shadow-[inset_0_0_0_1px_rgba(124,92,255,0.22)]"
                : "text-ink-300 hover:bg-ink-800/70 hover:text-ink-100",
            )}
          >
            <Icon
              name={item.icon}
              className={clsx("text-[20px] transition-transform group-hover:scale-110", active && "scale-110")}
            />
            {item.label}
            <NavSpinner />
          </Link>
        );
      })}
    </nav>
  );

  const account = (
    <div className="mt-4 border-t border-ink-800 pt-4">
      <div className="flex items-center gap-3 px-1">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-ink-700 text-sm font-semibold uppercase text-ink-100">
          {(user.name || user.email).charAt(0)}
        </span>
        <div className="min-w-0 text-sm">
          <div className="truncate font-medium">{user.name || "Creator"}</div>
          <div className="truncate text-xs text-ink-400">{user.email}</div>
        </div>
      </div>
      <button onClick={signOut} className="btn-ghost mt-2 w-full justify-start gap-2 text-sm">
        <Icon name="logout" className="text-[18px]" /> Sign out
      </button>
    </div>
  );

  return (
    <>
      {/* Mobile top bar */}
      <header className="sticky top-0 z-40 flex items-center justify-between border-b border-ink-800 bg-ink-950/80 px-4 py-2.5 backdrop-blur-md md:hidden">
        {brand}
        <button
          onClick={() => setOpen(true)}
          aria-label="Open menu"
          className="btn-ghost h-9 w-9 px-0"
        >
          <Icon name="menu" />
        </button>
      </header>

      {/* Mobile drawer */}
      {open && (
        <div className="fixed inset-0 z-50 md:hidden">
          <button
            aria-label="Close menu"
            onClick={() => setOpen(false)}
            className="absolute inset-0 animate-fade-in bg-black/60 backdrop-blur-sm"
          />
          <aside className="absolute left-0 top-0 flex h-full w-72 animate-slide-left flex-col border-r border-ink-800 bg-ink-900 p-4 shadow-2xl">
            <div className="mb-6 flex items-center justify-between">
              {brand}
              <button
                onClick={() => setOpen(false)}
                aria-label="Close menu"
                className="btn-ghost h-9 w-9 px-0"
              >
                <Icon name="close" />
              </button>
            </div>
            {nav}
            {account}
          </aside>
        </div>
      )}

      {/* Desktop sidebar */}
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r border-ink-800 bg-ink-900/40 p-4 backdrop-blur-sm md:flex">
        <div className="mb-6 px-1">{brand}</div>
        {nav}
        {account}
      </aside>
    </>
  );
}
