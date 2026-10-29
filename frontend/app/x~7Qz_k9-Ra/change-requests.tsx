// app/x~7Qz_k9-Ra/change-requests.tsx
// Change requests (GET /business/admin/change-requests): a business asking to
// change a locked detail — registered name, business type, category, location
// or contact (change_request_service). Old → new for each field and the
// reason; Approve applies it, Reject needs a note the business sees. Same
// shell as the other admin pages.
import { useCallback, useEffect, useState } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet } from 'react-native';
import { color, font, fontSize, lineHeight, letterSpacing, space, radius } from '../../components/ui/tokens';
import {
  AdminShell,
  AdminCard,
  EmptyState,
  ErrorBanner,
  FilterChips,
  GhostButton,
  LoadingBlock,
  Pill,
  timeAgo,
  formatDate,
  useAdminAccess,
} from '../../components/ui/AdminKit';
import { listChangeRequestsForAdmin, lockedFieldLabel, reviewChangeRequest, type AdminChangeRequestOut } from '../../lib/api/business';
import { errorMessage } from '../../lib/api/client';
import { BusinessNameLink } from '../../components/ui/BusinessLink';

type StatusFilter = 'pending' | 'approved' | 'rejected' | 'all';

function ReviewControls({ request, onDone }: { request: AdminChangeRequestOut; onDone: () => void }) {
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState<'approve' | 'reject' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const decide = async (approve: boolean) => {
    if (!approve && notes.trim().length < 5) {
      setError('Write why it is rejected first — the business is told.');
      return;
    }
    setBusy(approve ? 'approve' : 'reject');
    setError(null);
    try {
      await reviewChangeRequest(request.id, approve, notes);
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
        maxLength={500}
        multiline
        placeholder="Note to the business — required when rejecting (e.g. upload the new DTI certificate first)"
        placeholderTextColor={color.inkFaint}
        style={styles.notes}
      />
      {error && <Text style={styles.error}>{error}</Text>}
      <View style={styles.actions}>
        <Pressable onPress={() => decide(true)} disabled={busy !== null} style={[styles.button, styles.buttonPrimary, busy ? { opacity: 0.6 } : null]}>
          <Text style={[styles.buttonLabel, { color: color.onPrimary }]}>{busy === 'approve' ? 'Saving…' : 'Approve and apply'}</Text>
        </Pressable>
        <Pressable onPress={() => decide(false)} disabled={busy !== null} style={[styles.button, styles.buttonDanger, busy ? { opacity: 0.6 } : null]}>
          <Text style={[styles.buttonLabel, { color: color.danger }]}>{busy === 'reject' ? 'Saving…' : 'Reject'}</Text>
        </Pressable>
      </View>
    </View>
  );
}

export default function AdminChangeRequestsRoute() {
  const access = useAdminAccess();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [requests, setRequests] = useState<AdminChangeRequestOut[]>([]);
  const [filter, setFilter] = useState<StatusFilter>('pending');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setRequests(await listChangeRequestsForAdmin());
    } catch (e: any) {
      setError(errorMessage(e, 'Could not load change requests.'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (access === 'GRANTED') load();
  }, [access, load]);

  const count = (s: StatusFilter) => (s === 'all' ? requests.length : requests.filter((r) => r.status === s).length);
  const shown = filter === 'all' ? requests : requests.filter((r) => r.status === filter);
  const pending = count('pending');

  return (
    <AdminShell
      access={access}
      title="Change requests"
      subtitle={pending > 0 ? `${pending} request${pending === 1 ? '' : 's'} waiting — answer within 1–3 business days` : 'No change requests waiting'}
      actions={<GhostButton label="Refresh" onPress={load} busy={loading} />}
    >
      {error && <ErrorBanner message={error} />}

      {loading && requests.length === 0 ? (
        <LoadingBlock />
      ) : (
        <>
          <View style={styles.filters}>
            <FilterChips
              value={filter}
              onChange={setFilter}
              options={[
                { value: 'pending', label: 'Pending', count: count('pending') },
                { value: 'approved', label: 'Approved', count: count('approved') },
                { value: 'rejected', label: 'Rejected', count: count('rejected') },
                { value: 'all', label: 'All', count: count('all') },
              ]}
            />
          </View>

          {shown.length === 0 ? (
            <EmptyState
              title={filter === 'pending' ? 'Nothing to review' : 'No requests here'}
              body="A business's name, type, category, location and contact are locked after onboarding. Requests to change them appear here."
            />
          ) : (
            shown.map((r) => (
              <AdminCard key={r.id} highlight={r.status === 'pending'}>
                <View style={styles.cardTop}>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={styles.kicker}>Locked details</Text>
                    <BusinessNameLink businessId={r.user_id} name={r.business_name} style={styles.title} numberOfLines={1} />
                    <Text style={styles.sub}>{r.verification_status.replace(/_/g, ' ')} · requested {timeAgo(r.created_at)}</Text>
                  </View>
                  <Pill
                    label={r.status === 'pending' ? 'Pending' : r.status === 'approved' ? 'Approved' : 'Rejected'}
                    tone={r.status === 'pending' ? 'danger' : r.status === 'approved' ? 'primary' : 'neutral'}
                  />
                </View>

                <View style={styles.diff}>
                  {Object.entries(r.changes).map(([field, ch]) => (
                    <View key={field} style={styles.diffRow}>
                      <Text style={styles.diffLabel}>{lockedFieldLabel(field)}</Text>
                      <Text style={styles.diffOld}>{ch.from || '—'}</Text>
                      <Text style={styles.diffArrow}>→</Text>
                      <Text style={styles.diffNew}>{ch.to || '(blank)'}</Text>
                    </View>
                  ))}
                </View>

                <Text style={styles.reasonText}>“{r.reason}”</Text>

                {r.status === 'pending' ? (
                  <ReviewControls request={r} onDone={load} />
                ) : (
                  <Text style={styles.sub}>
                    {r.status === 'approved' ? 'Approved' : 'Rejected'} {r.reviewed_at ? formatDate(r.reviewed_at) : ''}
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
  kicker: {
    fontFamily: font.monoMedium,
    fontSize: fontSize.micro,
    lineHeight: lineHeight.micro,
    letterSpacing: letterSpacing.label,
    textTransform: 'uppercase',
    color: color.warning,
    marginBottom: space.xs,
  },
  title: { fontFamily: font.bodySemi, fontSize: fontSize.md, lineHeight: lineHeight.md, color: color.ink },
  sub: { fontFamily: font.body, fontSize: fontSize.sm, color: color.inkMuted, marginTop: space.xs },
  diff: { gap: space.xs, marginTop: space.md, borderWidth: 1, borderColor: color.borderFaint, borderRadius: radius.md, padding: space.md, backgroundColor: color.surfaceSunken },
  diffRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'baseline', gap: space.sm },
  diffLabel: { minWidth: 170, fontFamily: font.bodyMedium, fontSize: fontSize.sm, color: color.inkMuted },
  diffOld: { fontFamily: font.body, fontSize: fontSize.sm, color: color.inkMuted, textDecorationLine: 'line-through' },
  diffArrow: { fontFamily: font.body, fontSize: fontSize.sm, color: color.inkFaint },
  diffNew: { fontFamily: font.bodySemi, fontSize: fontSize.sm, color: color.ink },
  reasonText: { fontFamily: font.body, fontSize: fontSize.sm, lineHeight: lineHeight.sm, color: color.ink, marginVertical: space.sm },
  notes: { minHeight: 64, borderWidth: 1, borderColor: color.border, borderRadius: radius.md, paddingHorizontal: space.md, paddingVertical: space.sm, fontFamily: font.body, fontSize: fontSize.sm, color: color.ink, textAlignVertical: 'top' },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  button: { borderWidth: 1, borderColor: color.border, borderRadius: radius.pill, paddingHorizontal: space.lg, paddingVertical: space.sm },
  buttonPrimary: { backgroundColor: color.primary, borderColor: color.primary },
  buttonDanger: { borderColor: color.dangerBorder },
  buttonLabel: { fontFamily: font.bodySemi, fontSize: fontSize.sm, color: color.ink },
  error: { fontFamily: font.body, fontSize: fontSize.sm, color: color.danger },
});
