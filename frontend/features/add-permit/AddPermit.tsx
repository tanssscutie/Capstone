// features/add-permit/AddPermit.tsx
// "Add your Mayor's permit" — HomeFeed's ProfileCard promised this as the next
// step toward Tier 2, but the button did nothing (onPress={() => {}}). A real,
// focused upload: this is the ONE document a Tier 1 business is missing, so
// there's no reason to route them through the full onboarding wizard again —
// just the file, its permit number, and a submit.

import { useState } from 'react';
import { View, Text, Pressable, TextInput, StyleSheet, useWindowDimensions } from 'react-native';
import ScreenScroll from '../../components/ui/ScreenScroll';
import {
  color,
  font,
  fontSize,
  lineHeight,
  letterSpacing,
  space,
  radius,
  elevation,
  layout,
  breakpoint,
} from '../../components/ui/tokens';
import { errorMessage } from '../../lib/api/client';

/** Mirrors the backend's ID_FORMAT_PATTERNS["MAYORS_PERMIT"] (business_service.py). */
const PERMIT_NUMBER_PATTERN = /^[A-Za-z0-9\-/]{4,30}$/;

export interface PickedFile {
  file: File;
  filename: string;
  sizeBytes: number;
}

export interface AddPermitProps {
  onBack?: () => void;
  onSubmit: (file: File, fileName: string, permitNumber: string) => Promise<void>;
}

function SectionLabel({ children }: { children: string }) {
  return <Text style={styles.sectionLabel}>{children}</Text>;
}

export default function AddPermit({ onBack, onSubmit }: AddPermitProps) {
  const { width } = useWindowDimensions();
  const isWide = width >= breakpoint.desktop;

  const [picked, setPicked] = useState<PickedFile | null>(null);
  const [permitNumber, setPermitNumber] = useState('');
  const [attempted, setAttempted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const numberBad = !PERMIT_NUMBER_PATTERN.test(permitNumber.trim());

  const capture = () => {
    if (typeof document === 'undefined' || typeof document.createElement !== 'function') return;
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*,application/pdf';
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) return;
      setPicked({ file, filename: file.name || 'mayors-permit.jpg', sizeBytes: file.size });
    };
    input.click();
  };

  const handleSubmit = async () => {
    if (!picked || numberBad) {
      setAttempted(true);
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await onSubmit(picked.file, picked.filename, permitNumber.trim());
      setDone(true);
    } catch (e: any) {
      setError(errorMessage(e, 'Could not upload your permit. Please try again.'));
    } finally {
      setSubmitting(false);
    }
  };

  if (done) {
    return (
      <View style={styles.root}>
        <View style={[isWide ? styles.pageWide : styles.page, { paddingTop: space.section, gap: space.lg, alignItems: 'center' }]}>
          <Text style={styles.heroName}>Submitted</Text>
          <Text style={[styles.mutedSmall, { textAlign: 'center' }]}>
            Your Mayor's permit is on file. If it passes the same checks your other documents did, your tier updates automatically —
            no separate review step needed for this one.
          </Text>
          <Pressable onPress={onBack} style={({ pressed }) => [styles.actionButton, { backgroundColor: pressed ? color.surfaceSunken : color.surface }]}>
            <Text style={styles.actionButtonLabel}>Back to home</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  return (
    <ScreenScroll style={styles.root} contentContainerStyle={styles.scrollContent}>
      <View style={isWide ? styles.pageWide : styles.page}>
        <View style={styles.breadcrumbRow}>
          <Pressable onPress={onBack} hitSlop={6}>
            <Text style={styles.breadcrumbLink}>Home</Text>
          </Pressable>
          <Text style={styles.breadcrumbSep}>/</Text>
          <Text style={styles.breadcrumbCurrent}>Add Mayor's Permit</Text>
        </View>

        <View style={styles.hero}>
          <Text style={styles.heroName}>Add your Mayor's permit</Text>
          <Text style={styles.mutedSmall}>Not required to stay verified — this is what moves you from Tier 1 to Tier 2.</Text>
        </View>

        {error && (
          <View style={styles.errorBanner}>
            <Text style={styles.errorBannerText}>{error}</Text>
          </View>
        )}

        <View style={styles.card}>
          <SectionLabel>Document</SectionLabel>
          <View style={{ marginTop: space.sm }}>
            {picked ? (
              <View style={styles.fileCard}>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={styles.fileName} numberOfLines={1}>{picked.filename}</Text>
                  <Text style={styles.mutedSmall}>{(picked.sizeBytes / 1_000_000).toFixed(1)} MB</Text>
                </View>
                <Pressable onPress={() => setPicked(null)} hitSlop={8}>
                  <Text style={styles.removeLink}>Remove</Text>
                </Pressable>
              </View>
            ) : (
              <Pressable onPress={capture} style={styles.addDashed}>
                <Text style={styles.addDashedLabel}>+ Add a photo or file</Text>
              </Pressable>
            )}
            {attempted && !picked && <Text style={styles.errorText}>Attach your Mayor's permit to submit.</Text>}
          </View>

          <View style={{ marginTop: space.md }}>
            <Text style={styles.fieldLabel}>Permit number</Text>
            <TextInput
              value={permitNumber}
              onChangeText={setPermitNumber}
              placeholder="BP-2024-001234"
              placeholderTextColor={color.inkFaint}
              autoCapitalize="characters"
              style={[styles.input, attempted && numberBad ? styles.inputError : null]}
            />
            {attempted && numberBad && (
              <Text style={styles.errorText}>That doesn't look like a valid permit number — check it against the document.</Text>
            )}
          </View>
        </View>

        <View style={styles.footerRow}>
          <Pressable
            onPress={handleSubmit}
            disabled={submitting}
            style={({ pressed }) => [
              styles.actionButton,
              { backgroundColor: submitting ? color.primaryPressed : pressed ? color.primaryPressed : color.primary, borderColor: color.primary, opacity: submitting ? 0.7 : 1 },
            ]}
          >
            <Text style={[styles.actionButtonLabel, { color: color.onPrimary }]}>{submitting ? 'Submitting…' : 'Submit'}</Text>
          </Pressable>
          <Pressable onPress={onBack} style={({ pressed }) => [styles.actionButton, { backgroundColor: pressed ? color.surfaceSunken : color.surface }]}>
            <Text style={styles.actionButtonLabel}>Cancel</Text>
          </Pressable>
        </View>
      </View>
    </ScreenScroll>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: color.canvas },
  scrollContent: { alignItems: 'center', paddingVertical: space.lg, paddingBottom: space.xxl },

  page: { width: '100%', maxWidth: layout.maxWidth, paddingHorizontal: layout.screenPadding, gap: space.lg },
  pageWide: { width: '100%', maxWidth: 720, paddingHorizontal: layout.screenPadding, gap: space.lg },

  breadcrumbRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, flexWrap: 'wrap' },
  breadcrumbLink: { fontFamily: font.body, fontSize: fontSize.sm, color: color.inkFaint },
  breadcrumbSep: { fontFamily: font.body, fontSize: fontSize.sm, color: color.inkFaint },
  breadcrumbCurrent: { fontFamily: font.body, fontSize: fontSize.sm, color: color.inkMuted },

  hero: { gap: space.xs },
  heroName: {
    fontFamily: font.display,
    fontSize: fontSize.display,
    lineHeight: lineHeight.display,
    letterSpacing: letterSpacing.tight,
    color: color.ink,
  },

  card: { ...elevation.cardRaised, borderRadius: radius.xl, backgroundColor: color.surface, padding: space.lg },
  sectionLabel: {
    fontFamily: font.mono,
    fontSize: fontSize.micro,
    letterSpacing: letterSpacing.label,
    textTransform: 'uppercase',
    color: color.inkFaint,
  },

  mutedSmall: { fontFamily: font.body, fontSize: fontSize.sm, lineHeight: lineHeight.sm, color: color.inkMuted },
  fieldLabel: { fontFamily: font.bodySemi, fontSize: fontSize.base, color: color.ink },
  errorText: { marginTop: space.xs, fontFamily: font.body, fontSize: fontSize.sm, color: color.danger },

  input: { marginTop: space.xs, backgroundColor: color.canvas, borderWidth: 1, borderColor: color.border, borderRadius: radius.lg, paddingHorizontal: space.md, paddingVertical: space.sm, fontFamily: font.body, fontSize: fontSize.base, color: color.ink },
  inputError: { borderColor: color.dangerBorder },

  addDashed: { borderWidth: 1, borderStyle: 'dashed', borderColor: color.border, borderRadius: radius.lg, paddingVertical: space.lg, alignItems: 'center' },
  addDashedLabel: { fontFamily: font.bodyMedium, fontSize: fontSize.base, color: color.inkMuted },

  fileCard: { flexDirection: 'row', alignItems: 'center', gap: space.md, borderWidth: 1, borderColor: color.border, borderRadius: radius.lg, padding: space.md },
  fileName: { fontFamily: font.bodyMedium, fontSize: fontSize.base, color: color.ink },
  removeLink: { fontFamily: font.bodySemi, fontSize: fontSize.sm, color: color.danger },

  errorBanner: { backgroundColor: color.dangerFaint, borderRadius: radius.lg, padding: space.md },
  errorBannerText: { fontFamily: font.body, fontSize: fontSize.sm, color: color.danger },

  footerRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, flexWrap: 'wrap', marginTop: space.sm },
  actionButton: { minHeight: layout.minTouchTarget, borderRadius: radius.pill, borderWidth: 1, borderColor: color.border, alignItems: 'center', justifyContent: 'center', paddingHorizontal: space.xl },
  actionButtonLabel: { fontFamily: font.bodySemi, fontSize: fontSize.sm, color: color.ink },
});
