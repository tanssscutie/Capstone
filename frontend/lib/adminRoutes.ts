// lib/adminRoutes.ts
// Where the admin console lives. Not /admin: an unguessable path, so the
// console isn't found by trying URLs — share the link with administrators
// only. Obscurity is an extra layer, not the protection: every admin page
// and API route still needs an admin login (and super admin pages the role).
// Change ADMIN_BASE here and rename the app/x~7Qz_k9-Ra/ folder to match.
export const ADMIN_BASE = '/x~7Qz_k9-Ra';

export const ADMIN = {
  dashboard: ADMIN_BASE,
  login: `${ADMIN_BASE}/login`,
  businesses: `${ADMIN_BASE}/businesses`,
  requirements: `${ADMIN_BASE}/requirements`,
  reports: `${ADMIN_BASE}/reports`,
  changeRequests: `${ADMIN_BASE}/change-requests`,
  documents: `${ADMIN_BASE}/documents`,
  api: `${ADMIN_BASE}/api`,
  team: `${ADMIN_BASE}/team`,
  rules: `${ADMIN_BASE}/rules`,
  audit: `${ADMIN_BASE}/audit`,
  data: `${ADMIN_BASE}/data`,
  settings: `${ADMIN_BASE}/settings`,
} as const;

export type AdminHref = (typeof ADMIN)[keyof typeof ADMIN];

/** True for any page of the admin console (the login included). */
export function isAdminPath(pathname: string): boolean {
  return pathname === ADMIN_BASE || pathname.startsWith(`${ADMIN_BASE}/`);
}
