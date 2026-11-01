// components/ui/WithdrawConfirm.tsx
// "Withdraw this quotation?" — shown before every supplier withdrawal, with
// what this one would do to the account (backend withdrawal_policy):
// 1st = warning, 2nd = 7-day suspension, 3rd = ban pending an admin
// investigation. Used by My Quotations, the sealed receipt and Requirement Detail.
import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { View, Text, Pressable, Modal, ActivityIndicator, StyleSheet } from 'react-native';
import { color, font, fontSize, lineHeight, space, radius, layout } from './tokens';
import { requirementsApi, type WithdrawalPreviewOut } from '../../lib/api/requirements';

function ordinal(n: number): string {
  return n === 1 ? '1st' : n === 2 ? '2nd' : n === 3 ? '3rd' : `${n}th`;
}

function WithdrawConfirmModal({ onConfirm, onClose }: { onConfirm: () => Promise<void>; onClose: () => void }) {
  const [preview, setPreview] = useState<WithdrawalPreviewOut | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    requirementsApi.withdrawalPreview().then(setPreview).catch(() => setPreview(null));
  }, []);

  const severe = preview && preview.next !== 'warning';
  const tone = severe ? { bg: color.dangerFaint, border: color.dangerBorder, ink: color.danger } : { bg: color.warningFaint, border: color.warningBorder, ink: color.warning };

  const confirm = async () => {
    setBusy(true);
    try {
      await onConfirm();
    } finally {
      setBusy(false);
      onClose();
    }
  };

  return (
    <Modal transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.card}>
          <Text style={styles.title}>Withdraw this quotation?</Text>
          {!preview ? (
            <ActivityIndicator color={color.primary} style={{ alignSelf: 'flex-start' }} />
          ) : (
            <View style={[styles.consequence, { backgroundColor: tone.bg, borderColor: tone.border }]}>
              <Text style={[styles.consequenceTitle, { color: tone.ink }]}>
                This would be your {ordinal(preview.next_number)} withdrawal
              </Text>
              <Text style={styles.body}>{preview.message}</Text>
            </View>
          )}
          <Text style={styles.muted}>
            Withdrawing a sealed quotation counts against your account: 1st — warning · 2nd — 7-day suspension · 3rd — ban
            pending an administrator's investigation. It also shows on your profile's Track record.
          </Text>
          <View style={styles.actions}>
            <Pressable onPress={onClose} disabled={busy} style={[styles.button, { borderColor: color.border }]}>
              <Text style={styles.buttonLabel}>Keep my quotation</Text>
            </Pressable>
            <Pressable onPress={confirm} disabled={busy || !preview} style={[styles.button, styles.danger, busy || !preview ? { opacity: 0.5 } : null]}>
              <Text style={[styles.buttonLabel, { color: color.onPrimary }]}>{busy ? 'Withdrawing…' : 'Withdraw anyway'}</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

/** confirm(action) opens the dialog; the action runs only on "Withdraw anyway". Render `modal`. */
export function useWithdrawConfirm(): { confirm: (action: () => Promise<void>) => void; modal: ReactNode } {
  const [action, setAction] = useState<(() => Promise<void>) | null>(null);
  return {
    confirm: (a) => setAction(() => a),
    modal: action ? <WithdrawConfirmModal onConfirm={action} onClose={() => setAction(null)} /> : null,
  };
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(15,15,14,0.45)', alignItems: 'center', justifyContent: 'center', padding: space.lg },
  card: { width: '100%', maxWidth: 460, backgroundColor: color.surface, borderRadius: radius.xl, padding: space.xl, gap: space.md },
  title: { fontFamily: font.bodySemi, fontSize: fontSize.lg, color: color.ink },
  consequence: { borderWidth: 1, borderRadius: radius.lg, padding: space.md, gap: space.xs },
  consequenceTitle: { fontFamily: font.bodySemi, fontSize: fontSize.base },
  body: { fontFamily: font.body, fontSize: fontSize.sm, lineHeight: lineHeight.sm, color: color.ink },
  muted: { fontFamily: font.body, fontSize: fontSize.sm, lineHeight: lineHeight.sm, color: color.inkMuted },
  actions: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-end', gap: space.sm },
  button: { minHeight: layout.minTouchTarget, borderRadius: radius.pill, borderWidth: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: space.lg },
  danger: { backgroundColor: color.danger, borderColor: color.danger },
  buttonLabel: { fontFamily: font.bodySemi, fontSize: fontSize.sm, color: color.ink },
});
