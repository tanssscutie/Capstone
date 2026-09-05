// features/help/HelpSupport.tsx
// "Help & Support" — the account dropdown's last remaining Unmatched Route.
// An accurate FAQ about how TrustLink's own mechanics actually work (sealed
// bidding, verification tiers, when messaging opens), not generic filler —
// plus a real way to reach support. Same page shell as AccountProfile.tsx /
// AccountSettings.tsx (breadcrumb, hero, bordered cards).

import { useState } from 'react';
import { Linking, View, Text, ScrollView, Pressable, StyleSheet, useWindowDimensions } from 'react-native';
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

export interface HelpSupportProps {
  onBack?: () => void;
}

const SUPPORT_EMAIL = 'support@trustlink.ph';

interface FaqEntry {
  question: string;
  answer: string;
}

const FAQ: FaqEntry[] = [
  {
    question: 'How does sealed bidding work?',
    answer:
      "While a requirement is open, nobody — including the buyer who posted it — can see any quotation's price or contents. Every quotation submitted against it is released together, all at once, the moment the requirement's closing time passes. No respondent ever gets an early look at what anyone else offered.",
  },
  {
    question: 'How do I get verified, and what are trust tiers?',
    answer:
      "Complete onboarding, then upload your DTI certificate (sole proprietorship) or SEC certificate (partnership/corporation) plus your BIR certificate of registration — both are required for Tier 1. Add your Mayor's permit to reach Tier 2. Tier 3 additionally requires 10 requirements awarded to you as a supplier. Verification is reviewed manually; you'll see your status update on the Verification Status page.",
  },
  {
    question: "Why was one of my documents flagged?",
    answer:
      "A document is flagged automatically if its ID number doesn't match the expected format for that document type, if it's past its declared expiry date, or if the business or owner name on it doesn't match what's on file elsewhere in your account. A flagged document still counts as submitted — it just needs a manual review before it's approved.",
  },
  {
    question: 'When can I message another business?',
    answer:
      "1-to-1 messaging opens as soon as a quotation is released at closing time — not only once you award it. As the buyer, you can message any released respondent, not just the one you eventually choose.",
  },
  {
    question: 'Can I ask a question before a requirement closes?',
    answer:
      "Yes — while a requirement is still open, any interested business can ask the buyer a clarifying question. The buyer's answer is public: every respondent sees it, not just whoever asked, so nobody gets an information advantage.",
  },
  {
    question: "What does \"Close without award\" do?",
    answer:
      'Once quotations are released, if none of them suit you, you can close the requirement without awarding anyone. Every respondent who submitted is notified, the outcome is recorded permanently, and the requirement cannot be reopened.',
  },
  {
    question: 'Will updating my profile affect my verification?',
    answer:
      "No. Updating your business name, contact details, or capabilities from My Profile never touches your uploaded documents or re-triggers a review — it only changes those specific fields.",
  },
  {
    question: "Am I notified every time someone submits a quotation on my requirement?",
    answer:
      "No — by design. While a requirement is open, you only see a running count of sealed quotations, never who submitted or what they offered. You're notified once everything releases at closing time.",
  },
];

function SectionLabel({ children }: { children: string }) {
  return <Text style={styles.sectionLabel}>{children}</Text>;
}

function FaqRow({ entry }: { entry: FaqEntry }) {
  const [open, setOpen] = useState(false);
  return (
    <Pressable onPress={() => setOpen((v) => !v)} style={styles.faqRow}>
      <View style={styles.faqHeaderRow}>
        <Text style={styles.faqQuestion}>{entry.question}</Text>
        <Text style={styles.faqToggle}>{open ? '−' : '+'}</Text>
      </View>
      {open && <Text style={styles.faqAnswer}>{entry.answer}</Text>}
    </Pressable>
  );
}

export default function HelpSupport({ onBack }: HelpSupportProps) {
  const { width } = useWindowDimensions();
  const isWide = width >= breakpoint.desktop;

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.scrollContent}>
      <View style={isWide ? styles.pageWide : styles.page}>
        <View style={styles.breadcrumbRow}>
          <Pressable onPress={onBack} hitSlop={6}>
            <Text style={styles.breadcrumbLink}>Home</Text>
          </Pressable>
          <Text style={styles.breadcrumbSep}>/</Text>
          <Text style={styles.breadcrumbCurrent}>Help & Support</Text>
        </View>

        <View style={styles.hero}>
          <Text style={styles.heroName}>Help & Support</Text>
          <Text style={styles.mutedSmall}>How Trustlink works, and how to reach us if you're stuck.</Text>
        </View>

        <View style={styles.card}>
          <SectionLabel>Frequently asked</SectionLabel>
          <View style={{ marginTop: space.sm }}>
            {FAQ.map((entry, i) => (
              <View key={entry.question}>
                <FaqRow entry={entry} />
                {i < FAQ.length - 1 && <View style={styles.faqDivider} />}
              </View>
            ))}
          </View>
        </View>

        <View style={styles.card}>
          <SectionLabel>Contact us</SectionLabel>
          <View style={{ marginTop: space.sm, gap: space.sm }}>
            <Text style={styles.mutedSmall}>Didn't find your answer above? Email us and we'll get back to you.</Text>
            <Pressable onPress={() => Linking.openURL(`mailto:${SUPPORT_EMAIL}`)} hitSlop={6}>
              <Text style={styles.contactLink}>{SUPPORT_EMAIL}</Text>
            </Pressable>
          </View>
        </View>

        <View style={styles.footerRow}>
          <Pressable
            onPress={onBack}
            style={({ pressed }) => [styles.actionButton, { backgroundColor: pressed ? color.surfaceSunken : color.surface }]}
          >
            <Text style={styles.actionButtonLabel}>Back to home</Text>
          </Pressable>
        </View>
      </View>
    </ScrollView>
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

  faqRow: { paddingVertical: space.md },
  faqHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.md },
  faqQuestion: { flex: 1, fontFamily: font.bodySemi, fontSize: fontSize.base, color: color.ink },
  faqToggle: { fontFamily: font.bodySemi, fontSize: fontSize.lg, color: color.inkFaint, width: 20, textAlign: 'center' },
  faqAnswer: { marginTop: space.sm, fontFamily: font.body, fontSize: fontSize.sm, lineHeight: lineHeight.sm, color: color.inkMuted },
  faqDivider: { height: 1, backgroundColor: color.borderFaint },

  contactLink: { fontFamily: font.bodySemi, fontSize: fontSize.base, color: color.primary },

  footerRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, flexWrap: 'wrap', marginTop: space.sm },
  actionButton: { minHeight: layout.minTouchTarget, borderRadius: radius.pill, borderWidth: 1, borderColor: color.border, alignItems: 'center', justifyContent: 'center', paddingHorizontal: space.xl },
  actionButtonLabel: { fontFamily: font.bodySemi, fontSize: fontSize.sm, color: color.ink },
});
