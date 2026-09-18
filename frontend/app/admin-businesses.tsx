// app/admin-businesses.tsx
// Admin's full business roster (GET /business/admin/businesses) — every
// registered business, not just the ones currently waiting on review.
// Same shell as admin.tsx (sidebar, auth guard) with a read-only list below.
import { useCallback, useEffect, useState } from 'react';
import { View, Text, TextInput, StyleSheet, ActivityIndicator, ScrollView, Pressable, useWindowDimensions } from 'react-native';
import { useRouter } from 'expo-router';
import { color, font, fontSize, space, radius, layout, breakpoint } from '../components/ui/tokens';
import { AdminSidebar } from '../components/ui/AdminSidebar';
import { checkAdminAccess, listAllBusinesses, reviewBusiness, openAdminDocumentFile } from '../lib/api/admin';
import type { AdminBusinessOut } from '../lib/api/admin';
import type { DocumentUploadOut } from '../lib/api/business';
import { logout } from '../lib/api/auth';
import { errorMessage } from '../lib/api/client';

type Access = 'CHECKING' | 'GRANTED' | 'DENIED';

const STATUS_LABELS: Record<string, string> = {
  unverified: 'Unverified',
  pending: 'Pending',
  submitted: 'Submitted',
  under_review: 'Under review',
  verified: 'Verified',
  rejected: 'Rejected',
};

const DOC_TYPE_LABELS: Record<string, string> = {
  DTI: 'DTI Certificate',
  SEC: 'SEC Certificate',
  BIR: 'BIR Certificate',
  MAYORS_PERMIT: "Mayor's / Business Permit",
};

function StatusBadge({ status }: { status: string }) {
  const tone =
    status === 'verified' ? styles.badgePrimary : status === 'rejected' ? styles.badgeDanger : styles.badgeNeutral;
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

function DocumentRow({ doc, onError }: { doc: DocumentUploadOut; onError: (message: string) => void }) {
  const [opening, setOpening] = useState(false);
  const passed = doc.validation_status === 'pass';

  async function handleView() {
    setOpening(true);
    try {
      await openAdminDocumentFile(doc.id);
    } catch (e: any) {
      onError(e?.message ?? 'Could not open that file.');
    } finally {
      setOpening(false);
    }
  }

  return (
    <View style={styles.docRow}>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={styles.docType}>{DOC_TYPE_LABELS[doc.doc_type] ?? doc.doc_type}</Text>
        <Text style={styles.metaLineFaint}>Uploaded {formatDate(doc.uploaded_at)}</Text>
        {!passed && !!doc.validation_notes && <Text style={styles.docNotes}>{doc.validation_notes}</Text>}
      </View>
      <View style={styles.docRowRight}>
        <View style={[styles.badge, passed ? styles.badgePrimary : styles.badgeDanger]}>
          <Text style={[styles.badgeText, passed ? styles.badgeLabelPrimary : styles.badgeLabelDanger]}>
            {passed ? 'Passed' : 'Flagged'}
          </Text>
        </View>
        <Pressable onPress={handleView} disabled={opening} hitSlop={6}>
          {opening ? <ActivityIndicator size="small" color={color.primary} /> : <Text style={styles.viewLink}>View file</Text>}
        </Pressable>
      </View>
    </View>
  );
}

export default function AdminBusinessesRoute() {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const isDesktop = width >= breakpoint.desktop;
  const [access, setAccess] = useState<Access>('CHECKING');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [businesses, setBusinesses] = useState<AdminBusinessOut[]>([]);
  const [notesByUser, setNotesByUser] = useState<Record<number, string>>({});
  const [actingOn, setActingOn] = useState<number | null>(null);

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
            <Text style={styles.title}>Businesses</Text>
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
              {businesses.length} business{businesses.length === 1 ? '' : 'es'} registered
            </Text>

            {businesses.length === 0 ? (
              <View style={styles.emptyState}>
                <Text style={styles.emptyText}>No businesses registered yet.</Text>
              </View>
            ) : (
              businesses.map((b) => (
                <View key={b.user_id} style={styles.card}>
                  <View style={styles.cardHeaderRow}>
                    <Text style={styles.businessName}>{b.registered_name || b.business_name}</Text>
                    <StatusBadge status={b.verification_status} />
                  </View>
                  <Text style={styles.metaLine}>
                    {[b.business_type, b.industry_category, [b.city, b.province].filter(Boolean).join(', ')]
                      .filter(Boolean)
                      .join(' · ') || '—'}
                  </Text>
                  <Text style={styles.metaLine}>Login mobile: {b.mobile_number}</Text>
                  <View style={styles.cardFooterRow}>
                    <Text style={styles.metaLineFaint}>Tier {b.tier}</Text>
                    <Text style={styles.metaLineFaint}>Onboarding {b.onboarding_completed ? 'complete' : 'incomplete'}</Text>
                    <Text style={styles.metaLineFaint}>Submitted {formatDate(b.submitted_at)}</Text>
                    <Text style={styles.metaLineFaint}>Joined {formatDate(b.created_at)}</Text>
                  </View>

                  {b.documents.length > 0 && (
                    <View style={styles.docsSection}>
                      <Text style={styles.docsLabel}>Documents ({b.documents.length})</Text>
                      <View style={{ gap: space.sm }}>
                        {b.documents.map((doc) => (
                          <DocumentRow key={doc.id} doc={doc} onError={setError} />
                        ))}
                      </View>
                    </View>
                  )}

                  {(b.verification_status === 'under_review' || b.verification_status === 'submitted') && (
                    <View style={styles.reviewSection}>
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
                  )}
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
  businessName: { fontFamily: font.bodySemi, fontSize: fontSize.md, color: color.ink, flexShrink: 1 },
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
    marginBottom: space.sm,
  },
  docRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space.md,
    paddingBottom: space.sm,
    borderBottomWidth: 1,
    borderBottomColor: color.borderFaint,
  },
  docType: { fontFamily: font.bodyMedium, fontSize: fontSize.sm, color: color.ink },
  docNotes: { marginTop: 2, fontFamily: font.body, fontSize: fontSize.micro, color: color.danger },
  docRowRight: { alignItems: 'flex-end', gap: space.xs },
  viewLink: { fontFamily: font.bodyMedium, fontSize: fontSize.sm, color: color.primary },

  reviewSection: {
    marginTop: space.md,
    paddingTop: space.md,
    borderTopWidth: 1,
    borderTopColor: color.borderFaint,
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
