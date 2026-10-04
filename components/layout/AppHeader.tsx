"use client";

import Link from "next/link";
import { useEffect, useState, useCallback } from "react";
import { usePathname } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { BrandMark } from "@/components/brand/BrandMark";

export function AppHeader() {
  const pathname = usePathname();
  const [email, setEmail] = useState<string | null>(null);
  const [signingOut, setSigningOut] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const supabase = createClient();
    void supabase.auth.getUser().then(({ data }) => {
      if (!cancelled) setEmail(data.user?.email ?? null);
    });
    return () => { cancelled = true; };
  }, []);

  const handleLogout = useCallback(async () => {
    setSigningOut(true);
    const supabase = createClient();
    await supabase.auth.signOut();
    window.location.href = "/login";
  }, []);

  const links = [
    { href: "/dashboard", label: "Monitor" },
    { href: "/events", label: "Events" },
  ];

  return (
    <header className="bg-canvas">
      <div className="mx-auto flex max-w-6xl items-end justify-between gap-4 px-4 pt-6">
        <BrandMark />

        <nav className="flex items-end gap-5 pb-px" aria-label="Main">
          {links.map((link) => {
            const active = pathname === link.href || pathname.startsWith(`${link.href}/`);
            return (
              <Link
                key={link.href}
                href={link.href}
                className={`border-b-2 pb-3 text-[13px] font-medium tracking-wide ${
                  active
                    ? "border-slate-800 text-slate-900"
                    : "border-transparent text-slate-500 hover:text-slate-800"
                }`}
                aria-current={active ? "page" : undefined}
              >
                {link.label}
              </Link>
            );
          })}
        </nav>

        <div className="hidden items-center gap-3 pb-3 sm:flex">
          {email ? (
            <>
              <p className="max-w-[10rem] truncate text-xs text-slate-500" title={email}>
                {email}
              </p>
              <button
                type="button"
                onClick={handleLogout}
                disabled={signingOut}
                className="rounded-md border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-100 disabled:opacity-50"
                aria-label="Sign out"
              >
                {signingOut ? "Signing out…" : "Sign out"}
              </button>
            </>
          ) : (
            <span className="w-[14rem]" />
          )}
        </div>
      </div>
      <div className="mx-auto max-w-6xl px-4">
        <div className="border-b border-slate-300" />
      </div>
    </header>
  );
}
