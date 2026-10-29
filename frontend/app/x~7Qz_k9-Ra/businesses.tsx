// app/x~7Qz_k9-Ra/businesses.tsx
// Admin's full business roster (GET /business/admin/businesses) — every
// registered business, not just the ones currently waiting on review.
// Same shell as admin.tsx (sidebar, auth guard), with search and role /
// status filters above the list.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { color, font, fontSize, lineHeight, space } from '../../components/ui/tokens';
import { AvatarChip, initials } from '../../components/ui/AvatarChip';
import {
  AdminShell,
  AdminCard,
  DocumentList,
  EmptyState,
  ErrorBanner,
  FilterChips,
  GhostButton,
  InfoGrid,
  LoadingBlock,
  Pill,
  ReviewPanel,
  SearchField,
  formatDate,
  useAdminAccess,
} from '../../components/ui/AdminKit';
import type { PillTone } from '../../components/ui/AdminKit';
import { listAllBusinesses, reviewBusiness, liftRestriction } from '../../lib/api/admin';
import type { AdminBusinessOut } from '../../lib/api/admin';
import { errorMessage } from '../../lib/api/client';
import { BusinessLink, BusinessNameLink } from '../../components/ui/BusinessLink';

const STATUS_LABELS: Record<string, string> = {
  unverified: 'Unverified',
  pending: 'Pending',
  submitted: 'Submitted',
  under_review: 'Under review',
  verified: 'Verified',
  rejected: 'Rejected',
};

function statusTone(status: string): PillTone {
  if (status === 'verified') return 'primary';
  if (status === 'rejected' || status === 'under_review' || status === 'submitted') return 'danger';
  return 'neutral';
}

const needsReview = (b: AdminBusinessOut) => b.verification_status === 'under_review' || b.verification_status === 'submitted';

type RoleFilter = 'all' | 'buyer' | 'seller';
type StatusFilter = 'all' | 'review' | 'verified' | 'unverified' | 'rejected';

const STATUS_MATCH: Record<StatusFilter, (b: AdminBusinessOut) => boolean> = {
  all: () => true,
  review: needsReview,
  verified: (b) => b.verification_status === 'verified',
  unverified: (b) => b.verification_status === 'unverified' || b.verification_status === 'pending',
  rejected: (b) => b.verification_status === 'rejected',
};

function matchesSearch(b: AdminBusinessOut, q: string): boolean {
  if (!q) return true;
  return [b.registered_name, b.business_name, b.mobile_number, b.city, b.province, b.industry_category]
    .filter(Boolean)
    .some((v) => (v as string).toLowerCase().includes(q));
}

export default function AdminBusinessesRoute() {
  const access = useAdminAccess();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [businesses, setBusinesses] = useState<AdminBusinessOut[]>([]);
  const [notesByUser, setNotesByUser] = useState<Record<number, string>>({});
  const [actingOn, setActingOn] = useState<number | null>(null);
  const [roleFilter, setRoleFilter] = useState<RoleFilter>('all');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [search, setSearch] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setBusinesses(await listAllBusinesses());
    } catch (e: any) {
      setError(errorMessage(e, 'Could not load businesses.'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (access === 'GRANTED') load();
  }, [access, load]);

  async function handleReview(userId: number, approve: boolean) {
    setActingOn(userId);
    setError(null);
    try {
      await reviewBusiness(userId, approve, notesByUser[userId]);
      // Re-fetch rather than guess the resulting status locally — approving doesn't
      // always land on "verified" (another still-flagged document can keep a business
      // under_review even after this one decision).
      await load();
    } catch (e: any) {
      setError(errorMessage(e, 'Could not record that decision.'));
    } finally {
      setActingOn(null);
    }
  }

  const q = search.trim().toLowerCase();
  const byRole = useMemo(
    () => (roleFilter === 'all' ? businesses : businesses.filter((b) => b.role === roleFilter)),
    [businesses, roleFilter],
  );
  const shown = byRole.filter((b) => STATUS_MATCH[statusFilter](b) && matchesSearch(b, q));

  const countRole = (r: RoleFilter) => (r === 'all' ? businesses.length : businesses.filter((b) => b.role === r).length);
  const countStatus = (s: StatusFilter) => byRole.filter(STATUS_MATCH[s]).length;

  return (
    <AdminShell
      access={access}
      title="Businesses"
      subtitle={`${businesses.length} registered business${businesses.length === 1 ? '' : 'es'}`}
      actions={<GhostButton label="Refresh" onPress={load} busy={loading} />}
    >
      {error && <ErrorBanner message={error} />}

      {loading && businesses.length === 0 ? (
        <LoadingBlock />
      ) : (
        <>
          <SearchField value={search} onChangeText={setSearch} placeholder="Search by name, mobile, city or industry" />
          <View style={styles.filters}>
            <FilterChips
              value={roleFilter}
              onChange={setRoleFilter}
              options={[
                { value: 'all', label: 'All roles', count: countRole('all') },
                { value: 'buyer', label: 'Buyers', count: countRole('buyer') },
                { value: 'seller', label: 'Sellers', count: countRole('seller') },
              ]}
            />
            <FilterChips
              value={statusFilter}
              onChange={setStatusFilter}
              options={[
                { value: 'all', label: 'Any status', count: countStatus('all') },
                { value: 'review', label: 'Needs review', count: countStatus('review') },
                { value: 'verified', label: 'Verified', count: countStatus('verified') },
                { value: 'unverified', label: 'Unverified', count: countStatus('unverified') },
                { value: 'rejected', label: 'Rejected', count: countStatus('rejected') },
              ]}
            />
          </View>

          {shown.length === 0 ? (
            <EmptyState
              title={businesses.length === 0 ? 'No businesses registered yet' : 'No businesses match'}
              body={
                businesses.length === 0
                  ? 'Businesses appear here as soon as they sign up.'
                  : 'Try a different search or clear the filters.'
              }
            />
          ) : (
            shown.map((b) => {
              const name = b.registered_name || b.business_name;
              const reviewing = needsReview(b);
              const sub = [b.business_type, b.industry_category].filter(Boolean).join(' · ');
              return (
                <AdminCard key={b.user_id} highlight={reviewing}>
                  <View style={styles.cardHeader}>
                    <BusinessLink businessId={b.user_id} name={name}>
                      <AvatarChip label={initials(name)} size={44} dark={!b.is_verified} />
                    </BusinessLink>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <BusinessNameLink businessId={b.user_id} name={name} style={styles.name} numberOfLines={1} />
                      {!!sub && <Text style={styles.sub} numberOfLines={1}>{sub}</Text>}
                    </View>
                    <View style={styles.pillRow}>
                      {b.role && <Pill label={b.role} tone="solid" />}
                      <Pill label={STATUS_LABELS[b.verification_status] ?? b.verification_status} tone={statusTone(b.verification_status)} />
                      {b.banned_at ? (
                        <Pill label="Banned" tone="danger" />
                      ) : b.suspended_until && new Date(b.suspended_until) > new Date() ? (
                        <Pill label={`Suspended until ${formatDate(b.suspended_until)}`} tone="danger" />
                      ) : null}
                    </View>
                  </View>

                  <InfoGrid
                    items={[
                      { label: 'Location', value: [b.city, b.province].filter(Boolean).join(', ') || '—' },
                      { label: 'Login mobile', value: b.mobile_number || '—' },
                      { label: 'Trust tier', value: `Tier ${b.tier}` },
                      { label: 'Onboarding', value: b.onboarding_completed ? 'Complete' : 'Incomplete' },
                      { label: 'Submitted', value: formatDate(b.submitted_at) },
                      { label: 'Joined', value: formatDate(b.created_at) },
                    ]}
                  />
                  {b.last_review && (
                    <Text style={styles.sub}>
                      {b.last_review.approved ? 'Approved' : 'Rejected'} by {b.last_review.admin_name} · {formatDate(b.last_review.reviewed_at)}
                    </Text>
                  )}
                  {(b.banned_at || (b.suspended_until && new Date(b.suspended_until) > new Date())) && (
                    <View style={{ alignSelf: 'flex-start' }}>
                      <GhostButton
                        label="Lift restriction"
                        onPress={async () => {
                          try {
                            await liftRestriction(b.user_id, 'Restriction lifted by an administrator.');
                            await load();
                          } catch (e: any) {
                            setError(errorMessage(e, 'Could not lift the restriction.'));
                          }
                        }}
                      />
                    </View>
                  )}

                  {b.documents.length > 0 && <DocumentList docs={b.documents} onError={setError} />}

                  {reviewing && (
                    <ReviewPanel
                      notes={notesByUser[b.user_id] ?? ''}
                      onChangeNotes={(text) => setNotesByUser((prev) => ({ ...prev, [b.user_id]: text }))}
                      busy={actingOn === b.user_id}
                      onApprove={() => handleReview(b.user_id, true)}
                      onReject={() => handleReview(b.user_id, false)}
                    />
                  )}
                </AdminCard>
              );
            })
          )}
        </>
      )}
    </AdminShell>
  );
}

const styles = StyleSheet.create({
  filters: { marginBottom: space.sm },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: space.md, flexWrap: 'wrap' },
  name: { fontFamily: font.bodySemi, fontSize: fontSize.md, lineHeight: lineHeight.md, color: color.ink },
  sub: { fontFamily: font.body, fontSize: fontSize.sm, color: color.inkMuted },
  pillRow: { flexDirection: 'row', gap: space.xs, flexWrap: 'wrap' },
});
