// features/verification/VerificationStatus.tsx
// A persistent, revisitable answer to "what state am I in?" — unlike Onboarding.tsx's
// ARRIVAL screen (a one-off confirmation shown only once, right after submitting, and
// never reconstructible afterward since it's built from local draft state), this reads
// straight from GET /business/verification-status, so it's accurate any time the
// business comes back to check, including after an admin has since reviewed them.

import { View, Text, Pressable, StyleSheet, useWindowDimensions } from 'react-native';
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
import type { VerificationStatusOut, DocumentUploadOut } from '../../lib/api/business';

export interface VerificationStatusProps {
  status: VerificationStatusOut;
  onBack?: () => void;
  onContinueOnboarding?: () => void;
}

const DOC_TYPE_LABELS: Record<string, string> = {
  DTI: 'DTI Certificate of Business Name Registration',
  SEC: 'SEC Certificate of Incorporation',
  BIR: 'BIR Certificate of Registration',
  MAYORS_PERMIT: "Mayor's / Business Permit",
};

const MISSING_LABELS: Record<string, string> = {
  DTI_OR_SEC: 'DTI or SEC registration',
  DTI: 'DTI Certificate',
  SEC: 'SEC Certificate',
  BIR: 'BIR Certificate',
};

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

type Tone = 'primary' | 'danger' | 'neutral';

interface StageMeta {
  pillLabel: string;
  tone: Tone;
  title: string;
  body: string;
}

function stageMeta(status: VerificationStatusOut): StageMeta {
  switch (status.verification_status) {
    case 'verified':
      return {
        pillLabel: 'Verified',
        tone: 'primary',
        title: 'Your business is verified',
        body: `Verified ${formatDate(status.verification_date)}${status.recheck_date ? ` · re-check due ${formatDate(status.recheck_date)}` : ''}. Posting a requirement and submitting a quotation are open to you.`,
      };
    case 'under_review':
      return {
        pillLabel: 'Under review',
        tone: 'danger',
        title: 'A document needs a closer look',
        body: 'One or more documents did not pass an automatic check and are now waiting on manual review by an administrator. See the notes below for why — you\'ll be alerted once a decision is made.',
      };
    case 'rejected':
      return {
        pillLabel: 'Rejected',
        tone: 'danger',
        title: 'Verification was rejected',
        body: 'See the notes below for the reason, then re-upload the affected document from onboarding to try again.',
      };
    case 'submitted':
      return {
        pillLabel: 'Submitted',
        tone: 'neutral',
        title: 'Submitted — awaiting review',
        body: 'Your documents are with the Trustlink team. This usually takes under one working day.',
      };
    case 'pending':
      return {
        pillLabel: 'Incomplete',
        tone: 'neutral',
        title: 'Verification not yet submitted',
        body:
          status.missing_documents.length > 0
            ? `Still needed before you can submit: ${status.missing_documents.map((m) => MISSING_LABELS[m] ?? m).join(', ')}.`
            : 'Finish uploading your documents in onboarding to submit for verification.',
      };
    default:
      return {
        pillLabel: 'Not started',
        tone: 'neutral',
        title: "You haven't started verification",
        body: 'Complete onboarding and upload your documents to get verified — required before you can post a requirement or submit a quotation.',
      };
  }
}

function ToneBadge({ label, tone }: { label: string; tone: Tone }) {
  const bg = tone === 'primary' ? color.primaryFaint : tone === 'danger' ? color.dangerFaint : color.surfaceSunken;
  const border = tone === 'primary' ? color.primary : tone === 'danger' ? color.dangerBorder : color.border;
  const text = tone === 'primary' ? color.primary : tone === 'danger' ? color.danger : color.inkMuted;
  return (
    <View style={[styles.badge, { backgroundColor: bg, borderColor: border }]}>
      <Text style={[styles.badgeLabel, { color: text }]}>{label}</Text>
    </View>
  );
}

function SectionLabel({ children }: { children: string }) {
  return <Text style={styles.sectionLabel}>{children}</Text>;
}

function DocumentRow({ doc }: { doc: DocumentUploadOut }) {
  const passed = doc.validation_status === 'pass';
  return (
    <View style={styles.docRow}>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={styles.docName}>{DOC_TYPE_LABELS[doc.doc_type] ?? doc.doc_type}</Text>
        <Text style={styles.mutedSmall}>Uploaded {formatDate(doc.uploaded_at)}</Text>
        {!passed && !!doc.validation_notes && <Text style={styles.docNotes}>{doc.validation_notes}</Text>}
      </View>
      <ToneBadge label={passed ? 'Passed' : 'Flagged'} tone={passed ? 'primary' : 'danger'} />
    </View>
  );
}

function ActionButton({ label, onPress, variant = 'outline' }: { label: string; onPress?: () => void; variant?: 'primary' | 'outline' }) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.actionButton,
        {
          backgroundColor: variant === 'primary' ? (pressed ? color.primaryPressed : color.primary) : color.surface,
          borderColor: variant === 'primary' ? color.primary : color.border,
        },
      ]}
    >
      <Text style={[styles.actionButtonLabel, { color: variant === 'primary' ? color.onPrimary : color.ink }]}>{label}</Text>
    </Pressable>
  );
}

export default function VerificationStatus({ status, onBack, onContinueOnboarding }: VerificationStatusProps) {
  const { width } = useWindowDimensions();
  const isWide = width >= breakpoint.desktop;
  const meta = stageMeta(status);
  const notStarted = status.verification_status === 'unverified' || (status.verification_status === 'pending' && !status.onboarding_completed);

  return (
    <ScreenScroll style={styles.root} contentContainerStyle={styles.scrollContent}>
      <View style={isWide ? styles.pageWide : styles.page}>
        <View style={styles.breadcrumbRow}>
          <Pressable onPress={onBack} hitSlop={6}>
            <Text style={styles.breadcrumbLink}>Home</Text>
          </Pressable>
          <Text style={styles.breadcrumbSep}>/</Text>
          <Text style={styles.breadcrumbCurrent}>Verification status</Text>
        </View>

        <View style={styles.hero}>
          <ToneBadge label={meta.pillLabel} tone={meta.tone} />
          <Text style={styles.heroTitle}>{meta.title}</Text>
          <Text style={styles.heroBody}>{meta.body}</Text>
        </View>

        {status.verification_status === 'verified' && (
          <View style={styles.card}>
            <SectionLabel>Trust tier</SectionLabel>
            <Text style={styles.tierValue}>Tier {status.tier} of 3</Text>
          </View>
        )}

        {status.documents.length > 0 && (
          <View style={styles.card}>
            <SectionLabel>Documents</SectionLabel>
            <View style={{ gap: space.md, marginTop: space.sm }}>
              {status.documents.map((d) => (
                <DocumentRow key={d.id} doc={d} />
              ))}
            </View>
          </View>
        )}

        <View style={styles.footerRow}>
          {(notStarted || status.verification_status === 'pending' || status.verification_status === 'rejected') && (
            <ActionButton
              label={status.verification_status === 'rejected' ? 'Review and re-submit' : notStarted ? 'Start verification' : 'Continue onboarding'}
              variant="primary"
              onPress={onContinueOnboarding}
            />
          )}
          <ActionButton label="Back to home" variant="outline" onPress={onBack} />
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

  hero: { gap: space.sm, alignItems: 'flex-start' },
  heroTitle: { fontFamily: font.display, fontSize: fontSize.display, lineHeight: lineHeight.display, letterSpacing: letterSpacing.tight, color: color.ink },
  heroBody: { fontFamily: font.body, fontSize: fontSize.base, lineHeight: lineHeight.base, color: color.inkMuted, maxWidth: 560 },

  card: { ...elevation.cardRaised, borderRadius: radius.xl, backgroundColor: color.surface, padding: space.lg },
  sectionLabel: {
    fontFamily: font.mono,
    fontSize: fontSize.micro,
    letterSpacing: letterSpacing.label,
    textTransform: 'uppercase',
    color: color.inkFaint,
  },
  tierValue: { marginTop: space.xs, fontFamily: font.display, fontSize: fontSize.lg, color: color.ink },

  docRow: { flexDirection: 'row', alignItems: 'flex-start', gap: space.md, paddingBottom: space.md, borderBottomWidth: 1, borderBottomColor: color.borderFaint },
  docName: { fontFamily: font.bodySemi, fontSize: fontSize.base, color: color.ink },
  docNotes: { marginTop: space.xs, fontFamily: font.body, fontSize: fontSize.sm, lineHeight: lineHeight.sm, color: color.danger },
  mutedSmall: { fontFamily: font.body, fontSize: fontSize.sm, color: color.inkMuted, marginTop: 2 },

  badge: { alignSelf: 'flex-start', borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: space.md, paddingVertical: space.xs },
  badgeLabel: { fontFamily: font.monoMedium, fontSize: fontSize.micro, letterSpacing: letterSpacing.label, textTransform: 'uppercase' },

  footerRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, flexWrap: 'wrap', marginTop: space.sm },
  actionButton: { minHeight: layout.minTouchTarget, borderRadius: radius.pill, borderWidth: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: space.xl },
  actionButtonLabel: { fontFamily: font.bodySemi, fontSize: fontSize.sm },
});
