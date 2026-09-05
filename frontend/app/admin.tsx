// app/admin.tsx
// Admin dashboard: a compact stats overview (from GET /business/admin/stats)
// above the review queue (GET /business/admin/flagged + POST .../review).
// Kept to the app's existing design tokens on purpose — no new colours, no
// icon library, no chart dependency. The "chart" is plain Views sized by
// proportion, same technique the rest of the app uses for hand-built icons.
import { useCallback, useEffect, useState } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet, ActivityIndicator, ScrollView, useWindowDimensions } from 'react-native';
import { useRouter } from 'expo-router';
import { color, font, fontSize, space, radius, layout, breakpoint } from '../components/ui/tokens';
import { AdminSidebar } from '../components/ui/AdminSidebar';
import { checkAdminAccess, listFlagged, reviewBusiness, getAdminStats } from '../lib/api/admin';
import type { AdminFlaggedBusinessOut, AdminStatsOut } from '../lib/api/admin';
import { logout } from '../lib/api/auth';

type Access = 'CHECKING' | 'GRANTED' | 'DENIED';

function formatShortDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(5);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/** Small monochrome bar chart — no chart library in this project, and one
 *  week of data doesn't need one. Bars are plain Views, heights scaled to
 *  the week's max so a quiet week doesn't look identical to a busy one. */
function RegistrationsChart({ data }: { data: AdminStatsOut['registrations_last_7_days'] }) {
  const max = Math.max(1, ...data.map((d) => d.count));
  const CHART_HEIGHT = 96;

  return (
    <View style={styles.chartCard}>
      <Text style={styles.chartTitle}>New registrations · last 7 days</Text>
      <View style={styles.chartBars}>
        {data.map((d) => {
          const barHeight = Math.max(3, Math.round((d.count / max) * CHART_HEIGHT));
          return (
            <View key={d.date} style={styles.chartColumn}>
              <Text style={styles.chartValue}>{d.count}</Text>
              <View style={styles.chartTrack}>
                <View style={[styles.chartBar, { height: barHeight }]} />
              </View>
              <Text style={styles.chartLabel}>{formatShortDate(d.date)}</Text>
            </View>
          );
        })}
      </View>
    </View>
  );
}

export default function AdminRoute() {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const isDesktop = width >= breakpoint.desktop;
  const [access, setAccess] = useState<Access>('CHECKING');
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
      setError(typeof e?.detail === 'string' ? e.detail : e?.message ?? 'Could not load the admin dashboard.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    (async () => {
      const isAdmin = await checkAdminAccess();
      if (!isAdmin) {
        setAccess('DENIED');
        router.replace('/admin-login');
        return;
      }
      setAccess('GRANTED');
      await loadAll();
    })();
  }, [loadAll, router]);

  async function handleReview(userId: number, approve: boolean) {
    setActingOn(userId);
    setError(null);
    try {
      await reviewBusiness(userId, approve, notesByUser[userId]);
      setBusinesses((prev) => prev.filter((b) => b.user_id !== userId));
      setStats((prev) => (prev ? { ...prev, pending_review_count: Math.max(0, prev.pending_review_count - 1) } : prev));
    } catch (e: any) {
      setError(typeof e?.detail === 'string' ? e.detail : e?.message ?? 'Could not record that decision.');
    } finally {
      setActingOn(null);
    }
  }

  function handleLogout() {
    logout();
    router.replace('/admin-login');
  }

  if (access === 'CHECKING') {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color={color.primary} />
      </View>
    );
  }

  if (access === 'DENIED') {
    return null; // redirecting
  }

  const statCards = stats
    ? [
        { label: 'Pending review', value: stats.pending_review_count, emphasis: true },
        { label: 'Total businesses', value: stats.total_businesses },
        { label: 'Verified businesses', value: stats.verified_businesses },
        { label: 'Open requirements', value: stats.open_requirements },
        { label: 'Total quotations', value: stats.total_quotations },
      ]
    : [];

  return (
    <View style={styles.root}>
      {isDesktop && <AdminSidebar onLogout={handleLogout} />}
      <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
        <View style={styles.headerRow}>
          <View>
            <Text style={styles.eyebrow}>TrustLink Admin</Text>
            <Text style={styles.title}>Dashboard</Text>
          </View>
          {!isDesktop && (
            <Pressable onPress={handleLogout} style={styles.logoutButton}>
              <Text style={styles.logoutLabel}>Log out</Text>
            </Pressable>
          )}
        </View>

      {error && <Text style={styles.error}>{error}</Text>}

      {loading && !stats ? (
        <View style={styles.centeredInline}>
          <ActivityIndicator color={color.primary} />
        </View>
      ) : (
        <>
          {stats && (
            <View style={styles.statsRow}>
              {statCards.map((s) => (
                <View key={s.label} style={[styles.statCard, s.emphasis && styles.statCardEmphasis]}>
                  <Text style={[styles.statValue, s.emphasis && styles.statValueEmphasis]}>{s.value}</Text>
                  <Text style={styles.statLabel}>{s.label}</Text>
                </View>
              ))}
            </View>
          )}

          {stats && <RegistrationsChart data={stats.registrations_last_7_days} />}

          <View style={styles.sectionHeaderRow}>
            <Text style={styles.sectionTitle}>Review queue</Text>
            <Text style={styles.sectionSubtitle}>
              {businesses.length} business{businesses.length === 1 ? '' : 'es'} waiting on a decision
            </Text>
          </View>

          {businesses.length === 0 ? (
            <View style={styles.emptyState}>
              <Text style={styles.emptyText}>Nothing waiting on review right now.</Text>
            </View>
          ) : (
            businesses.map((b) => (
              <View key={b.user_id} style={styles.card}>
                <View style={styles.cardHeaderRow}>
                  <Text style={styles.businessName}>{b.registered_name || b.business_name}</Text>
                  {b.business_type && <Text style={styles.badge}>{b.business_type}</Text>}
                </View>
                <Text style={styles.metaLine}>
                  {[b.industry_category, [b.city, b.province].filter(Boolean).join(', ')].filter(Boolean).join(' · ') || '—'}
                </Text>
                <Text style={styles.metaLine}>
                  Contact: {b.contact_person || '—'} {b.contact_mobile ? `(${b.contact_mobile})` : ''}
                </Text>
                <Text style={styles.metaLine}>Login mobile: {b.mobile_number}</Text>
                {b.submitted_at && (
                  <Text style={styles.metaLine}>Submitted: {new Date(b.submitted_at).toLocaleString()}</Text>
                )}

                <View style={styles.docsSection}>
                  <Text style={styles.docsLabel}>Documents ({b.documents.length})</Text>
                  {b.documents.map((doc) => (
                    <View key={doc.id} style={styles.docRow}>
                      <Text style={styles.docType}>{doc.doc_type}</Text>
                      <Text style={styles.docStatus}>{doc.validation_status}</Text>
                      {doc.validation_notes ? <Text style={styles.docNotes}>{doc.validation_notes}</Text> : null}
                    </View>
                  ))}
                </View>

                <TextInput
                  style={styles.notesInput}
                  value={notesByUser[b.user_id] ?? ''}
                  onChangeText={(text) => setNotesByUser((prev) => ({ ...prev, [b.user_id]: text }))}
                  placeholder="Notes for this decision (optional)"
                  placeholderTextColor={color.inkFaint}
                  multiline
                />

                <View style={styles.actionsRow}>
                  <Pressable
                    style={[styles.actionButton, styles.approveButton, actingOn === b.user_id && styles.actionButtonDisabled]}
                    disabled={actingOn === b.user_id}
                    onPress={() => handleReview(b.user_id, true)}
                  >
                    {actingOn === b.user_id ? (
                      <ActivityIndicator color={color.onPrimary} />
                    ) : (
                      <Text style={styles.approveLabel}>Approve</Text>
                    )}
                  </Pressable>
                  <Pressable
                    style={[styles.actionButton, styles.rejectButton, actingOn === b.user_id && styles.actionButtonDisabled]}
                    disabled={actingOn === b.user_id}
                    onPress={() => handleReview(b.user_id, false)}
                  >
                    {actingOn === b.user_id ? (
                      <ActivityIndicator color={color.danger} />
                    ) : (
                      <Text style={styles.rejectLabel}>Reject</Text>
                    )}
                  </Pressable>
                </View>
              </View>
            ))
          )}
        </>
      )}
    </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    flexDirection: 'row',
    backgroundColor: color.canvas,
  },

  screen: {
    flex: 1,
    backgroundColor: color.canvas,
  },
  content: {
    width: '100%',
    maxWidth: layout.maxWidthWide,
    alignSelf: 'center',
    padding: space.xl,
    paddingBottom: space.section,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: color.canvas,
  },
  centeredInline: {
    paddingVertical: space.xxl,
    alignItems: 'center',
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: space.xl,
  },
  eyebrow: {
    fontFamily: font.monoMedium,
    fontSize: fontSize.micro,
    color: color.inkMuted,
    letterSpacing: 2,
    textTransform: 'uppercase',
    marginBottom: space.xs,
  },
  title: {
    fontFamily: font.display,
    fontSize: fontSize.xl,
    color: color.ink,
  },
  logoutButton: {
    borderWidth: 1,
    borderColor: color.border,
    borderRadius: radius.md,
    paddingHorizontal: space.lg,
    paddingVertical: space.sm,
  },
  logoutLabel: {
    fontFamily: font.bodyMedium,
    fontSize: fontSize.sm,
    color: color.ink,
  },
  error: {
    fontFamily: font.body,
    fontSize: fontSize.sm,
    color: color.danger,
    marginBottom: space.lg,
  },

  /* ─── Stats ────────────────────────────── */
  statsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: space.md,
    marginBottom: space.lg,
  },
  statCard: {
    flexGrow: 1,
    flexBasis: 150,
    backgroundColor: color.surface,
    borderWidth: 1,
    borderColor: color.border,
    borderRadius: radius.lg,
    paddingVertical: space.lg,
    paddingHorizontal: space.lg,
  },
  statCardEmphasis: {
    borderColor: color.dangerBorder,
    backgroundColor: color.dangerFaint,
  },
  statValue: {
    fontFamily: font.display,
    fontSize: fontSize.xl,
    color: color.ink,
    marginBottom: space.xs,
  },
  statValueEmphasis: {
    color: color.danger,
  },
  statLabel: {
    fontFamily: font.bodyMedium,
    fontSize: fontSize.sm,
    color: color.inkMuted,
  },

  /* ─── Chart ────────────────────────────── */
  chartCard: {
    backgroundColor: color.surface,
    borderWidth: 1,
    borderColor: color.border,
    borderRadius: radius.lg,
    padding: space.lg,
    marginBottom: space.xl,
  },
  chartTitle: {
    fontFamily: font.bodyMedium,
    fontSize: fontSize.sm,
    color: color.ink,
    marginBottom: space.lg,
  },
  chartBars: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
  },
  chartColumn: {
    alignItems: 'center',
    flex: 1,
  },
  chartValue: {
    fontFamily: font.monoMedium,
    fontSize: fontSize.micro,
    color: color.inkMuted,
    marginBottom: space.xs,
  },
  chartTrack: {
    height: 96,
    width: 20,
    justifyContent: 'flex-end',
  },
  chartBar: {
    width: '100%',
    backgroundColor: color.primary,
    borderRadius: radius.sm,
  },
  chartLabel: {
    fontFamily: font.body,
    fontSize: fontSize.micro,
    color: color.inkFaint,
    marginTop: space.xs,
  },

  /* ─── Review queue ─────────────────────── */
  sectionHeaderRow: {
    marginBottom: space.md,
  },
  sectionTitle: {
    fontFamily: font.bodySemi,
    fontSize: fontSize.lg,
    color: color.ink,
  },
  sectionSubtitle: {
    fontFamily: font.body,
    fontSize: fontSize.sm,
    color: color.inkMuted,
    marginTop: 2,
  },
  emptyState: {
    padding: space.xxl,
    alignItems: 'center',
    backgroundColor: color.surface,
    borderWidth: 1,
    borderColor: color.borderFaint,
    borderRadius: radius.lg,
  },
  emptyText: {
    fontFamily: font.body,
    fontSize: fontSize.base,
    color: color.inkMuted,
  },
  card: {
    backgroundColor: color.surface,
    borderWidth: 1,
    borderColor: color.border,
    borderRadius: radius.lg,
    padding: space.lg,
    marginBottom: space.lg,
  },
  cardHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: space.xs,
  },
  businessName: {
    fontFamily: font.bodySemi,
    fontSize: fontSize.md,
    color: color.ink,
  },
  badge: {
    fontFamily: font.monoMedium,
    fontSize: fontSize.micro,
    color: color.primary,
    backgroundColor: color.primaryFaint,
    borderRadius: radius.sm,
    paddingHorizontal: space.sm,
    paddingVertical: 2,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  metaLine: {
    fontFamily: font.body,
    fontSize: fontSize.sm,
    color: color.inkMuted,
    marginTop: 2,
  },
  docsSection: {
    marginTop: space.md,
    paddingTop: space.md,
    borderTopWidth: 1,
    borderTopColor: color.borderFaint,
  },
  docsLabel: {
    fontFamily: font.bodyMedium,
    fontSize: fontSize.sm,
    color: color.ink,
    marginBottom: space.xs,
  },
  docRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    marginBottom: space.xs,
  },
  docType: {
    fontFamily: font.monoMedium,
    fontSize: fontSize.micro,
    color: color.ink,
    marginRight: space.sm,
  },
  docStatus: {
    fontFamily: font.body,
    fontSize: fontSize.micro,
    color: color.inkMuted,
    marginRight: space.sm,
  },
  docNotes: {
    fontFamily: font.body,
    fontSize: fontSize.micro,
    color: color.danger,
  },
  notesInput: {
    borderWidth: 1,
    borderColor: color.border,
    borderRadius: radius.md,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    fontFamily: font.body,
    fontSize: fontSize.sm,
    color: color.ink,
    backgroundColor: color.canvas,
    marginTop: space.md,
    minHeight: 44,
  },
  actionsRow: {
    flexDirection: 'row',
    marginTop: space.md,
    gap: space.md,
  },
  actionButton: {
    flex: 1,
    borderRadius: radius.md,
    paddingVertical: space.md,
    alignItems: 'center',
  },
  actionButtonDisabled: {
    opacity: 0.5,
  },
  approveButton: {
    backgroundColor: color.primary,
  },
  approveLabel: {
    fontFamily: font.bodySemi,
    fontSize: fontSize.base,
    color: color.onPrimary,
  },
  rejectButton: {
    backgroundColor: color.surface,
    borderWidth: 1,
    borderColor: color.dangerBorder,
  },
  rejectLabel: {
    fontFamily: font.bodySemi,
    fontSize: fontSize.base,
    color: color.danger,
  },
});