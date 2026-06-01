"use client";

import { getSupabaseBrowser } from "@/lib/supabase/client";
import { useEffect, useState } from "react";

/** Client-side admin check. Reads `profiles.role` once after
 *  auth resolves. Returns `false` until the read completes,
 *  which is the safe default for UI gating (hide rather than
 *  flicker).
 *
 *  This is a *UX* signal only — it decides whether to render
 *  the "Admin" sidebar link. Every admin route + API call
 *  re-checks server-side via [requireAdmin](../lib/rbac.ts)
 *  and [admin/layout.tsx](../app/admin/layout.tsx). A
 *  user who flips this to true client-side gets nothing
 *  beyond an extra useless link in their sidebar. */
export function useIsAdmin(): boolean {
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    const supabase = getSupabaseBrowser();
    if (!supabase) return;
    let cancelled = false;
    (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;
      const { data } = await supabase
        .from("profiles")
        .select("role")
        .eq("user_id", user.id)
        .maybeSingle();
      if (!cancelled) {
        setIsAdmin(data?.role === "admin");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return isAdmin;
}
