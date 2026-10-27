// components/ui/OrderStatusPanel.tsx
// Order status of an awarded requirement (backend fulfillment_service), LinkedIn
// style: the supplier posts In production → Out for delivery → Delivered, the
// buyer confirms receipt → Completed. "Did not push through" (with a reason)
// goes to the other party to confirm. Used on My Quotations (supplier), My
// Requirements and Requirement Detail (buyer). Loads its own data by requirement.
// OrderStatusLine is the chat's read-only one-liner.
import { useCallback, useEffect, useState } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet, ActivityIndicator } from 'react-native';
import { color, font, fontSize, lineHeight, letterSpacing, space, radius } from './tokens';
import { ReportLink } from './ReportBusinessModal';
import { requirementsApi, type FulfillmentOut, type OrderStatus } from '../../lib/api/requirements';
import { errorMessage } from '../../lib/api/client';

export const ORDER_STATUS_LABEL: Record<OrderStatus, string> = {
  awarded: 'Awarded',
  in_production: 'In production',
  out_for_delivery: 'Out for delivery',
  delivered: 'Delivered',
  completed: 'Completed',
  not_pushed_through: 'Did not push through',
  unconfirmed: 'Unconfirmed',
};

const TRACK: OrderStatus[] = ['awarded', 'in_production', 'out_for_delivery', 'delivered', 'completed'];

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function whoLabel(role: 'buyer' | 'supplier' | 'system'): string {
  return role === 'system' ? 'TrustLink' : role === 'buyer' ? 'Buyer' : 'Supplier';
}

/** Read-only status for the award chat — updates happen on the lists, not here. */
export function OrderStatusLine({ fulfillment }: { fulfillment: FulfillmentOut | null | undefined }) {
  if (!fulfillment) return null;
  const role = fulfillment.viewer_role;
  const where = role === 'supplier' ? 'My Quotations' : role === 'buyer' ? 'My Requirements' : null;
  const done = fulfillment.status === 'completed';
  return (
    <View style={[styles.line, done ? styles.lineDone : null]}>
      <Text style={[styles.lineLabel, done ? { color: color.primary } : null]}>
        Status: {ORDER_STATUS_LABEL[fulfillment.status]}
      </Text>
      {where && fulfillment.next_action && fulfillment.next_action_by === role && (
        <Text style={styles.muted}> · Update in {where}</Text>
      )}
    </View>
  );
}

export function OrderStatusPanel({
  requirementId,
  counterpartyId,
  counterpartyName,
  onChanged,
}: {
  requirementId: string | number;
  /** The other party — for "Report a problem". */
  counterpartyId?: string | number;
  counterpartyName?: string;
  /** After any successful action, e.g. to refresh a list. */
  onChanged?: () => void;
}) {
  const [data, setData] = useState<FulfillmentOut | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [mode, setMode] = useState<'update' | 'confirm' | 'not_pushed' | 'reject' | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const rid = Number(requirementId);

  const load = useCallback(() => {
    requirementsApi.getFulfillment(rid).then((d) => { setData(d); setLoadFailed(false); }).catch(() => setLoadFailed(true));
  }, [rid]);
  useEffect(load, [load]);

  if (loadFailed) return null;
  if (!data) return <ActivityIndicator color={color.primary} style={{ alignSelf: 'flex-start' }} />;

  const role = data.viewer_role;
  const closeout = data.closeout;
  const pending = closeout?.pending ?? null;
  const final = ['completed', 'not_pushed_through', 'unconfirmed'].includes(data.status);
  const reached = TRACK.indexOf(data.status);
  const noteRequired = mode === 'not_pushed' || mode === 'reject';
  const canSubmit = !busy && (!noteRequired || note.trim().length >= 5);

  const run = async (call: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await call();
      setMode(null);
      setNote('');
      load();
      onChanged?.();
    } catch (e: any) {
      setError(errorMessage(e, 'Something went wrong. Try again.'));
    } finally {
      setBusy(false);
    }
  };
  const submit = () => {
    if (!canSubmit || !mode) return;
    if (mode === 'update' && data.next_status) run(() => requirementsApi.updateFulfillment(rid, data.next_status!, note));
    else if (mode === 'confirm') run(() => requirementsApi.confirmReceived(rid, note));
    else if (mode === 'not_pushed') run(() => requirementsApi.proposeCloseout(rid, 'not_pushed_through', note));
    else if (mode === 'reject') run(() => requirementsApi.respondCloseout(rid, false, note));
  };

  // One sentence: where the order is, and whose turn it is.
  let headline: string;
  if (data.status === 'completed') headline = data.auto_confirmed ? '✓ Completed (auto-confirmed after delivery)' : '✓ Completed — the buyer confirmed receipt';
  else if (data.status === 'not_pushed_through') headline = 'Did not push through — confirmed by both parties';
  else if (data.status === 'unconfirmed') headline = 'Unconfirmed — no updates were posted, so this counts as neither completed nor failed';
  else if (pending) headline = closeout?.awaiting_viewer
    ? `The ${pending.proposed_by_role} says this did not push through. Do you agree?`
    : `You said this did not push through — waiting for the ${role === 'buyer' ? 'supplier' : 'buyer'} to confirm.`;
  else if (data.next_action === 'seller_update') headline = role === 'supplier'
    ? `${ORDER_STATUS_LABEL[data.status]}. Post the next update when it happens.`
    : `${ORDER_STATUS_LABEL[data.status]} — waiting for the supplier's next update.`;
  else headline = role === 'buyer'
    ? `Delivered. Confirm once you received it${data.auto_confirm_at ? ` — it auto-confirms on ${formatDate(data.auto_confirm_at)}` : ''}.`
    : `Delivered — waiting for the buyer to confirm receipt${data.auto_confirm_at ? ` (auto-confirms on ${formatDate(data.auto_confirm_at)})` : ''}.`;

  const myTurn = !final && !pending && data.next_action_by === role;

  return (
    <View style={styles.panel}>
      <Text style={styles.sectionLabel}>Order status</Text>
      {reached >= 0 && (
        <View style={styles.tracker} accessibilityLabel={`Order status: ${ORDER_STATUS_LABEL[data.status]}`}>
          {TRACK.map((s, i) => (
            <View key={s} style={styles.trackerStep}>
              <View style={[styles.trackerBar, i <= reached ? styles.trackerBarDone : null]} />
              <Text style={[styles.trackerLabel, i === reached ? styles.trackerLabelCurrent : i < reached ? styles.trackerLabelDone : null]} numberOfLines={1}>
                {ORDER_STATUS_LABEL[s]}
              </Text>
            </View>
          ))}
        </View>
      )}
      <Text style={[styles.headline, myTurn || closeout?.awaiting_viewer ? styles.headlineAction : null]}>{headline}</Text>

      {mode ? (
        <View style={{ gap: space.sm }}>
          <TextInput
            value={note}
            onChangeText={setNote}
            placeholder={noteRequired ? 'Reason (required)' : 'Note (optional), e.g. "Truck left at 9 AM"'}
            placeholderTextColor={color.inkFaint}
            maxLength={500}
            style={styles.input}
          />
          <View style={styles.actions}>
            <Pressable onPress={submit} disabled={!canSubmit} style={[styles.primary, !canSubmit ? { opacity: 0.4 } : null]}>
              <Text style={styles.primaryLabel}>
                {busy ? 'Saving…' : mode === 'update' && data.next_status ? `Mark ${ORDER_STATUS_LABEL[data.next_status].toLowerCase()}`
                  : mode === 'confirm' ? 'Confirm received' : 'Submit'}
              </Text>
            </Pressable>
            <Pressable onPress={() => { setMode(null); setNote(''); setError(null); }} hitSlop={6}>
              <Text style={styles.link}>Cancel</Text>
            </Pressable>
          </View>
          {mode === 'not_pushed' && <Text style={styles.muted}>The other party will be asked to confirm.</Text>}
        </View>
      ) : (
        <View style={styles.actions}>
          {myTurn && data.next_action === 'seller_update' && data.next_status && (
            <Pressable onPress={() => setMode('update')} style={styles.primary}>
              <Text style={styles.primaryLabel}>Mark {ORDER_STATUS_LABEL[data.next_status].toLowerCase()}</Text>
            </Pressable>
          )}
          {myTurn && data.next_action === 'buyer_confirm' && (
            <Pressable onPress={() => setMode('confirm')} style={styles.primary}>
              <Text style={styles.primaryLabel}>Confirm received</Text>
            </Pressable>
          )}
          {pending && closeout?.awaiting_viewer && (
            <>
              <Pressable onPress={() => run(() => requirementsApi.respondCloseout(rid, true, ''))} disabled={busy} style={styles.primary}>
                <Text style={styles.primaryLabel}>{busy ? 'Saving…' : 'Confirm'}</Text>
              </Pressable>
              <Pressable onPress={() => setMode('reject')} hitSlop={6}>
                <Text style={styles.link}>Not yet</Text>
              </Pressable>
            </>
          )}
          {pending && !closeout?.awaiting_viewer && role !== 'admin' && (
            <Pressable onPress={() => run(() => requirementsApi.withdrawCloseout(rid))} disabled={busy} hitSlop={6}>
              <Text style={styles.link}>Withdraw</Text>
            </Pressable>
          )}
          {!final && !pending && role !== 'admin' && (
            <Pressable onPress={() => setMode('not_pushed')} hitSlop={6}>
              <Text style={styles.dangerLink}>Did not push through</Text>
            </Pressable>
          )}
          {!final && counterpartyId != null && counterpartyName && (
            <ReportLink businessId={counterpartyId} businessName={counterpartyName} label="Report a problem" />
          )}
        </View>
      )}
      {error && <Text style={styles.error}>{error}</Text>}

      {data.timeline.length > 0 && (
        <View style={{ gap: space.xs }}>
          <Pressable onPress={() => setShowHistory((v) => !v)} hitSlop={6} style={{ alignSelf: 'flex-start' }}>
            <Text style={styles.link}>{showHistory ? 'Hide updates' : `Updates (${data.timeline.length})`}</Text>
          </Pressable>
          {showHistory && data.timeline.slice().reverse().map((u, i) => (
            <View key={`${u.created_at}-${i}`} style={styles.historyRow}>
              <View style={styles.historyDot} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={styles.historyTitle}>{ORDER_STATUS_LABEL[u.status]} · {whoLabel(u.actor_role)}</Text>
                {u.note && <Text style={styles.muted}>{u.note}</Text>}
                <Text style={styles.historyTime}>{formatDate(u.created_at)}</Text>
              </View>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  panel: { gap: space.sm, borderWidth: 1, borderColor: color.border, borderRadius: radius.lg, padding: space.md, backgroundColor: color.surface },
  sectionLabel: { fontFamily: font.mono, fontSize: fontSize.micro, letterSpacing: letterSpacing.label, textTransform: 'uppercase', color: color.inkFaint },
  tracker: { flexDirection: 'row', gap: space.xs },
  trackerStep: { flex: 1, minWidth: 0, gap: space.xs },
  trackerBar: { height: 4, borderRadius: radius.pill, backgroundColor: color.borderFaint },
  trackerBarDone: { backgroundColor: color.primary },
  trackerLabel: { fontFamily: font.body, fontSize: 10, color: color.inkFaint },
  trackerLabelDone: { color: color.inkMuted },
  trackerLabelCurrent: { fontFamily: font.bodySemi, color: color.primary },
  headline: { fontFamily: font.body, fontSize: fontSize.sm, lineHeight: lineHeight.sm, color: color.inkMuted },
  headlineAction: { fontFamily: font.bodySemi, color: color.ink },
  muted: { fontFamily: font.body, fontSize: fontSize.sm, lineHeight: lineHeight.sm, color: color.inkMuted },
  actions: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space.md },
  primary: { backgroundColor: color.primary, borderRadius: radius.md, paddingHorizontal: space.md, paddingVertical: space.sm },
  primaryLabel: { fontFamily: font.bodySemi, fontSize: fontSize.sm, color: color.onPrimary },
  link: { fontFamily: font.bodyMedium, fontSize: fontSize.sm, color: color.primary },
  dangerLink: { fontFamily: font.bodyMedium, fontSize: fontSize.sm, color: color.danger },
  input: { borderWidth: 1, borderColor: color.border, borderRadius: radius.md, paddingHorizontal: space.md, paddingVertical: space.sm, fontFamily: font.body, fontSize: fontSize.sm, color: color.ink, backgroundColor: color.canvas },
  error: { fontFamily: font.body, fontSize: fontSize.sm, color: color.danger },
  historyRow: { flexDirection: 'row', gap: space.sm, paddingVertical: space.xs },
  historyDot: { width: 8, height: 8, borderRadius: radius.pill, backgroundColor: color.primaryBorder, marginTop: 5 },
  historyTitle: { fontFamily: font.bodySemi, fontSize: fontSize.sm, color: color.ink },
  historyTime: { fontFamily: font.mono, fontSize: 10, color: color.inkFaint },
  line: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', paddingHorizontal: space.lg, paddingVertical: space.sm, borderBottomWidth: 1, borderBottomColor: color.border, backgroundColor: color.surfaceSunken },
  lineDone: { backgroundColor: color.primaryFaint },
  lineLabel: { fontFamily: font.bodySemi, fontSize: fontSize.sm, color: color.ink },
});
