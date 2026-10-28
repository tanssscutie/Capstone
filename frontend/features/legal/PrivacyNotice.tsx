// features/legal/PrivacyNotice.tsx
// TrustLink's Privacy Notice under the Data Privacy Act of 2012 (RA 10173).
// Describes what this system actually does with data — keep it in step with
// the code: who can see what (sealed quotations, contact visibility), which
// outside services receive data (Google Gemini, the email provider, Google
// Sign-In), and how files are protected.
//
// Changing it in substance? Bump PRIVACY_NOTICE_VERSION here AND
// PRIVACY_POLICY_VERSION in backend/app/core/privacy.py — every account is
// then asked to agree again.
import { View, Text, Pressable, StyleSheet, useWindowDimensions } from 'react-native';
import ScreenScroll from '../../components/ui/ScreenScroll';
import { color, font, fontSize, lineHeight, letterSpacing, space, radius, elevation, layout, breakpoint } from '../../components/ui/tokens';

export const PRIVACY_NOTICE_VERSION = '2026-10-28';
const CONTACT_EMAIL = 'support@trustlink.ph';

interface Section {
  title: string;
  paragraphs?: string[];
  bullets?: string[];
  /** After the bullets. */
  outro?: string;
}

const SECTIONS: Section[] = [
  {
    title: '1. Who we are',
    paragraphs: [
      'TrustLink is a sealed-quotation procurement platform for verified printing and packaging & labeling businesses in Metro Manila. ' +
        'TrustLink is the personal information controller for the data described here.',
    ],
  },
  {
    title: '2. What we collect',
    bullets: [
      'Account: business name, mobile number, email address, password (stored only as a one-way hash), account type (buyer or seller), business category and, for sellers, years in business. If you sign in with Google, we receive your name and email address from Google.',
      'Business profile: registered and display name, business type, city, contact person and contact number, capabilities, service areas, items offered and an optional description.',
      "Verification documents: the DTI, SEC, BIR and Mayor's Permit files you upload, with the registration numbers, names and expiry dates you declare.",
      'Procurement activity: requirements you post (including the delivery address), quotations you submit, attachments, shortlists, awards, transaction close-outs and the tamper-evident ledger that records them.',
      'Communication: clarification questions and answers, messages and files exchanged after an award, document requests, and your alert and email preferences.',
      'Sign-in data: a login token kept in your browser so you stay signed in.',
    ],
  },
  {
    title: '3. Why we use it',
    bullets: [
      'To create and secure your account and confirm your email address.',
      'To verify that your business is legitimate before it can post requirements or submit quotations.',
      'To run sealed procurement: show requirements to matching suppliers, keep quotations sealed until closing, release them to the buyer, and record every step on the ledger.',
      'To match requirements with suppliers by category, items and capabilities, and to alert you in the app and by email.',
      'To let a buyer and the awarded supplier coordinate after the award.',
      'To prevent fraud and misuse, and to keep an audit trail.',
    ],
  },
  {
    title: '4. Legal basis',
    paragraphs: [
      'We process your personal information with your consent, which you give when you create your account; because it is needed to provide the service you signed up for; ' +
        'and for our legitimate interest in keeping procurement on TrustLink fair and secure — as allowed under Section 12 of the Data Privacy Act of 2012.',
    ],
  },
  {
    title: '5. Who can see your information',
    bullets: [
      'Your public business profile (name, category, location, capabilities, verification status and activity counts) is visible to signed-in TrustLink users.',
      'Your contact person and contact number are shown only to verified businesses.',
      "A supplier may choose to list a completed TrustLink order on its profile's Past work, showing what was delivered, the city, and the buyer's business name — never the price.",
      'Your verification documents and their registration numbers are seen only by TrustLink administrators who review them. They are never shown on your profile.',
      "A quotation stays sealed until the requirement closes — no one, not even the buyer, can read it before then. After closing, only the requirement's buyer (and administrators) can read it. Other suppliers never see your price.",
      'Messages and files after an award are visible only to the buyer and the awarded supplier.',
      'The delivery address on a requirement is visible to suppliers who can view that requirement.',
    ],
  },
  {
    title: '6. Outside services that process your data',
    bullets: [
      'Google Gemini (Google LLC): when you upload a verification document, the image is sent to Google so the document number can be read and suggested to you. When you post a requirement, its title and detail may be sent to suggest a category, and if you press Write with AI, what you filled in on the Details step (category, item, title, specifications, quantity and budget) is sent to draft the Detail text. TrustLink does not save that draft; suggestions are optional and you always review them.',
      'Our email provider delivers verification codes and alert emails to your email address.',
      'Google Sign-In, if you choose to use it, shares your name and email address with us.',
    ],
    outro: 'We do not sell your personal information, and we do not share it for advertising.',
  },
  {
    title: '7. How we protect it',
    bullets: [
      'Passwords are stored only as salted one-way hashes (bcrypt).',
      'Uploaded files — verification documents, attachments, requested documents and message files — are encrypted when stored.',
      'Access to quotations, documents and messages is checked on every request, according to the rules in section 5.',
      'The procurement ledger is hash-chained, so changes to past records can be detected.',
    ],
  },
  {
    title: '8. How long we keep it',
    bullets: [
      'Account and profile information: while your account is active. If you ask us to close your account, it is deleted or anonymized within 30 days, except for the records below.',
      'Verification documents: while your account is active, and up to 1 year after it is closed, in case a verification decision is disputed.',
      'Procurement records — requirements, quotations, awards, transaction close-outs and ledger entries: 5 years after the transaction ends, because the integrity of the ledger and other businesses depend on them. After that they are deleted or anonymized.',
      'Messages and files exchanged after an award: 5 years after the transaction ends, together with the procurement record they belong to.',
      'Backups: overwritten within 90 days.',
    ],
  },
  {
    title: '9. Your rights',
    paragraphs: ['Under the Data Privacy Act of 2012, you have the right to:'],
    bullets: [
      'Be informed of how your personal information is processed.',
      'Access your personal information and get a copy of it.',
      'Correct inaccurate or outdated information.',
      'Object to processing, and withdraw your consent.',
      'Have your information erased or blocked, where the law allows.',
      'Data portability — receive your data in a commonly used electronic format.',
      'Claim damages if you are harmed by unlawful processing.',
      'File a complaint with the National Privacy Commission (privacy.gov.ph).',
    ],
  },
  {
    title: '10. Contact us',
    paragraphs: [
      `For privacy questions or to exercise your rights, contact our Data Protection Officer at ${CONTACT_EMAIL}. ` +
        'Withdrawing consent may mean we can no longer provide your account, since TrustLink cannot run without the information above.',
    ],
  },
  {
    title: '11. Changes to this notice',
    paragraphs: [
      'If we change this notice in a way that affects you, we will ask you to review and agree to the new version the next time you use TrustLink.',
    ],
  },
];

function formatVersion(v: string): string {
  const d = new Date(`${v}T00:00:00`);
  return Number.isNaN(d.getTime()) ? v : d.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
}

export interface PrivacyNoticeProps {
  onBack?: () => void;
  backLabel?: string;
}

export default function PrivacyNotice({ onBack, backLabel = 'Back' }: PrivacyNoticeProps) {
  const { width } = useWindowDimensions();
  const isWide = width >= breakpoint.desktop;

  return (
    <ScreenScroll style={styles.root} contentContainerStyle={styles.scrollContent}>
      <View style={isWide ? styles.pageWide : styles.page}>
        {onBack && (
          <Pressable onPress={onBack} hitSlop={6} style={{ alignSelf: 'flex-start' }}>
            <Text style={styles.backLink}>← {backLabel}</Text>
          </Pressable>
        )}

        <View style={styles.hero}>
          <Text style={styles.heroName}>Privacy Notice</Text>
          <Text style={styles.muted}>
            How TrustLink collects, uses and protects your personal information under the Data Privacy Act of 2012 (Republic Act No. 10173).
          </Text>
          <Text style={styles.version}>Effective {formatVersion(PRIVACY_NOTICE_VERSION)}</Text>
        </View>

        <View style={styles.card}>
          {SECTIONS.map((section, i) => (
            <View key={section.title} style={[styles.section, i > 0 ? styles.sectionDivided : null]}>
              <Text style={styles.sectionTitle}>{section.title}</Text>
              {section.paragraphs?.map((p) => (
                <Text key={p} style={styles.body}>{p}</Text>
              ))}
              {section.bullets?.map((b) => (
                <View key={b} style={styles.bulletRow}>
                  <Text style={styles.bulletDot}>•</Text>
                  <Text style={[styles.body, { flex: 1 }]}>{b}</Text>
                </View>
              ))}
              {section.outro && <Text style={styles.body}>{section.outro}</Text>}
            </View>
          ))}
        </View>
      </View>
    </ScreenScroll>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: color.canvas },
  scrollContent: { alignItems: 'center', paddingVertical: space.lg, paddingBottom: space.xxl },
  page: { width: '100%', maxWidth: layout.maxWidth, paddingHorizontal: layout.screenPadding, gap: space.lg },
  pageWide: { width: '100%', maxWidth: 760, paddingHorizontal: layout.screenPadding, gap: space.lg },
  backLink: { fontFamily: font.bodyMedium, fontSize: fontSize.sm, color: color.primary },
  hero: { gap: space.xs },
  heroName: { fontFamily: font.display, fontSize: fontSize.display, lineHeight: lineHeight.display, letterSpacing: letterSpacing.tight, color: color.ink },
  muted: { fontFamily: font.body, fontSize: fontSize.sm, lineHeight: lineHeight.sm, color: color.inkMuted },
  version: { fontFamily: font.mono, fontSize: fontSize.micro, letterSpacing: letterSpacing.label, textTransform: 'uppercase', color: color.inkFaint, marginTop: space.xs },
  card: { ...elevation.cardRaised, borderRadius: radius.xl, backgroundColor: color.surface, padding: space.lg },
  section: { gap: space.sm, paddingVertical: space.md },
  sectionDivided: { borderTopWidth: 1, borderTopColor: color.borderFaint },
  sectionTitle: { fontFamily: font.bodySemi, fontSize: fontSize.base, color: color.ink },
  body: { fontFamily: font.body, fontSize: fontSize.sm, lineHeight: lineHeight.sm, color: color.inkMuted },
  bulletRow: { flexDirection: 'row', gap: space.sm },
  bulletDot: { fontFamily: font.body, fontSize: fontSize.sm, lineHeight: lineHeight.sm, color: color.inkFaint },
});
