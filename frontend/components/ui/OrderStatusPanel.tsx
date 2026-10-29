// components/ui/OrderStatusPanel.tsx
// Order status of an awarded requirement (backend fulfillment_service):
// Awarded → Completed. The supplier marks it as completed ("delivered" in the
// API), the buyer confirms → Completed (auto-confirms after 14 days). "Did not
// push through" (with a reason) goes to the other party to confirm. Used on My Quotations (supplier), My
// Requirements and Requirement Detail (buyer). Loads its own data by requirement.
// OrderStatusLine is the chat's read-only one-liner. The Delivery date block:
// the buyer sets a date, the supplier confirms or declines it (reason required,
// another date optional), and the buyer can use that date in one tap.
import { useCallback, useEffect, useState, type ChangeEvent } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet, ActivityIndicator } from 'react-native';
import { color, font, fontSize, lineHeight, letterSpacing, space, radius, layout } from './tokens';
import { ReportLink } from './ReportBusinessModal';
import { requirementsApi, type FulfillmentOut, type OrderStatus } from '../../lib/api/requirements';
import { errorMessage } from '../../lib/api/client';

export const ORDER_STATUS_LABEL: Record<OrderStatus, string> = {
  awarded: 'Awarded',
  in_production: 'In production',
  out_for_delivery: 'Out for delivery',
  delivered: 'Marked completed',
  completed: 'Completed',
  not_pushed_through: 'Did not push through',
  unconfirmed: 'Unconfirmed',
  delivery_scheduled: 'Delivery date confirmed',
};

/** "2026-11-06" → "Nov 6, 2026". */
export function formatDeliveryDate(day: string): string {
  return new Date(`${day}T00:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** The agreed delivery date of an awarded order, for the buyer and the awarded
 *  supplier — null for anyone else, or before one is agreed. */
export function useAgreedDeliveryDate(requirementId: string | number, awarded: boolean): string | null {
  const [day, setDay] = useState<string | null>(null);
  useEffect(() => {
    if (!awarded) return;
    let live = true;
    requirementsApi.getFulfillment(Number(requirementId))
      .then((d) => { if (live) setDay(d.delivery?.agreed_date ?? null); })
      .catch(() => {});
    return () => { live = false; };
  }, [requirementId, awarded]);
  return awarded ? day : null;
}

/** Native date input on web (same as Post a Requirement's DateField); native
 *  has no calendar without an extra dependency. */
function DateInput({ value, onChange, label }: { value: string; onChange: (v: string) => void; label: string }) {
  if (typeof document === 'undefined') {
    return <Text style={styles.muted}>Pick a date on the web version.</Text>;
  }
  return (
    <input
      type="date"
      aria-label={label}
      value={value}
      min={todayIso()}
      onChange={(e: ChangeEvent<HTMLInputElement>) => onChange(e.target.value)}
      style={{
        alignSelf: 'flex-start',
        minWidth: 170,
        fontFamily: font.monoMedium,
        fontSize: fontSize.sm,
        color: color.ink,
        background: color.canvas,
        border: `1px solid ${color.border}`,
        borderRadius: radius.md,
        minHeight: layout.minTouchTarget,
        boxSizing: 'border-box',
        paddingLeft: space.md,
        paddingRight: space.md,
        outline: 'none',
      }}
    />
  );
}

/** The transaction is over — the award chat becomes a read-only record. */
export function isChatClosed(status: OrderStatus | null | undefined): boolean {
  return status === 'completed' || status === 'not_pushed_through';
}

const TRACK: OrderStatus[] = ['awarded', 'completed'];

/** Position on the Awarded → Completed tracker; -1 when the order ended otherwise. */
function trackIndex(status: OrderStatus): number {
  if (status === 'completed') return 1;
  return status === 'not_pushed_through' || status === 'unconfirmed' ? -1 : 0;
}

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
  const delivery = fulfillment.delivery;
  return (
    <View style={[styles.line, done ? styles.lineDone : null]}>
      <Text style={[styles.lineLabel, done ? { color: color.primary } : null]}>
        Status: {ORDER_STATUS_LABEL[fulfillment.status]}
      </Text>
      {delivery?.agreed_date ? (
        <Text style={styles.muted}> · Delivery {formatDeliveryDate(delivery.agreed_date)}</Text>
      ) : delivery?.pending ? (
        <Text style={styles.muted}> · Delivery date waiting for the supplier</Text>
      ) : null}
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
  onStatus,
}: {
  requirementId: string | number;
  /** The other party — for "Report a problem". */
  counterpartyId?: string | number;
  counterpartyName?: string;
  /** After any successful action, e.g. to refresh a list. */
  onChanged?: () => void;
  /** Called with the order status every time it loads. */
  onStatus?: (status: OrderStatus) => void;
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
    requirementsApi.getFulfillment(rid).then((d) => { setData(d); setLoadFailed(false); onStatus?.(d.status); }).catch(() => setLoadFailed(true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rid]);
  useEffect(load, [load]);

  if (loadFailed) return null;
  if (!data) return <ActivityIndicator color={color.primary} style={{ alignSelf: 'flex-start' }} />;

  const role = data.viewer_role;
  const closeout = data.closeout;
  const pending = closeout?.pending ?? null;
  const final = ['completed', 'not_pushed_through', 'unconfirmed'].includes(data.status);
  const reached = trackIndex(data.status);
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
  if (data.status === 'completed') headline = data.auto_confirmed ? '✓ Completed (auto-confirmed after 14 days)' : '✓ Completed — confirmed by the buyer';
  else if (data.status === 'not_pushed_through') headline = 'Did not push through — confirmed by both parties';
  else if (data.status === 'unconfirmed') headline = 'Unconfirmed — no updates were posted, so this counts as neither completed nor failed';
  else if (pending) headline = closeout?.awaiting_viewer
    ? `The ${pending.proposed_by_role} says this did not push through. Do you agree?`
    : `You said this did not push through — waiting for the ${role === 'buyer' ? 'supplier' : 'buyer'} to confirm.`;
  else if (data.next_action === 'seller_update') headline = role === 'supplier'
    ? 'Awarded. Mark it as completed once the order is done.'
    : 'Awarded — the supplier marks it as completed once the order is done.';
  else headline = role === 'buyer'
    ? `The supplier marked this as completed. Confirm if it's done${data.auto_confirm_at ? ` — it auto-confirms on ${formatDate(data.auto_confirm_at)}` : ''}.`
    : `Waiting for the buyer to confirm${data.auto_confirm_at ? ` (auto-confirms on ${formatDate(data.auto_confirm_at)})` : ''}.`;

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
            placeholder={noteRequired ? 'Reason (required)' : 'Note (optional)'}
            placeholderTextColor={color.inkFaint}
            maxLength={500}
            style={styles.input}
          />
          <View style={styles.actions}>
            <Pressable onPress={submit} disabled={!canSubmit} style={[styles.primary, !canSubmit ? { opacity: 0.4 } : null]}>
              <Text style={styles.primaryLabel}>
                {busy ? 'Saving…' : mode === 'update' ? 'Mark as completed'
                  : mode === 'confirm' ? 'Confirm completed' : 'Submit'}
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
              <Text style={styles.primaryLabel}>Mark as completed</Text>
            </Pressable>
          )}
          {myTurn && data.next_action === 'buyer_confirm' && (
            <Pressable onPress={() => setMode('confirm')} style={styles.primary}>
              <Text style={styles.primaryLabel}>Confirm completed</Text>
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

      {data.delivery && (
        <DeliveryBlock delivery={data.delivery} orderOpen={!final && !pending} requirementId={rid} onChanged={() => { load(); onChanged?.(); }} />
      )}

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

function DeliveryBlock({
  delivery,
  orderOpen,
  requirementId,
  onChanged,
}: {
  delivery: NonNullable<FulfillmentOut['delivery']>;
  /** False once the order is closed (or a "did not push through" is pending) — read-only then. */
  orderOpen: boolean;
  requirementId: number;
  onChanged: () => void;
}) {
  const [mode, setMode] = useState<'set' | 'decline' | null>(null);
  const [day, setDay] = useState('');
  const [note, setNote] = useState('');
  const [suggested, setSuggested] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const role = delivery.viewer_role;
  const pending = delivery.pending;
  const declined = delivery.last_declined;
  const canAct = orderOpen && role !== 'admin';

  const reset = () => { setMode(null); setDay(''); setNote(''); setSuggested(''); setError(null); };
  const run = async (call: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await call();
      reset();
      onChanged();
    } catch (e: any) {
      setError(errorMessage(e, 'Something went wrong. Try again.'));
    } finally {
      setBusy(false);
    }
  };

  let line: string;
  if (pending) {
    line = role === 'supplier'
      ? `The buyer set ${formatDeliveryDate(pending.delivery_date)}. Can you deliver on that date?`
      : `${formatDeliveryDate(pending.delivery_date)} — waiting for the supplier to confirm.`;
  } else if (delivery.agreed_date) {
    line = `Agreed: ${formatDeliveryDate(delivery.agreed_date)}`;
  } else if (declined) {
    line = `The supplier can't deliver on ${formatDeliveryDate(declined.delivery_date)}.`;
  } else {
    line = role === 'buyer' ? 'Not set yet. Set the date you need this delivered.' : 'Not set yet — the buyer sets it.';
  }
  const highlighted = (pending && role === 'supplier') || (!pending && (!!delivery.agreed_date || role === 'buyer'));

  return (
    <View style={styles.delivery}>
      <Text style={styles.sectionLabel}>Delivery date</Text>
      <Text style={[styles.headline, highlighted && canAct ? styles.headlineAction : null]}>{line}</Text>
      {pending?.note && <Text style={styles.muted}>Note: {pending.note}</Text>}
      {!pending && declined && (
        <Text style={styles.muted}>
          Reason: {declined.decline_reason}
          {declined.suggested_date ? `\nSuggested date: ${formatDeliveryDate(declined.suggested_date)}` : ''}
        </Text>
      )}

      {canAct && mode === 'set' && (
        <View style={{ gap: space.sm }}>
          <DateInput value={day} onChange={setDay} label="Delivery date" />
          <TextInput value={note} onChangeText={setNote} placeholder="Note for the supplier (optional)"
            placeholderTextColor={color.inkFaint} maxLength={500} style={styles.input} />
          <View style={styles.actions}>
            <Pressable onPress={() => run(() => requirementsApi.proposeDelivery(requirementId, day, note))}
              disabled={busy || !day} style={[styles.primary, busy || !day ? { opacity: 0.4 } : null]}>
              <Text style={styles.primaryLabel}>{busy ? 'Saving…' : 'Send to supplier'}</Text>
            </Pressable>
            <Pressable onPress={reset} hitSlop={6}><Text style={styles.link}>Cancel</Text></Pressable>
          </View>
        </View>
      )}

      {canAct && mode === 'decline' && (
        <View style={{ gap: space.sm }}>
          <TextInput value={note} onChangeText={setNote} placeholder="Why can't you deliver then? (required)"
            placeholderTextColor={color.inkFaint} maxLength={500} style={styles.input} />
          <Text style={styles.muted}>Suggest another date (optional)</Text>
          <DateInput value={suggested} onChange={setSuggested} label="Suggested delivery date" />
          <View style={styles.actions}>
            <Pressable onPress={() => run(() => requirementsApi.respondDelivery(requirementId, false, note, suggested))}
              disabled={busy || note.trim().length < 5}
              style={[styles.primary, busy || note.trim().length < 5 ? { opacity: 0.4 } : null]}>
              <Text style={styles.primaryLabel}>{busy ? 'Saving…' : 'Decline date'}</Text>
            </Pressable>
            <Pressable onPress={reset} hitSlop={6}><Text style={styles.link}>Cancel</Text></Pressable>
          </View>
        </View>
      )}

      {canAct && !mode && (
        <View style={styles.actions}>
          {pending && role === 'supplier' && (
            <>
              <Pressable onPress={() => run(() => requirementsApi.respondDelivery(requirementId, true))} disabled={busy} style={styles.primary}>
                <Text style={styles.primaryLabel}>{busy ? 'Saving…' : 'Confirm date'}</Text>
              </Pressable>
              <Pressable onPress={() => setMode('decline')} hitSlop={6}>
                <Text style={styles.link}>Can't make it</Text>
              </Pressable>
            </>
          )}
          {pending && role === 'buyer' && (
            <Pressable onPress={() => run(() => requirementsApi.withdrawDelivery(requirementId))} disabled={busy} hitSlop={6}>
              <Text style={styles.link}>Withdraw</Text>
            </Pressable>
          )}
          {!pending && role === 'buyer' && declined?.suggested_date && !delivery.agreed_date && (
            <Pressable onPress={() => run(() => requirementsApi.proposeDelivery(requirementId, declined.suggested_date!))}
              disabled={busy} style={styles.primary}>
              <Text style={styles.primaryLabel}>{busy ? 'Saving…' : `Use ${formatDeliveryDate(declined.suggested_date)}`}</Text>
            </Pressable>
          )}
          {!pending && role === 'buyer' && (
            <Pressable onPress={() => setMode('set')} hitSlop={6}
              style={!delivery.agreed_date && !declined?.suggested_date ? styles.primary : null}>
              <Text style={!delivery.agreed_date && !declined?.suggested_date ? styles.primaryLabel : styles.link}>
                {delivery.agreed_date ? 'Change date' : declined ? 'Pick another date' : 'Set delivery date'}
              </Text>
            </Pressable>
          )}
        </View>
      )}
      {error && <Text style={styles.error}>{error}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  delivery: { gap: space.sm, borderTopWidth: 1, borderTopColor: color.border, paddingTop: space.sm },
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
