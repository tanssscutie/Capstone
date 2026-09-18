// app/admin-requirements.tsx
// Admin's full requirement roster (GET /requirements/admin/all) — every
// requirement ever posted, across every business. Same shell as
// admin.tsx and admin-businesses.tsx.
import { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, ActivityIndicator, ScrollView, Pressable, useWindowDimensions } from 'react-native';
import { useRouter } from 'expo-router';
import { color, font, fontSize, space, radius, layout, breakpoint } from '../components/ui/tokens';
import { AdminSidebar } from '../components/ui/AdminSidebar';
import { checkAdminAccess, listAllRequirements } from '../lib/api/admin';
import type { AdminRequirementOut } from '../lib/api/admin';
import { logout } from '../lib/api/auth';
import { errorMessage } from '../lib/api/client';

type Access = 'CHECKING' | 'GRANTED' | 'DENIED';

const STATUS_LABELS: Record<string, string> = {
  open: 'Open',
  closed: 'Closed',
  cancelled: 'Cancelled',
  awarded: 'Awarded',
};

function StatusBadge({ status }: { status: string }) {
  const tone =
    status === 'open' || status === 'awarded'
      ? styles.badgePrimary
      : status === 'cancelled'
      ? styles.badgeDanger
      : styles.badgeNeutral;
  const label =
    tone === styles.badgePrimary ? styles.badgeLabelPrimary : tone === styles.badgeDanger ? styles.badgeLabelDanger : styles.badgeLabelNeutral;
  return (
    <View style={[styles.badge, tone]}>
      <Text style={[styles.badgeText, label]}>{STATUS_LABELS[status] ?? status}</Text>
    </View>
  );
}

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

function formatPriceRange(min: number | null, max: number | null): string {
  if (min !== null && max !== null) return `₱${Math.round(min).toLocaleString()} – ₱${Math.round(max).toLocaleString()}`;
  if (min !== null) return `From ₱${Math.round(min).toLocaleString()}`;
  if (max !== null) return `Up to ₱${Math.round(max).toLocaleString()}`;
  return 'Not specified';
}

export default function AdminRequirementsRoute() {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const isDesktop = width >= breakpoint.desktop;
  const [access, setAccess] = useState<Access>('CHECKING');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [requirements, setRequirements] = useState<AdminRequirementOut[]>([]);

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
    (async () => {
      const isAdmin = await checkAdminAccess();
      if (!isAdmin) {
        setAccess('DENIED');
        router.replace('/admin-login');
        return;
      }
      setAccess('GRANTED');
      await load();
    })();
  }, [load, router]);

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

  return (
    <View style={styles.root}>
      {isDesktop && <AdminSidebar onLogout={handleLogout} />}
      <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
        <View style={styles.headerRow}>
          <View>
            <Text style={styles.eyebrow}>TrustLink Admin</Text>
            <Text style={styles.title}>Requirements</Text>
          </View>
          {!isDesktop && (
            <Pressable onPress={handleLogout} style={styles.logoutButton}>
              <Text style={styles.logoutLabel}>Log out</Text>
            </Pressable>
          )}
        </View>

        {error && <Text style={styles.error}>{error}</Text>}

        {loading ? (
          <View style={styles.centeredInline}>
            <ActivityIndicator color={color.primary} />
          </View>
        ) : (
          <>
            <Text style={styles.sectionSubtitle}>
              {requirements.length} requirement{requirements.length === 1 ? '' : 's'} posted
            </Text>

            {requirements.length === 0 ? (
              <View style={styles.emptyState}>
                <Text style={styles.emptyText}>No requirements posted yet.</Text>
              </View>
            ) : (
              requirements.map((r) => (
                <View key={r.id} style={styles.card}>
                  <View style={styles.cardHeaderRow}>
                    <Text style={styles.requirementTitle} numberOfLines={1}>{r.title}</Text>
                    <StatusBadge status={r.status} />
                  </View>
                  <Text style={styles.metaLine}>
                    {r.ref_code} · {r.category || '—'} · {r.city || '—'}
                  </Text>
                  <Text style={styles.metaLine}>Posted by {r.owner_business_name}</Text>
                  <View style={styles.cardFooterRow}>
                    <Text style={styles.metaLineFaint}>{formatPriceRange(r.price_min, r.price_max)}</Text>
                    <Text style={styles.metaLineFaint}>
                      {r.quotations_count} quotation{r.quotations_count === 1 ? '' : 's'}
                    </Text>
                    <Text style={styles.metaLineFaint}>Closes {formatDate(r.closes_at)}</Text>
                    <Text style={styles.metaLineFaint}>Posted {formatDate(r.created_at)}</Text>
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
  root: { flex: 1, flexDirection: 'row', backgroundColor: color.canvas },
  screen: { flex: 1, backgroundColor: color.canvas },
  content: {
    width: '100%',
    maxWidth: layout.maxWidthWide,
    alignSelf: 'center',
    padding: space.xl,
    paddingBottom: space.section,
  },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: color.canvas },
  centeredInline: { paddingVertical: space.xxl, alignItems: 'center' },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: space.xl },
  eyebrow: {
    fontFamily: font.monoMedium,
    fontSize: fontSize.micro,
    color: color.inkMuted,
    letterSpacing: 2,
    textTransform: 'uppercase',
    marginBottom: space.xs,
  },
  title: { fontFamily: font.display, fontSize: fontSize.xl, color: color.ink },
  logoutButton: { borderWidth: 1, borderColor: color.border, borderRadius: radius.md, paddingHorizontal: space.lg, paddingVertical: space.sm },
  logoutLabel: { fontFamily: font.bodyMedium, fontSize: fontSize.sm, color: color.ink },
  error: { fontFamily: font.body, fontSize: fontSize.sm, color: color.danger, marginBottom: space.lg },

  sectionSubtitle: { fontFamily: font.body, fontSize: fontSize.sm, color: color.inkMuted, marginBottom: space.md },
  emptyState: {
    padding: space.xxl,
    alignItems: 'center',
    backgroundColor: color.surface,
    borderWidth: 1,
    borderColor: color.borderFaint,
    borderRadius: radius.lg,
  },
  emptyText: { fontFamily: font.body, fontSize: fontSize.base, color: color.inkMuted },

  card: {
    backgroundColor: color.surface,
    borderWidth: 1,
    borderColor: color.border,
    borderRadius: radius.lg,
    padding: space.lg,
    marginBottom: space.md,
  },
  cardHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: space.md, marginBottom: space.xs },
  requirementTitle: { fontFamily: font.bodySemi, fontSize: fontSize.md, color: color.ink, flexShrink: 1, flex: 1 },
  metaLine: { fontFamily: font.body, fontSize: fontSize.sm, color: color.inkMuted, marginTop: 2 },
  cardFooterRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: space.md,
    marginTop: space.sm,
    paddingTop: space.sm,
    borderTopWidth: 1,
    borderTopColor: color.borderFaint,
  },
  metaLineFaint: { fontFamily: font.body, fontSize: fontSize.micro, color: color.inkFaint },

  badge: { borderRadius: radius.sm, paddingHorizontal: space.sm, paddingVertical: 2 },
  badgePrimary: { backgroundColor: color.primaryFaint },
  badgeDanger: { backgroundColor: color.dangerFaint },
  badgeNeutral: { backgroundColor: color.surfaceSunken },
  badgeText: {
    fontFamily: font.monoMedium,
    fontSize: fontSize.micro,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  badgeLabelPrimary: { color: color.primary },
  badgeLabelDanger: { color: color.danger },
  badgeLabelNeutral: { color: color.inkMuted },
});
