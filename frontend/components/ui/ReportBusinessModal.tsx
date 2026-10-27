// components/ui/ReportBusinessModal.tsx
// "Report this business" — one form for every place a business can be
// reported from: a profile, the Reports page, the award chat, a quotation
// card. Sends POST /business/{id}/report itself unless the caller passes
// onSubmit. Reviewed by an admin; the business never learns who reported it.
import { useState } from 'react';
import { View, Text, Pressable, Modal, TextInput, StyleSheet, Platform } from 'react-native';
import { color, font, fontSize, lineHeight, space, radius } from './tokens';
import { REPORT_REASONS, reportBusiness, type ReportReason } from '../../lib/api/business';
import { errorMessage } from '../../lib/api/client';

const REPORT_DETAILS_MIN = 10;

/** A small "Report" link that opens the form itself — drop it next to any
 *  business a viewer deals with (quotation card, chat, buyer facts). */
export function ReportLink({ businessId, businessName, label = 'Report' }: {
  businessId: number | string;
  businessName: string;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Pressable onPress={() => setOpen(true)} hitSlop={6} accessibilityRole="button" accessibilityLabel={`Report ${businessName}`}>
        <Text style={styles.link}>{label}</Text>
      </Pressable>
      {open && <ReportBusinessModal businessId={businessId} businessName={businessName} onClose={() => setOpen(false)} />}
    </>
  );
}

export function ReportBusinessModal({ businessId, businessName, onClose, onSubmit }: {
  businessId?: number | string;
  businessName: string;
  onClose: () => void;
  /** Resolves to an error message, or null when sent. Defaults to reporting businessId. */
  onSubmit?: (reason: ReportReason, details: string) => Promise<string | null>;
}) {
  const [reason, setReason] = useState<ReportReason | null>(null);
  const [details, setDetails] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const canSend = !!reason && details.trim().length >= REPORT_DETAILS_MIN && !sending;

  const submit = onSubmit ?? (async (r: ReportReason, d: string) => {
    try {
      await reportBusiness(Number(businessId), r, d);
      return null;
    } catch (e: any) {
      return errorMessage(e, 'Could not send the report.');
    }
  });

  const send = async () => {
    if (!canSend || !reason) return;
    setSending(true);
    setError(null);
    const err = await submit(reason, details).catch(() => 'Could not send the report. Try again.');
    setSending(false);
    if (err) setError(err);
    else setSent(true);
  };

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.overlay} onPress={onClose}>
        <Pressable style={styles.card} onPress={() => {}}>
          {sent ? (
            <View style={{ gap: space.md }}>
              <Text style={styles.title}>Report sent</Text>
              <Text style={styles.muted}>
                Thanks — a TrustLink administrator will review it. {businessName} won't be told who reported them. You can follow it on the Reports page.
              </Text>
              <Pressable onPress={onClose} style={[styles.button, styles.primary]}>
                <Text style={[styles.buttonLabel, { color: color.onPrimary }]}>Done</Text>
              </Pressable>
            </View>
          ) : (
            <View style={{ gap: space.md }}>
              <Text style={styles.title}>Report {businessName}</Text>
              <Text style={styles.muted}>An administrator reviews every report. It stays confidential.</Text>
              <View style={{ gap: space.xs }}>
                {REPORT_REASONS.map((r) => (
                  <Pressable
                    key={r.value}
                    onPress={() => setReason(r.value)}
                    accessibilityRole="radio"
                    accessibilityState={{ checked: reason === r.value }}
                    style={[styles.reasonRow, reason === r.value ? styles.reasonRowActive : null]}
                  >
                    <View style={[styles.radio, reason === r.value ? styles.radioActive : null]} />
                    <Text style={styles.reasonLabel}>{r.label}</Text>
                  </Pressable>
                ))}
              </View>
              <TextInput
                value={details}
                onChangeText={setDetails}
                multiline
                maxLength={1000}
                placeholder="What happened? Include the requirement reference (e.g. RQ-601) if it's about one."
                placeholderTextColor={color.inkFaint}
                style={styles.input}
              />
              {details.length > 0 && details.trim().length < REPORT_DETAILS_MIN && (
                <Text style={styles.muted}>A little more detail, please — at least {REPORT_DETAILS_MIN} characters.</Text>
              )}
              {error && <Text style={styles.error}>{error}</Text>}
              <View style={styles.footer}>
                <Pressable onPress={onClose} style={styles.button}>
                  <Text style={styles.buttonLabel}>Cancel</Text>
                </Pressable>
                <Pressable onPress={send} disabled={!canSend} style={[styles.button, styles.danger, !canSend ? { opacity: 0.5 } : null]}>
                  <Text style={[styles.buttonLabel, { color: color.danger }]}>{sending ? 'Sending…' : 'Send report'}</Text>
                </Pressable>
              </View>
            </View>
          )}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(15,15,14,0.45)', alignItems: 'center', justifyContent: 'center', padding: space.lg },
  card: {
    width: '100%', maxWidth: 460, maxHeight: '90%', backgroundColor: color.surface, borderRadius: radius.xl, padding: space.xl,
    ...(Platform.OS === 'web' ? { overflowY: 'auto' } as object : null),
  },
  title: { fontFamily: font.bodySemi, fontSize: fontSize.lg, color: color.ink },
  muted: { fontFamily: font.body, fontSize: fontSize.sm, lineHeight: lineHeight.sm, color: color.inkMuted },
  reasonRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, borderWidth: 1, borderColor: color.border, borderRadius: radius.md, paddingHorizontal: space.md, paddingVertical: space.sm },
  reasonRowActive: { borderColor: color.primary, backgroundColor: color.primaryFaint },
  radio: { width: 14, height: 14, borderRadius: radius.pill, borderWidth: 1.5, borderColor: color.borderStrong },
  radioActive: { borderColor: color.primary, backgroundColor: color.primary },
  reasonLabel: { flex: 1, fontFamily: font.body, fontSize: fontSize.sm, color: color.ink },
  input: { minHeight: 96, borderWidth: 1, borderColor: color.border, borderRadius: radius.md, paddingHorizontal: space.md, paddingVertical: space.sm, fontFamily: font.body, fontSize: fontSize.sm, color: color.ink, textAlignVertical: 'top' },
  error: { fontFamily: font.body, fontSize: fontSize.sm, color: color.danger },
  footer: { flexDirection: 'row', alignItems: 'center', gap: space.md, flexWrap: 'wrap' },
  button: { minHeight: 44, borderRadius: radius.pill, borderWidth: 1, borderColor: color.border, alignItems: 'center', justifyContent: 'center', paddingHorizontal: space.xl },
  primary: { backgroundColor: color.primary, borderColor: color.primary },
  danger: { borderColor: color.dangerBorder },
  buttonLabel: { fontFamily: font.bodySemi, fontSize: fontSize.sm, color: color.ink },
  link: { fontFamily: font.bodyMedium, fontSize: fontSize.sm, color: color.inkMuted, textDecorationLine: 'underline' },
});
