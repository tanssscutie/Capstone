// app/admin.tsx
// Admin dashboard: an attention banner + KPI cards and a 7-day registrations
// chart (from GET /business/admin/stats) above the review queue
// (GET /business/admin/flagged + POST .../review).
// Kept to the app's existing design tokens on purpose — no new colours, no
// icon library, no chart dependency. The "chart" is plain Views sized by
// proportion, same technique the rest of the app uses for hand-built icons.
import { useCallback, useEffect, useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { color, font, fontSize, lineHeight, letterSpacing, space, radius } from '../components/ui/tokens';
import { AvatarChip, initials } from '../components/ui/AvatarChip';
import {
  AdminShell,
  AdminCard,
  DocumentList,
  EmptyState,
  ErrorBanner,
  GhostButton,
  InfoGrid,
  LoadingBlock,
  Pill,
  ReviewPanel,
  SectionHeader,
  timeAgo,
  useAdminAccess,
} from '../components/ui/AdminKit';
import { listFlagged, reviewBusiness, getAdminStats } from '../lib/api/admin';
import type { AdminFlaggedBusinessOut, AdminStatsOut } from '../lib/api/admin';
import { errorMessage } from '../lib/api/client';
import { BusinessLink, BusinessNameLink } from '../components/ui/BusinessLink';

function formatShortDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(5);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function todayLabel(): string {
  return new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
}

/* ─── Overview ──────────────────────────────────────── */

function AttentionBanner({ count }: { count: number }) {
  const waiting = count > 0;
  return (
    <View style={[styles.banner, waiting ? styles.bannerWaiting : styles.bannerClear]}>
      <View style={[styles.bannerBadge, waiting ? styles.bannerBadgeWaiting : styles.bannerBadgeClear]}>
        <Text style={styles.bannerBadgeLabel}>{count}</Text>
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={[styles.bannerTitle, waiting && { color: color.danger }]}>
          {waiting
            ? `${count} business${count === 1 ? '' : 'es'} waiting for verification review`
            : 'All caught up — nothing waiting for review'}
        </Text>
        <Text style={styles.bannerBody}>
          {waiting
            ? 'Check their documents in the review queue below, then approve or reject.'
            : 'New submissions will appear in the review queue as soon as they arrive.'}
        </Text>
      </View>
    </View>
  );
}

function StatCard({
  label,
  value,
  caption,
  progress,
}: {
  label: string;
  value: number;
  caption: string;
  /** 0–1; draws a thin progress bar under the caption when set. */
  progress?: number;
}) {
  return (
    <View style={styles.statCard}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={styles.statValue}>{value.toLocaleString()}</Text>
      <Text style={styles.statCaption}>{caption}</Text>
      {progress !== undefined && (
        <View style={styles.progressTrack}>
          <View style={[styles.progressFill, { width: `${Math.round(Math.min(1, Math.max(0, progress)) * 100)}%` }]} />
        </View>
      )}
    </View>
  );
}

/** Small monochrome bar chart — no chart library in this project, and one
 *  week of data doesn't need one. Bars are plain Views, heights scaled to
 *  the week's max so a quiet week doesn't look identical to a busy one.
 *  The last bar (today) is solid; earlier days are lighter. */
function RegistrationsChart({ data }: { data: AdminStatsOut['registrations_last_7_days'] }) {
  const max = Math.max(1, ...data.map((d) => d.count));
  const total = data.reduce((a, d) => a + d.count, 0);
  const CHART_HEIGHT = 120;

  return (
    <View style={styles.chartCard}>
      <View style={styles.chartHeader}>
        <View>
          <Text style={styles.statLabel}>New registrations</Text>
          <Text style={styles.chartSub}>Last 7 days</Text>
        </View>
        <View style={{ alignItems: 'flex-end' }}>
          <Text style={styles.chartTotal}>{total}</Text>
          <Text style={styles.chartSub}>this week</Text>
        </View>
      </View>
      <View style={styles.chartBars}>
        {data.map((d, i) => {
          const isToday = i === data.length - 1;
          const barHeight = d.count === 0 ? 3 : Math.max(6, Math.round((d.count / max) * CHART_HEIGHT));
          return (
            <View key={d.date} style={styles.chartColumn}>
              <Text style={[styles.chartValue, isToday && styles.chartValueToday]}>{d.count}</Text>
              <View style={[styles.chartTrack, { height: CHART_HEIGHT }]}>
                <View style={[styles.chartBar, { height: barHeight }, isToday ? styles.chartBarToday : null]} />
              </View>
            </View>
          );
        })}
      </View>
      <View style={styles.chartLabels}>
        {data.map((d, i) => {
          const isToday = i === data.length - 1;
          return (
            <Text key={d.date} style={[styles.chartLabel, isToday && styles.chartLabelToday]} numberOfLines={1}>
              {isToday ? 'Today' : formatShortDate(d.date)}
            </Text>
          );
        })}
      </View>
    </View>
  );
}

/* ─── Review queue ──────────────────────────────────── */

function QueueCard({
  b,
  notes,
  onChangeNotes,
  busy,
  onReview,
  onError,
}: {
  b: AdminFlaggedBusinessOut;
  notes: string;
  onChangeNotes: (v: string) => void;
  busy: boolean;
  onReview: (approve: boolean) => void;
  onError: (message: string) => void;
}) {
  const name = b.registered_name || b.business_name;
  const location = [b.city, b.province].filter(Boolean).join(', ');
  return (
    <AdminCard highlight>
      <View style={styles.queueHeader}>
        <BusinessLink businessId={b.user_id} name={name}>
          <AvatarChip label={initials(name)} size={44} dark={false} />
        </BusinessLink>
        <View style={{ flex: 1, minWidth: 0 }}>
          <BusinessNameLink businessId={b.user_id} name={name} style={styles.queueName} numberOfLines={1} />
          <Text style={styles.queueSub}>Submitted {timeAgo(b.submitted_at)}</Text>
        </View>
        <View style={styles.pillRow}>
          {b.role && <Pill label={b.role} tone="solid" />}
          {b.business_type && <Pill label={b.business_type} />}
        </View>
      </View>

      <InfoGrid
        items={[
          { label: 'Industry', value: b.industry_category || '—' },
          { label: 'Location', value: location || '—' },
          { label: 'Contact person', value: b.contact_person || '—' },
          { label: 'Contact mobile', value: b.contact_mobile || '—' },
          { label: 'Login mobile', value: b.mobile_number || '—' },
        ]}
      />

      <DocumentList docs={b.documents} onError={onError} />

      <ReviewPanel
        notes={notes}
        onChangeNotes={onChangeNotes}
        busy={busy}
        onApprove={() => onReview(true)}
        onReject={() => onReview(false)}
      />
    </AdminCard>
  );
}

export default function AdminRoute() {
  const router = useRouter();
  const access = useAdminAccess();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [businesses, setBusinesses] = useState<AdminFlaggedBusinessOut[]>([]);
  const [stats, setStats] = useState<AdminStatsOut | null>(null);
  const [notesByUser, setNotesByUser] = useState<Record<number, string>>({});
  const [actingOn, setActingOn] = useState<number | null>(null);

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [rows, statsOut] = await Promise.all([listFlagged(), getAdminStats()]);
      setBusinesses(rows);
      setStats(statsOut);
    } catch (e: any) {
      setError(errorMessage(e, 'Could not load the admin dashboard.'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (access === 'GRANTED') loadAll();
  }, [access, loadAll]);

  async function handleReview(userId: number, approve: boolean) {
    setActingOn(userId);
    setError(null);
    try {
      await reviewBusiness(userId, approve, notesByUser[userId]);
      setBusinesses((prev) => prev.filter((b) => b.user_id !== userId));
      setStats((prev) => (prev ? { ...prev, pending_review_count: Math.max(0, prev.pending_review_count - 1) } : prev));
    } catch (e: any) {
      setError(errorMessage(e, 'Could not record that decision.'));
    } finally {
      setActingOn(null);
    }
  }

  const verifiedShare = stats && stats.total_businesses > 0 ? stats.verified_businesses / stats.total_businesses : 0;

  return (
    <AdminShell
      access={access}
      title="Dashboard"
      subtitle={todayLabel()}
      actions={<GhostButton label="Refresh" onPress={loadAll} busy={loading} />}
    >
      {error && <ErrorBanner message={error} />}

      {loading && !stats ? (
        <LoadingBlock />
      ) : (
        <>
          {stats && (
            <>
              <AttentionBanner count={stats.pending_review_count} />
              {stats.open_reports_count > 0 && (
                <Pressable onPress={() => router.push('/admin-reports')} style={[styles.banner, styles.bannerWaiting]} accessibilityRole="link">
                  <View style={[styles.bannerBadge, styles.bannerBadgeWaiting]}>
                    <Text style={styles.bannerBadgeLabel}>{stats.open_reports_count}</Text>
                  </View>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={[styles.bannerTitle, { color: color.danger }]}>
                      {stats.open_reports_count} business report{stats.open_reports_count === 1 ? '' : 's'} waiting for review
                    </Text>
                    <Text style={styles.bannerBody}>Open Reports to resolve or dismiss them.</Text>
                  </View>
                </Pressable>
              )}

              <View style={styles.statsGrid}>
                <StatCard
                  label="Businesses"
                  value={stats.total_businesses}
                  caption={`${stats.total_buyers} buyer${stats.total_buyers === 1 ? '' : 's'} · ${stats.total_sellers} seller${stats.total_sellers === 1 ? '' : 's'}`}
                />
                <StatCard
                  label="Verified"
                  value={stats.verified_businesses}
                  caption={`${Math.round(verifiedShare * 100)}% of all businesses`}
                  progress={verifiedShare}
                />
                <StatCard
                  label="Requirements"
                  value={stats.total_requirements}
                  caption={`${stats.open_requirements} open right now`}
                />
                <StatCard label="Quotations" value={stats.total_quotations} caption="Submitted across all requirements" />
              </View>

              <RegistrationsChart data={stats.registrations_last_7_days} />
            </>
          )}

          <SectionHeader
            title="Review queue"
            caption={`${businesses.length} business${businesses.length === 1 ? '' : 'es'} waiting on a decision`}
          />

          {businesses.length === 0 ? (
            <EmptyState
              title="Nothing waiting on review"
              body="When a business submits its verification documents, it shows up here for approval."
            />
          ) : (
            businesses.map((b) => (
              <QueueCard
                key={b.user_id}
                b={b}
                notes={notesByUser[b.user_id] ?? ''}
                onChangeNotes={(text) => setNotesByUser((prev) => ({ ...prev, [b.user_id]: text }))}
                busy={actingOn === b.user_id}
                onReview={(approve) => handleReview(b.user_id, approve)}
                onError={setError}
              />
            ))
          )}
        </>
      )}
    </AdminShell>
  );
}

const styles = StyleSheet.create({
  /* attention banner */
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.lg,
    borderRadius: radius.xl,
    borderWidth: 1,
    padding: space.xl,
    marginBottom: space.lg,
  },
  bannerWaiting: { backgroundColor: color.dangerFaint, borderColor: color.dangerBorder },
  bannerClear: { backgroundColor: color.primaryFaint, borderColor: color.primaryBorder },
  bannerBadge: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
  bannerBadgeWaiting: { backgroundColor: color.danger },
  bannerBadgeClear: { backgroundColor: color.primary },
  bannerBadgeLabel: { fontFamily: font.display, fontSize: fontSize.lg, color: color.onPrimary },
  bannerTitle: { fontFamily: font.bodySemi, fontSize: fontSize.md, lineHeight: lineHeight.md, color: color.primary },
  bannerBody: { fontFamily: font.body, fontSize: fontSize.sm, lineHeight: lineHeight.sm, color: color.inkMuted, marginTop: 2 },

  /* KPI cards */
  statsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.md, marginBottom: space.lg },
  statCard: {
    flexGrow: 1,
    flexBasis: 200,
    backgroundColor: color.surface,
    borderWidth: 1,
    borderColor: color.border,
    borderRadius: radius.xl,
    padding: space.xl,
  },
  statLabel: {
    fontFamily: font.monoMedium,
    fontSize: fontSize.micro,
    lineHeight: lineHeight.micro,
    letterSpacing: letterSpacing.label,
    textTransform: 'uppercase',
    color: color.inkMuted,
  },
  statValue: {
    fontFamily: font.display,
    fontSize: fontSize.display,
    lineHeight: lineHeight.display,
    letterSpacing: letterSpacing.tight,
    color: color.ink,
    marginTop: space.sm,
  },
  statCaption: { fontFamily: font.body, fontSize: fontSize.sm, color: color.inkMuted, marginTop: space.xs },
  progressTrack: { height: 4, borderRadius: 2, backgroundColor: color.surfaceSunken, marginTop: space.md, overflow: 'hidden' },
  progressFill: { height: 4, borderRadius: 2, backgroundColor: color.primary },

  /* chart */
  chartCard: {
    backgroundColor: color.surface,
    borderWidth: 1,
    borderColor: color.border,
    borderRadius: radius.xl,
    padding: space.xl,
    marginBottom: space.md,
  },
  chartHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: space.xl },
  chartSub: { fontFamily: font.body, fontSize: fontSize.sm, color: color.inkFaint, marginTop: 2 },
  chartTotal: { fontFamily: font.display, fontSize: fontSize.xl, lineHeight: lineHeight.xl, color: color.ink },
  chartBars: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: space.sm,
    borderBottomWidth: 1,
    borderBottomColor: color.border,
    paddingBottom: 0,
  },
  chartColumn: { flex: 1, alignItems: 'center' },
  chartValue: { fontFamily: font.monoMedium, fontSize: fontSize.micro, color: color.inkFaint, marginBottom: space.xs },
  chartValueToday: { color: color.primary },
  chartTrack: { width: '100%', maxWidth: 44, justifyContent: 'flex-end' },
  chartBar: { width: '100%', backgroundColor: color.primaryBorder, borderTopLeftRadius: radius.sm, borderTopRightRadius: radius.sm },
  chartBarToday: { backgroundColor: color.primary },
  chartLabels: { flexDirection: 'row', gap: space.sm, marginTop: space.sm },
  chartLabel: { flex: 1, textAlign: 'center', fontFamily: font.body, fontSize: fontSize.micro, color: color.inkFaint },
  chartLabelToday: { fontFamily: font.bodySemi, color: color.primary },

  /* queue */
  queueHeader: { flexDirection: 'row', alignItems: 'center', gap: space.md, flexWrap: 'wrap' },
  queueName: { fontFamily: font.bodySemi, fontSize: fontSize.md, lineHeight: lineHeight.md, color: color.ink },
  queueSub: { fontFamily: font.body, fontSize: fontSize.sm, color: color.inkMuted },
  pillRow: { flexDirection: 'row', gap: space.xs, flexWrap: 'wrap' },
});
