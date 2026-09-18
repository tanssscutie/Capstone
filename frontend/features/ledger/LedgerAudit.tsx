// features/ledger/LedgerAudit.tsx
// "View full audit trail" — the hash-chained ledger's own dedicated screen.
// GET /requirements/{id}/ledger already existed and was only ever used to
// pull a respondent's own SUBMITTED entry inline on Requirement Detail; this
// is the first real page for the full chain. What comes back is already
// scoped server-side (requirement_service.list_ledger): the owner sees the
// whole chain once the requirement is no longer open, a respondent sees only
// entries where they were the actor, everyone else sees nothing — this page
// just renders whatever it's given, including the empty case.
import { View, Text, Pressable, StyleSheet, useWindowDimensions } from 'react-native';
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
import ScreenScroll from '../../components/ui/ScreenScroll';
import type { LedgerEntry, LedgerEntryType } from '../../lib/types';

export interface LedgerAuditProps {
  requirementTitle: string;
  requirementRef: string;
  isOwner: boolean;
  requirementOpen: boolean;
  entries: LedgerEntry[];
  onBack?: () => void;
}

function SectionLabel({ children }: { children: string }) {
  return <Text style={styles.sectionLabel}>{children}</Text>;
}

const EVENT_LABEL: Record<LedgerEntryType, string> = {
  REQUIREMENT_PUBLISHED: 'Requirement published',
  QUOTATION_SUBMITTED: 'Quotation submitted',
  QUOTATION_WITHDRAWN: 'Quotation withdrawn',
  REQUIREMENT_CLOSED: 'Quotations released',
  REQUIREMENT_CANCELLED: 'Requirement cancelled',
  AWARD_NOTICE_SENT: 'Notice of Award sent',
  AWARD_DECLINED: 'Award declined',
  AWARD_RECORDED: 'Awarded',
  CLOSED_NO_AWARD_RECORDED: 'Closed without award',
};

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function truncateHash(hash: string): string {
  if (hash.length <= 16) return hash;
  return `${hash.slice(0, 8)}…${hash.slice(-8)}`;
}

function EntryRow({ entry, isLast }: { entry: LedgerEntry; isLast: boolean }) {
  return (
    <View style={styles.entryRow}>
      <View style={styles.entryRail}>
        <View style={styles.entryDot} />
        {!isLast && <View style={styles.entryLine} />}
      </View>
      <View style={styles.entryBody}>
        <View style={styles.entryTopRow}>
          <Text style={styles.entrySeq}>#{entry.sequence}</Text>
          <Text style={styles.entryType}>{EVENT_LABEL[entry.type] ?? entry.type}</Text>
          <Text style={styles.entryTime}>{formatDateTime(entry.createdAt)}</Text>
        </View>
        <Text style={styles.mutedSmall}>{entry.actorName ?? 'System (closing clock)'}</Text>
        <View style={styles.hashRow}>
          <Text style={styles.hashLabel}>hash</Text>
          <Text style={styles.hashValue}>{truncateHash(entry.hash)}</Text>
        </View>
        {entry.previousHash && (
          <View style={styles.hashRow}>
            <Text style={styles.hashLabel}>prev</Text>
            <Text style={styles.hashValue}>{truncateHash(entry.previousHash)}</Text>
          </View>
        )}
      </View>
    </View>
  );
}

export default function LedgerAudit({
  requirementTitle,
  requirementRef,
  isOwner,
  requirementOpen,
  entries,
  onBack,
}: LedgerAuditProps) {
  const { width } = useWindowDimensions();
  const isWide = width >= breakpoint.desktop;

  let emptyMessage = "No ledger entries visible to you for this requirement.";
  if (isOwner && requirementOpen) {
    emptyMessage = "The chain stays hidden from you too while this requirement is still open — revealing who has submitted, or when, would leak sealed-bidding activity the same way an early quotations list would. Check back once it closes.";
  } else if (!isOwner) {
    emptyMessage = "You'll see an entry here once you submit a quotation on this requirement — only your own actions, never anyone else's.";
  }

  return (
    <ScreenScroll style={styles.root} contentContainerStyle={styles.scrollContent}>
      <View style={isWide ? styles.pageWide : styles.page}>
        <View style={styles.breadcrumbRow}>
          <Pressable onPress={onBack} hitSlop={6}>
            <Text style={styles.breadcrumbLink}>Home</Text>
          </Pressable>
          <Text style={styles.breadcrumbSep}>/</Text>
          <Text style={styles.breadcrumbCurrent}>Audit Trail</Text>
        </View>

        <View style={styles.hero}>
          <Text style={styles.heroName}>Audit trail</Text>
          <Text style={styles.mutedSmall}>{requirementRef} · {requirementTitle}</Text>
        </View>

        <View style={styles.card}>
          <SectionLabel>What this proves</SectionLabel>
          <Text style={[styles.mutedSmall, { marginTop: space.sm }]}>
            Every entry links to the one before it by hash — if any recorded entry were altered after the fact, its
            hash and every entry after it would no longer match. This is tamper-evident, not tamper-proof: it detects
            alteration, it doesn't prevent someone with direct database access from rewriting the whole chain.
          </Text>
        </View>

        {entries.length === 0 ? (
          <View style={styles.card}>
            <Text style={styles.mutedSmall}>{emptyMessage}</Text>
          </View>
        ) : (
          <View style={styles.card}>
            <SectionLabel>Chain</SectionLabel>
            <View style={{ marginTop: space.md }}>
              {entries.map((e, i) => (
                <EntryRow key={e.id} entry={e} isLast={i === entries.length - 1} />
              ))}
            </View>
          </View>
        )}

        <View style={styles.footerRow}>
          <Pressable onPress={onBack} style={({ pressed }) => [styles.actionButton, { backgroundColor: pressed ? color.surfaceSunken : color.surface }]}>
            <Text style={styles.actionButtonLabel}>Back</Text>
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

  entryRow: { flexDirection: 'row', gap: space.md },
  entryRail: { alignItems: 'center', width: 16 },
  entryDot: { width: 10, height: 10, borderRadius: radius.pill, backgroundColor: color.primary, marginTop: 4 },
  entryLine: { flex: 1, width: 1, backgroundColor: color.border, marginTop: 2, marginBottom: 2 },
  entryBody: { flex: 1, paddingBottom: space.lg, gap: 2 },
  entryTopRow: { flexDirection: 'row', alignItems: 'baseline', gap: space.sm, flexWrap: 'wrap' },
  entrySeq: { fontFamily: font.mono, fontSize: fontSize.micro, color: color.inkFaint },
  entryType: { fontFamily: font.bodySemi, fontSize: fontSize.base, color: color.ink },
  entryTime: { fontFamily: font.body, fontSize: fontSize.sm, color: color.inkFaint, marginLeft: 'auto' },

  hashRow: { flexDirection: 'row', gap: space.sm, marginTop: 2 },
  hashLabel: { fontFamily: font.mono, fontSize: fontSize.micro, color: color.inkFaint, width: 30 },
  hashValue: { fontFamily: font.mono, fontSize: fontSize.micro, color: color.inkMuted },

  footerRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, flexWrap: 'wrap', marginTop: space.sm },
  actionButton: { minHeight: layout.minTouchTarget, borderRadius: radius.pill, borderWidth: 1, borderColor: color.border, alignItems: 'center', justifyContent: 'center', paddingHorizontal: space.xl },
  actionButtonLabel: { fontFamily: font.bodySemi, fontSize: fontSize.sm, color: color.ink },
});
