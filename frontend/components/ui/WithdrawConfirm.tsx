// components/ui/WithdrawConfirm.tsx
// "Withdraw this quotation?" — shown before every supplier withdrawal. Every
// withdrawal counts (backend withdrawal_policy, last 90 days), even one
// resubmitted before closing: 1st a formal warning, 2nd the account is
// subject for suspension, 3rd subject for a ban — an administrator decides.
// A reason is required (suggested chips); details and a proof file are
// optional. The reason goes to administrators only, never the buyer.
// Used by My Quotations, the sealed receipt and Requirement Detail.
import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { View, Text, Pressable, Modal, ActivityIndicator, ScrollView, TextInput, StyleSheet } from 'react-native';
import { color, font, fontSize, lineHeight, space, radius, layout } from './tokens';
import { requirementsApi, type WithdrawalPreviewOut, type WithdrawReasonInput } from '../../lib/api/requirements';
import { errorMessage } from '../../lib/api/client';
import { isWebFilePickerSupported, pickWebFile } from '../../lib/pickWebFile';

const DETAILS_MAX = 500;
const OTHER_MIN = 10;

/** Used only when the preview can't load — the same list the backend accepts. */
const FALLBACK_REASONS = [
  { code: 'pricing_error', label: 'Pricing or computation error' },
  { code: 'cost_changed', label: 'Supplier or material cost changed' },
  { code: 'stock_unavailable', label: 'Stock or material no longer available' },
  { code: 'cannot_meet', label: "Can't meet the quantity or timeline" },
  { code: 'wrong_details', label: 'Wrong details or attachment submitted' },
  { code: 'other', label: 'Other' },
];

function ordinal(n: number): string {
  return n === 1 ? '1st' : n === 2 ? '2nd' : n === 3 ? '3rd' : `${n}th`;
}

function WithdrawConfirmModal({ onConfirm, onClose }: { onConfirm: (reason: WithdrawReasonInput) => Promise<void>; onClose: () => void }) {
  const [preview, setPreview] = useState<WithdrawalPreviewOut | null>(null);
  const [previewFailed, setPreviewFailed] = useState(false);
  const [code, setCode] = useState<string | null>(null);
  const [details, setDetails] = useState('');
  const [proof, setProof] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    requirementsApi.withdrawalPreview().then(setPreview).catch(() => setPreviewFailed(true));
  }, []);

  const reasons = preview?.reasons ?? FALLBACK_REASONS;
  const severe = preview ? preview.next !== 'warning' : false;
  const tone = severe ? { bg: color.dangerFaint, border: color.dangerBorder, ink: color.danger } : { bg: color.warningFaint, border: color.warningBorder, ink: color.warning };
  const otherTooShort = code === 'other' && details.trim().length < OTHER_MIN;
  const ready = !!code && !otherTooShort && !busy;

  const attach = async () => {
    if (!isWebFilePickerSupported()) return;
    const picked = await pickWebFile('.pdf,.jpg,.jpeg,.png,application/pdf,image/*');
    if (picked) setProof(picked);
  };

  const confirm = async () => {
    if (!code) {
      setError('Pick a reason first.');
      return;
    }
    if (otherTooShort) {
      setError(`Explain the reason in at least ${OTHER_MIN} characters.`);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onConfirm({ reasonCode: code, reasonDetails: details.trim() || null, proof });
      onClose();
    } catch (e: any) {
      // Stays open so nothing typed is lost.
      setError(errorMessage(e, 'Could not withdraw this quotation.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.card}>
          <ScrollView contentContainerStyle={{ gap: space.md }} keyboardShouldPersistTaps="handled">
            <Text style={styles.title}>Withdraw this quotation?</Text>

            {!preview && !previewFailed ? (
              <ActivityIndicator color={color.primary} style={{ alignSelf: 'flex-start' }} />
            ) : (
              <View style={[styles.consequence, { backgroundColor: tone.bg, borderColor: tone.border }]}>
                <Text style={[styles.consequenceTitle, { color: tone.ink }]}>
                  {preview
                    ? `This will be your ${ordinal(preview.next_number)} withdrawal in ${preview.window_days} days`
                    : 'Every withdrawal is recorded on your account'}
                </Text>
                <Text style={styles.body}>
                  {preview ? preview.message : 'It counts even if you resubmit before closing.'}
                </Text>
              </View>
            )}
            <Text style={styles.muted}>
              Every withdrawal counts, even if you resubmit before closing — it protects sealed pricing. Within 90 days:
              1st — formal warning · 2nd — subject for suspension · 3rd — subject for a ban. An administrator reviews and decides.
            </Text>

            <View>
              <Text style={styles.label}>Why are you withdrawing?</Text>
              <View style={styles.chips}>
                {reasons.map((r) => {
                  const on = code === r.code;
                  return (
                    <Pressable
                      key={r.code}
                      onPress={() => setCode(r.code)}
                      accessibilityRole="radio"
                      accessibilityState={{ checked: on }}
                      style={[styles.chip, on && styles.chipOn]}
                    >
                      <Text style={[styles.chipLabel, on && styles.chipLabelOn]}>{r.label}</Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>

            <View>
              <Text style={styles.label}>
                Explain {code === 'other' ? '' : <Text style={styles.optional}>— optional</Text>}
              </Text>
              <TextInput
                value={details}
                onChangeText={setDetails}
                maxLength={DETAILS_MAX}
                multiline
                placeholder={code === 'other' ? 'What happened? (at least 10 characters)' : 'Anything the administrator should know'}
                placeholderTextColor={color.inkFaint}
                style={[styles.input, otherTooShort && !!details ? { borderColor: color.dangerBorder } : null]}
              />
            </View>

            {isWebFilePickerSupported() && (
              <View style={styles.proofRow}>
                {proof ? (
                  <>
                    <Text style={styles.proofName} numberOfLines={1}>{proof.name}</Text>
                    <Pressable onPress={() => setProof(null)} hitSlop={8} accessibilityRole="button">
                      <Text style={styles.link}>Remove</Text>
                    </Pressable>
                  </>
                ) : (
                  <Pressable onPress={attach} accessibilityRole="button" style={styles.attach}>
                    <Text style={styles.attachLabel}>+ Attach proof — optional</Text>
                  </Pressable>
                )}
              </View>
            )}
            <Text style={styles.muted}>Only TrustLink administrators see your reason and proof — never the buyer.</Text>

            {error && <Text style={styles.error}>{error}</Text>}
            <View style={styles.actions}>
              <Pressable onPress={onClose} disabled={busy} style={[styles.button, { borderColor: color.border }]}>
                <Text style={styles.buttonLabel}>Keep my quotation</Text>
              </Pressable>
              <Pressable onPress={confirm} disabled={!ready} style={[styles.button, styles.danger, !ready ? { opacity: 0.5 } : null]}>
                <Text style={[styles.buttonLabel, { color: color.onPrimary }]}>{busy ? 'Withdrawing…' : 'Withdraw anyway'}</Text>
              </Pressable>
            </View>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

/** confirm(action) opens the dialog; the action runs only on "Withdraw anyway",
 *  with the reason the supplier gave. If it throws, the dialog stays open and
 *  shows the error. Render `modal`. */
export function useWithdrawConfirm(): { confirm: (action: (reason: WithdrawReasonInput) => Promise<void>) => void; modal: ReactNode } {
  const [action, setAction] = useState<((reason: WithdrawReasonInput) => Promise<void>) | null>(null);
  return {
    confirm: (a) => setAction(() => a),
    modal: action ? <WithdrawConfirmModal onConfirm={action} onClose={() => setAction(null)} /> : null,
  };
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(15,15,14,0.45)', alignItems: 'center', justifyContent: 'center', padding: space.lg },
  card: { width: '100%', maxWidth: 520, maxHeight: '92%', backgroundColor: color.surface, borderRadius: radius.xl, padding: space.xl },
  title: { fontFamily: font.bodySemi, fontSize: fontSize.lg, color: color.ink },
  consequence: { borderWidth: 1, borderRadius: radius.lg, padding: space.md, gap: space.xs },
  consequenceTitle: { fontFamily: font.bodySemi, fontSize: fontSize.base },
  body: { fontFamily: font.body, fontSize: fontSize.sm, lineHeight: lineHeight.sm, color: color.ink },
  muted: { fontFamily: font.body, fontSize: fontSize.sm, lineHeight: lineHeight.sm, color: color.inkMuted },
  label: { fontFamily: font.bodySemi, fontSize: fontSize.sm, color: color.ink, marginBottom: space.xs },
  optional: { fontFamily: font.body, color: color.inkFaint },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.xs },
  chip: { borderWidth: 1, borderColor: color.border, borderRadius: radius.pill, paddingHorizontal: space.md, paddingVertical: space.xs + 2, backgroundColor: color.canvas },
  chipOn: { borderColor: color.primary, backgroundColor: color.primaryFaint },
  chipLabel: { fontFamily: font.bodyMedium, fontSize: fontSize.sm, color: color.ink },
  chipLabelOn: { color: color.primary },
  input: { minHeight: 72, borderWidth: 1, borderColor: color.border, borderRadius: radius.md, backgroundColor: color.canvas, paddingHorizontal: space.md, paddingVertical: space.sm, fontFamily: font.body, fontSize: fontSize.sm, color: color.ink, textAlignVertical: 'top' },
  proofRow: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  proofName: { flex: 1, minWidth: 0, fontFamily: font.bodyMedium, fontSize: fontSize.sm, color: color.ink },
  attach: { borderWidth: 1, borderStyle: 'dashed', borderColor: color.border, borderRadius: radius.pill, paddingHorizontal: space.md, paddingVertical: space.xs + 2 },
  attachLabel: { fontFamily: font.bodyMedium, fontSize: fontSize.sm, color: color.inkMuted },
  link: { fontFamily: font.bodySemi, fontSize: fontSize.sm, color: color.primary },
  error: { fontFamily: font.body, fontSize: fontSize.sm, color: color.danger },
  actions: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-end', gap: space.sm },
  button: { minHeight: layout.minTouchTarget, borderRadius: radius.pill, borderWidth: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: space.lg },
  danger: { backgroundColor: color.danger, borderColor: color.danger },
  buttonLabel: { fontFamily: font.bodySemi, fontSize: fontSize.sm, color: color.ink },
});
