// lib/api/viewer.ts
// Loads the currently logged-in business and exposes it through ViewerContext
// so the global AppHeader (and any other chrome) can render the real account
// name instead of a hardcoded mock.

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Business, CredibilityBlock, BusinessStatus, TrustTier } from '../types';
import { me, isLoggedIn, type BackendUser } from './auth';
import { getVerificationStatus, getDashboardStats, type VerificationStatusOut, type DashboardStatsOut } from './business';

type ViewerContextValue = {
  viewer: Business | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
};

const ViewerContext = createContext<ViewerContextValue | null>(null);

function tierFromStatus(status: string, backendTier: number | null): TrustTier | null {
  if (status !== 'VERIFIED' && status !== 'VERIFIED_RENEWED' as any) return null;
  if (backendTier === 1 || backendTier === 2 || backendTier === 3) return backendTier;
  return null;
}

function statusFromApi(status: string): BusinessStatus {
  switch (status) {
    case 'VERIFIED':
    case 'VERIFIED_RENEWED':
      return 'VERIFIED';
    case 'PENDING':
      return 'PENDING';
    case 'REJECTED':
      return 'REJECTED';
    case 'EXPIRED':
      return 'EXPIRED';
    default:
      return 'UNVERIFIED';
  }
}

/** Builds a Business from the bits the backend hands back. The verification
 *  endpoint already gives us most of the profile; we top up with dashboard
 *  stats for the credibility counters when available. */
function toBusiness(
  user: BackendUser,
  status: VerificationStatusOut,
  stats: DashboardStatsOut | null,
): Business {
  const credibility: CredibilityBlock = {
    status: statusFromApi(status.verification_status),
    verifiedAt: status.verification_date,
    recheckDueAt: status.recheck_date,
    tier: tierFromStatus(status.verification_status, status.tier),
    requirementsPosted: stats?.requirements_posted_count ?? 0,
    requirementsAwarded: stats?.requirements_awarded_count ?? 0,
    quotationsSubmitted: stats?.quotations_submitted_count ?? 0,
    quotationsAwarded: 0,
  };

  return {
    id: String(user.id),
    registeredName: user.business_name,
    displayName: null,
    businessType: ((status.business_type as Business['businessType']) || 'SOLE_PROP'),
    category: status.industry_category || 'General',
    city: status.city || '',
    province: status.province || '',
    contactPerson: status.contact_person || '',
    contactMobile: status.contact_mobile || user.mobile_number,
    capabilities: status.capabilities ?? [],
    serviceAreas: status.service_areas ?? [],
    credibility,
    profileCompletionPct: stats?.profile_completion_pct ?? 0,
    memberSinceYear: stats?.member_since_year ?? new Date().getFullYear(),
  };
}

/** Placeholder viewer shown while the real account loads (and as a fallback
 *  for the brief moment after login completes but before the profile is
 *  fetched). Empty strings, not a hardcoded business name. */
const EMPTY_VIEWER: Business = {
  id: '',
  registeredName: '',
  displayName: null,
  businessType: 'SOLE_PROP',
  category: '',
  city: '',
  province: '',
  contactPerson: '',
  contactMobile: '',
  capabilities: [],
  serviceAreas: [],
  credibility: {
    status: 'UNVERIFIED',
    verifiedAt: null,
    recheckDueAt: null,
    tier: null,
    requirementsPosted: 0,
    requirementsAwarded: 0,
    quotationsSubmitted: 0,
    quotationsAwarded: 0,
  },
  profileCompletionPct: 0,
  memberSinceYear: new Date().getFullYear(),
};

export function ViewerProvider({ children }: { children: ReactNode }) {
  const [viewer, setViewer] = useState<Business | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    if (!isLoggedIn()) {
      setViewer(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const [user, status, stats] = await Promise.all([
        me(),
        getVerificationStatus(),
        getDashboardStats().catch(() => null),
      ]);
      setViewer(toBusiness(user, status, stats));
    } catch (e: any) {
      setError(typeof e?.message === 'string' ? e.message : 'Failed to load profile');
      setViewer(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const value = useMemo<ViewerContextValue>(
    () => ({ viewer: viewer ?? EMPTY_VIEWER, loading, error, refresh: load }),
    [viewer, loading, error],
  );

  return <ViewerContext.Provider value={value}>{children}</ViewerContext.Provider>;
}

export function useViewer(): ViewerContextValue {
  const ctx = useContext(ViewerContext);
  if (!ctx) {
    // No provider (e.g. during static rendering) — return the empty viewer
    // so the header renders a blank chip instead of a hardcoded name.
    return { viewer: EMPTY_VIEWER, loading: false, error: null, refresh: async () => {} };
  }
  return ctx;
}
