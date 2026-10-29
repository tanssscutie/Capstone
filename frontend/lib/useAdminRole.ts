// lib/useAdminRole.ts
// The signed-in administrator's role (GET /business/admin/me), fetched once
// per sign-in and shared by the sidebar and the super-admin page gates.
// Only decides what to show — every super-admin route checks it again.
import { useEffect, useState } from 'react';
import { getAdminMe, type AdminRole } from './api/admin';
import { tokenStore } from './api/client';

let cached: { token: string | null; role: Promise<AdminRole | null> } | null = null;

export function loadAdminRole(): Promise<AdminRole | null> {
  const token = tokenStore.get();
  if (!cached || cached.token !== token) {
    cached = { token, role: getAdminMe().then((m) => m.admin_role).catch(() => null) };
  }
  return cached.role;
}

/** null while loading (or for a non-admin). */
export function useAdminRole(): AdminRole | null {
  const [role, setRole] = useState<AdminRole | null>(null);
  useEffect(() => {
    let live = true;
    loadAdminRole().then((r) => { if (live) setRole(r); });
    return () => { live = false; };
  }, []);
  return role;
}
