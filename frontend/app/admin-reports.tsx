// app/admin-reports.tsx
// Business reports (GET /business/admin/reports): "Report this business" from
// a profile lands here for an admin to resolve (action taken) or dismiss (no
// violation). Acting on a business itself — re-verification, deactivation —
// stays on the existing business tools; this records the decision. Same
// shell as the other admin pages.
import { useCallback, useEffect, useState } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet } from 'react-native';
import { color, font, fontSize, lineHeight, letterSpacing, space, radius } from '../components/ui/tokens';
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
  timeAgo,
  formatDate,
  useAdminAccess,
} from '../components/ui/AdminKit';
import { listReports, openWithdrawalProof, reviewReport, type AdminReportOut, type ModerationAction } from '../lib/api/admin';
import { errorMessage } from '../lib/api/client';

type StatusFilter = 'open' | 'resolved' | 'dismissed' | 'all';

const ACTIONS: { value: ModerationAction; label: string; primary?: boolean; danger?: boolean }[] = [
  { value: 'dismiss', label: 'Dismiss — no violation' },
  { value: 'warn', label: 'Warn' },
  { value: 'suspend_7', label: 'Suspend 7 days', danger: true },
  { value: 'suspend_30', label: 'Suspend 30 days', danger: true },
  { value: 'ban', label: 'Ban', danger: true },
];

/** The withdrawals behind an automatic withdrawal-policy report, with the
 *  reasons — administrators only; the buyer never sees these. */
function WithdrawalList({ report }: { report: AdminReportOut }) {
  const [error, setError] = useState<string | null>(null);
  return (
    <View style={styles.withdrawals}>
      <Text style={styles.withdrawalsTitle}>Withdrawals in the last 90 days ({report.withdrawals.length})</Text>
      {report.withdrawals.map((w) => (
        <View key={w.id} style={styles.withdrawalRow}>
          <Text style={styles.subStrong}>
            {w.requirement_ref ?? 'Requirement'} · {formatDate(w.created_at)}
          </Text>
          <Text style={styles.withdrawalReason}>{w.reason_label}</Text>
          {!!w.reason_details && <Text style={styles.details}>“{w.reason_details}”</Text>}
          {w.has_proof && (
            <Pressable
              onPress={() => openWithdrawalProof(w.id).catch((e) => setError(errorMessage(e, 'Could not open the proof.')))}
              accessibilityRole="button"
            >
              <Text style={styles.link}>View proof</Text>
            </Pressable>
          )}
        </View>
      ))}
      {error && <Text style={styles.error}>{error}</Text>}
    </View>
  );
}

function ReviewControls({ report, onDone }: { report: AdminReportOut; onDone: () => void }) {
  // An automatic withdrawal report comes with its action pre-selected and a
  // reason already written — the admin can change either, or dismiss.
  const recommended = report.recommended_action;
  const [notes, setNotes] = useState(
    recommended && report.withdrawals.length > 0
      ? `${report.withdrawals.length} sealed quotations withdrawn within 90 days.`
      : '',
  );
  const [busy, setBusy] = useState<ModerationAction | null>(null);
  const [error, setError] = useState<string | null>(null);

  const decide = async (action: ModerationAction) => {
    if (action !== 'dismiss' && notes.trim().length < 3) {
      setError('Write the reason first — the business is told it.');
      return;
    }
    if (action === 'ban' && typeof window !== 'undefined'
        && !window.confirm(`Ban ${report.reported_name}? Their open requirements are cancelled and sealed quotations withdrawn.`)) {
      return;
    }
    setBusy(action);
    setError(null);
    try {
      await reviewReport(report.id, action, notes);
      onDone();
    } catch (e: any) {
      setError(errorMessage(e, 'Could not save the review.'));
    } finally {
      setBusy(null);
    }
  };

  return (
    <View style={{ gap: space.sm }}>
      <TextInput
        value={notes}
        onChangeText={setNotes}
        maxLength={1000}
        multiline
        placeholder="Reason — shown to the business if you warn, suspend or ban (optional when dismissing)"
        placeholderTextColor={color.inkFaint}
        style={styles.notes}
      />
      {error && <Text style={styles.error}>{error}</Text>}
      <View style={styles.actions}>
        {ACTIONS.map((a) => (
          <Pressable
            key={a.value}
            onPress={() => decide(a.value)}
            disabled={busy !== null}
            style={[
              styles.button,
              a.danger ? styles.buttonDanger : null,
              recommended === a.value ? styles.buttonRecommended : null,
              busy ? { opacity: 0.6 } : null,
            ]}
          >
            <Text style={[styles.buttonLabel, a.danger ? { color: color.danger } : null, recommended === a.value ? { color: color.onPrimary } : null]}>
              {busy === a.value ? 'Saving…' : recommended === a.value ? `${a.label} — recommended` : a.label}
            </Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

export default function AdminReportsRoute() {
  const access = useAdminAccess();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reports, setReports] = useState<AdminReportOut[]>([]);
  const [filter, setFilter] = useState<StatusFilter>('open');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setReports(await listReports());
    } catch (e: any) {
      setError(errorMessage(e, 'Could not load reports.'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (access === 'GRANTED') load();
  }, [access, load]);

  const count = (s: StatusFilter) => (s === 'all' ? reports.length : reports.filter((r) => r.status === s).length);
  const shown = filter === 'all' ? reports : reports.filter((r) => r.status === filter);
  const open = count('open');

  return (
    <AdminShell
      access={access}
      title="Reports"
      subtitle={open > 0 ? `${open} report${open === 1 ? '' : 's'} waiting for review` : 'No reports waiting for review'}
      actions={<GhostButton label="Refresh" onPress={load} busy={loading} />}
    >
      {error && <ErrorBanner message={error} />}

      {loading && reports.length === 0 ? (
        <LoadingBlock />
      ) : (
        <>
          <View style={styles.filters}>
            <FilterChips
              value={filter}
              onChange={setFilter}
              options={[
                { value: 'open', label: 'Open', count: count('open') },
                { value: 'resolved', label: 'Resolved', count: count('resolved') },
                { value: 'dismissed', label: 'Dismissed', count: count('dismissed') },
                { value: 'all', label: 'All', count: count('all') },
              ]}
            />
          </View>

          {shown.length === 0 ? (
            <EmptyState
              title={filter === 'open' ? 'Nothing to review' : 'No reports here'}
              body="Reports appear here when a business uses “Report this business” on a profile."
            />
          ) : (
            shown.map((r) => (
              <AdminCard key={r.id} highlight={r.status === 'open'}>
                <View style={styles.cardTop}>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={styles.reason}>{r.reason_label}</Text>
                    <Text style={styles.title} numberOfLines={1}>{r.reported_name}</Text>
                    <Text style={styles.sub}>
                      Reported by <Text style={styles.subStrong}>{r.reporter_name}</Text> · {timeAgo(r.created_at)}
                    </Text>
                  </View>
                  <View style={{ alignItems: 'flex-end', gap: space.xs }}>
                    <Pill
                      label={r.status === 'open' ? 'Open' : r.status === 'resolved' ? 'Resolved' : 'Dismissed'}
                      tone={r.status === 'open' ? 'danger' : r.status === 'resolved' ? 'primary' : 'neutral'}
                    />
                    {r.reported_open_reports > 1 && (
                      <Pill label={`${r.reported_open_reports} open reports`} tone="danger" />
                    )}
                    {r.reported_banned ? (
                      <Pill label="Banned" tone="danger" />
                    ) : r.reported_suspended_until && new Date(r.reported_suspended_until) > new Date() ? (
                      <Pill label={`Suspended until ${formatDate(r.reported_suspended_until)}`} tone="danger" />
                    ) : null}
                  </View>
                </View>

                <Text style={styles.details}>{r.details}</Text>
                {r.withdrawals.length > 0 && <WithdrawalList report={r} />}

                <InfoGrid
                  items={[
                    { label: 'Account type', value: r.reported_role === 'buyer' ? 'Buyer' : r.reported_role === 'seller' ? 'Seller' : '—' },
                    { label: 'Verification', value: (r.reported_verification_status ?? '—').replace(/_/g, ' ') },
                    { label: 'Requirement', value: r.related_requirement_ref ?? '—' },
                    { label: 'Filed', value: formatDate(r.created_at) },
                  ]}
                />

                {r.reported_history.length > 0 && (
                  <Text style={styles.sub}>
                    History: {r.reported_history.map((h) => `${h.action}${h.until ? ` until ${formatDate(h.until)}` : ''} (${formatDate(h.created_at)})`).join(' · ')}
                  </Text>
                )}

                {r.status === 'open' ? (
                  <ReviewControls report={r} onDone={load} />
                ) : (
                  <Text style={styles.sub}>
                    {r.status === 'resolved' ? 'Resolved' : 'Dismissed'} {r.reviewed_at ? formatDate(r.reviewed_at) : ''}
                    {r.admin_notes ? ` — ${r.admin_notes}` : ''}
                  </Text>
                )}
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
  reason: {
    fontFamily: font.monoMedium,
    fontSize: fontSize.micro,
    lineHeight: lineHeight.micro,
    letterSpacing: letterSpacing.label,
    textTransform: 'uppercase',
    color: color.danger,
    marginBottom: space.xs,
  },
  title: { fontFamily: font.bodySemi, fontSize: fontSize.md, lineHeight: lineHeight.md, color: color.ink },
  sub: { fontFamily: font.body, fontSize: fontSize.sm, color: color.inkMuted, marginTop: space.xs },
  subStrong: { fontFamily: font.bodyMedium, color: color.ink },
  details: { fontFamily: font.body, fontSize: fontSize.sm, lineHeight: lineHeight.sm, color: color.ink, marginVertical: space.sm },
  notes: { minHeight: 64, borderWidth: 1, borderColor: color.border, borderRadius: radius.md, paddingHorizontal: space.md, paddingVertical: space.sm, fontFamily: font.body, fontSize: fontSize.sm, color: color.ink, textAlignVertical: 'top' },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  button: { borderWidth: 1, borderColor: color.border, borderRadius: radius.pill, paddingHorizontal: space.lg, paddingVertical: space.sm },
  buttonPrimary: { backgroundColor: color.primary, borderColor: color.primary },
  buttonDanger: { borderColor: color.dangerBorder },
  buttonRecommended: { backgroundColor: color.danger, borderColor: color.danger },
  withdrawals: { gap: space.sm, marginBottom: space.sm, borderLeftWidth: 2, borderLeftColor: color.warningBorder, paddingLeft: space.md },
  withdrawalsTitle: { fontFamily: font.bodySemi, fontSize: fontSize.sm, color: color.ink },
  withdrawalRow: { gap: 2 },
  withdrawalReason: { fontFamily: font.bodyMedium, fontSize: fontSize.sm, color: color.warning },
  link: { fontFamily: font.bodySemi, fontSize: fontSize.sm, color: color.primary },
  buttonLabel: { fontFamily: font.bodySemi, fontSize: fontSize.sm, color: color.ink },
  error: { fontFamily: font.body, fontSize: fontSize.sm, color: color.danger },
});
