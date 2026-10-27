// app/admin-requirements.tsx
// Admin's full requirement roster (GET /requirements/admin/all) — every
// requirement ever posted, across every business. Same shell as
// admin.tsx and admin-businesses.tsx, with search and a status filter.
import { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { color, font, fontSize, lineHeight, letterSpacing, space } from '../components/ui/tokens';
import {
  AdminShell,
  AdminCard,
  EmptyState,
  ErrorBanner,
  FilterChips,
  GhostButton,
  InfoGrid,
  LoadingBlock,
  Pill,
  SearchField,
  formatDate,
  useAdminAccess,
} from '../components/ui/AdminKit';
import type { PillTone } from '../components/ui/AdminKit';
import { listAllRequirements } from '../lib/api/admin';
import type { AdminRequirementOut } from '../lib/api/admin';
import { errorMessage } from '../lib/api/client';

const STATUS_LABELS: Record<string, string> = {
  open: 'Open',
  closed: 'Closed',
  cancelled: 'Cancelled',
  award_pending: 'Award pending',
  awarded: 'Awarded',
  closed_no_award: 'Closed · no award',
};

function statusTone(status: string): PillTone {
  if (status === 'open') return 'solid';
  if (status === 'awarded' || status === 'award_pending') return 'primary';
  if (status === 'cancelled') return 'danger';
  return 'neutral';
}

type StatusFilter = 'all' | 'open' | 'awarded' | 'closed' | 'cancelled';

const STATUS_MATCH: Record<StatusFilter, (r: AdminRequirementOut) => boolean> = {
  all: () => true,
  open: (r) => r.status === 'open',
  awarded: (r) => r.status === 'awarded' || r.status === 'award_pending',
  closed: (r) => r.status === 'closed' || r.status === 'closed_no_award',
  cancelled: (r) => r.status === 'cancelled',
};

function formatPriceRange(min: number | null, max: number | null): string {
  if (min !== null && max !== null) return `₱${Math.round(min).toLocaleString()} – ₱${Math.round(max).toLocaleString()}`;
  if (min !== null) return `From ₱${Math.round(min).toLocaleString()}`;
  if (max !== null) return `Up to ₱${Math.round(max).toLocaleString()}`;
  return 'Not specified';
}

function matchesSearch(r: AdminRequirementOut, q: string): boolean {
  if (!q) return true;
  return [r.title, r.ref_code, r.owner_business_name, r.category, r.city]
    .filter(Boolean)
    .some((v) => v.toLowerCase().includes(q));
}

export default function AdminRequirementsRoute() {
  const access = useAdminAccess();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [requirements, setRequirements] = useState<AdminRequirementOut[]>([]);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [search, setSearch] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setRequirements(await listAllRequirements());
    } catch (e: any) {
      setError(errorMessage(e, 'Could not load requirements.'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (access === 'GRANTED') load();
  }, [access, load]);

  const q = search.trim().toLowerCase();
  const shown = requirements.filter((r) => STATUS_MATCH[statusFilter](r) && matchesSearch(r, q));
  const count = (s: StatusFilter) => requirements.filter(STATUS_MATCH[s]).length;

  return (
    <AdminShell
      access={access}
      title="Requirements"
      subtitle={`${requirements.length} requirement${requirements.length === 1 ? '' : 's'} posted`}
      actions={<GhostButton label="Refresh" onPress={load} busy={loading} />}
    >
      {error && <ErrorBanner message={error} />}

      {loading && requirements.length === 0 ? (
        <LoadingBlock />
      ) : (
        <>
          <SearchField value={search} onChangeText={setSearch} placeholder="Search by title, reference, buyer or city" />
          <View style={styles.filters}>
            <FilterChips
              value={statusFilter}
              onChange={setStatusFilter}
              options={[
                { value: 'all', label: 'All', count: count('all') },
                { value: 'open', label: 'Open', count: count('open') },
                { value: 'awarded', label: 'Awarded', count: count('awarded') },
                { value: 'closed', label: 'Closed', count: count('closed') },
                { value: 'cancelled', label: 'Cancelled', count: count('cancelled') },
              ]}
            />
          </View>

          {shown.length === 0 ? (
            <EmptyState
              title={requirements.length === 0 ? 'No requirements posted yet' : 'No requirements match'}
              body={
                requirements.length === 0
                  ? 'Requirements appear here as soon as a buyer posts one.'
                  : 'Try a different search or clear the filter.'
              }
            />
          ) : (
            shown.map((r) => (
              <AdminCard key={r.id} highlight={r.status === 'open'}>
                <View style={styles.cardTop}>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={styles.ref}>{r.ref_code}</Text>
                    <Text style={styles.title} numberOfLines={2}>{r.title}</Text>
                    <Text style={styles.sub} numberOfLines={1}>
                      Posted by <Text style={styles.subStrong}>{r.owner_business_name}</Text>
                      {r.category ? ` · ${r.category}` : ''}
                      {r.city ? ` · ${r.city}` : ''}
                    </Text>
                  </View>
                  <Pill label={STATUS_LABELS[r.status] ?? r.status} tone={statusTone(r.status)} />
                </View>

                <InfoGrid
                  items={[
                    { label: 'Budget', value: formatPriceRange(r.price_min, r.price_max) },
                    { label: 'Quotations', value: `${r.quotations_count} received` },
                    { label: 'Closes', value: formatDate(r.closes_at) },
                    { label: 'Posted', value: formatDate(r.created_at) },
                  ]}
                />
              </AdminCard>
            ))
          )}
        </>
      )}
    </AdminShell>
  );
}

const styles = StyleSheet.create({
  filters: { marginBottom: space.sm },
  cardTop: { flexDirection: 'row', alignItems: 'flex-start', gap: space.md },
  ref: {
    fontFamily: font.monoMedium,
    fontSize: fontSize.micro,
    lineHeight: lineHeight.micro,
    letterSpacing: letterSpacing.label,
    textTransform: 'uppercase',
    color: color.primary,
    marginBottom: space.xs,
  },
  title: { fontFamily: font.bodySemi, fontSize: fontSize.md, lineHeight: lineHeight.md, color: color.ink },
  sub: { fontFamily: font.body, fontSize: fontSize.sm, color: color.inkMuted, marginTop: space.xs },
  subStrong: { fontFamily: font.bodyMedium, color: color.ink },
});
