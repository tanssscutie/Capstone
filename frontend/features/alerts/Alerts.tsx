// features/alerts/Alerts.tsx
// Every alert delivered to the viewer — closing-soon reminders, award decisions,
// verification updates, new messages, and clarification Q&A activity (see
// AlertType, lib/types). Deliberately nothing for an individual quotation
// submission — the buyer is never notified of one, only the running count they
// can pull from the requirement itself.
// Same page shell as MyQuotations.tsx / MyRequirements.tsx (breadcrumb, display
// title), on the sunken page with white cards like HomeFeed.tsx. Alerts are
// grouped by day (Today / Yesterday / Earlier), newest first, with an
// All / Unread filter.

import { useState } from 'react';
import { View, Text, Pressable, StyleSheet, Platform, useWindowDimensions } from 'react-native';
import type { ViewStyle } from 'react-native';
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
import type { Alert, AlertType, ISODateTime } from '../../lib/types';

/* ─── Props ─────────────────────────────────────────── */

export interface AlertsProps {
  alerts: Alert[];
  onBack?: () => void;
  onMarkRead?: (alertId: string) => void;
  onMarkAllRead?: () => void;
}

/* ─── Formatting helpers ────────────────────────────── */

function timeAgoWords(iso: ISODateTime): string {
  const min = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  const h = Math.round(min / 60);
  if (h < 24) return h === 1 ? '1 hour ago' : `${h} hours ago`;
  const d = Math.round(h / 24);
  return d === 1 ? '1 day ago' : `${d} days ago`;
}

function pluralUnit(n: number, w: string): string {
  return `${n} ${w}${n === 1 ? '' : 's'}`;
}

function alertTypeLabel(type: AlertType): string {
  switch (type) {
    case 'REQUIREMENT_CLOSING': return 'Closing';
    case 'REQUIREMENT_RELEASED': return 'Released';
    case 'REQUIREMENT_CANCELLED': return 'Cancelled';
    case 'DECISION': return 'Decision';
    case 'CLOSED_NO_AWARD': return 'Closed';
    case 'VERIFICATION': return 'Verification';
    case 'TIER_UPGRADE': return 'Tier';
    case 'DOCUMENT_FLAGGED': return 'Document';
    case 'MESSAGE_RECEIVED': return 'Message';
    case 'QUESTION_ASKED': return 'Question';
    case 'QUESTION_ANSWERED': return 'Answer';
    case 'REQUIREMENT_MATCH': return 'New match';
  }
}

type Tone = 'primary' | 'danger' | 'neutral';

/** Red for what went wrong or is about to, blue for progress, grey for plain endings. */
function alertTone(alert: Alert): Tone {
  if (alert.urgent) return 'danger';
  switch (alert.type) {
    case 'REQUIREMENT_CANCELLED':
    case 'DOCUMENT_FLAGGED':
      return 'danger';
    case 'CLOSED_NO_AWARD':
      return 'neutral';
    default:
      return 'primary';
  }
}

const TONE_STYLES: Record<Tone, { bg: string; border: string; fg: string }> = {
  primary: { bg: color.primaryFaint, border: color.primaryBorder, fg: color.primary },
  danger: { bg: color.dangerFaint, border: color.dangerBorder, fg: color.danger },
  neutral: { bg: color.surfaceSunken, border: color.border, fg: color.inkMuted },
};

/** Today / Yesterday / Earlier, by the device's calendar day. */
function dayGroup(iso: ISODateTime): 'Today' | 'Yesterday' | 'Earlier' {
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const t = new Date(iso).getTime();
  if (t >= startOfToday.getTime()) return 'Today';
  if (t >= startOfToday.getTime() - 86_400_000) return 'Yesterday';
  return 'Earlier';
}

const GROUP_ORDER = ['Today', 'Yesterday', 'Earlier'] as const;

/* ─── Web-only motion helpers (same as HomeFeed.tsx) ── */

function webTransition(properties: string): ViewStyle {
  return Platform.OS === 'web'
    ? ({ transitionProperty: properties, transitionDuration: '160ms', transitionTimingFunction: 'ease-out' } as unknown as ViewStyle)
    : {};
}

function useHover() {
  const [hovered, setHovered] = useState(false);
  const handlers =
    Platform.OS === 'web' ? { onHoverIn: () => setHovered(true), onHoverOut: () => setHovered(false) } : {};
  return [hovered, handlers] as const;
}

/* ─── Row ───────────────────────────────────────────── */

function AlertRow({ alert, last, onPress }: { alert: Alert; last: boolean; onPress?: () => void }) {
  const [hovered, hoverHandlers] = useHover();
  const unread = !alert.read;
  const tone = TONE_STYLES[alertTone(alert)];
  return (
    <Pressable
      {...hoverHandlers}
      onPress={onPress}
      disabled={!onPress}
      accessibilityHint={unread ? 'Marks this alert as read' : undefined}
      style={[
        styles.row,
        webTransition('background-color'),
        unread && styles.rowUnread,
        hovered && unread && styles.rowHovered,
        !last && styles.rowDivider,
      ]}
    >
      {/* Accent bar on the left edge — only while unread. */}
      <View style={[styles.rowAccent, { backgroundColor: unread ? tone.fg : 'transparent' }]} />
      <View style={{ flex: 1, minWidth: 0, gap: space.xs }}>
        <View style={styles.rowTopLine}>
          <View style={[styles.typeTag, { backgroundColor: tone.bg, borderColor: tone.border }]}>
            <Text style={[styles.typeTagLabel, { color: tone.fg }]}>{alertTypeLabel(alert.type)}</Text>
          </View>
          <View style={{ flex: 1 }} />
          <Text style={styles.rowTime}>{timeAgoWords(alert.createdAt)}</Text>
          {unread && <View style={[styles.unreadDot, { backgroundColor: tone.fg }]} />}
        </View>
        <Text style={[styles.rowTitle, unread && styles.rowTitleUnread]}>{alert.title}</Text>
        {!!alert.detail && <Text style={styles.rowDetail}>{alert.detail}</Text>}
        {unread && hovered && <Text style={styles.markReadHint}>Click to mark as read</Text>}
      </View>
    </Pressable>
  );
}

/* ─── Filter tabs ───────────────────────────────────── */

type Filter = 'ALL' | 'UNREAD';

function FilterTab({ label, count, active, onPress }: { label: string; count: number; active: boolean; onPress: () => void }) {
  const [hovered, hoverHandlers] = useHover();
  return (
    <Pressable
      {...hoverHandlers}
      onPress={onPress}
      accessibilityRole="tab"
      accessibilityState={{ selected: active }}
      style={[styles.tab, webTransition('background-color, border-color'), hovered && !active && styles.tabHovered, active && styles.tabActive]}
    >
      <Text style={[styles.tabLabel, active && styles.tabLabelActive]}>{label}</Text>
      <View style={[styles.tabCount, active && styles.tabCountActive]}>
        <Text style={[styles.tabCountLabel, active && styles.tabCountLabelActive]}>{count}</Text>
      </View>
    </Pressable>
  );
}

/* ─── Root component ────────────────────────────────── */

export default function Alerts(props: AlertsProps) {
  const { alerts, onBack, onMarkRead, onMarkAllRead } = props;
  const { width } = useWindowDimensions();
  const isWide = width >= breakpoint.desktop;
  const [filter, setFilter] = useState<Filter>('ALL');
  const unreadCount = alerts.filter((a) => !a.read).length;

  const shown = filter === 'UNREAD' ? alerts.filter((a) => !a.read) : alerts;
  const groups = GROUP_ORDER
    .map((name) => ({ name, items: shown.filter((a) => dayGroup(a.createdAt) === name) }))
    .filter((g) => g.items.length > 0);

  return (
    <ScreenScroll style={styles.root} contentContainerStyle={styles.scrollContent}>
      <View style={isWide ? styles.pageWide : styles.page}>
        <View style={styles.breadcrumbRow}>
          <Pressable onPress={onBack} hitSlop={6}>
            <Text style={styles.breadcrumbLink}>Home</Text>
          </Pressable>
          <Text style={styles.breadcrumbSep}>/</Text>
          <Text style={styles.breadcrumbCurrent}>Alerts</Text>
        </View>

        <View style={styles.titleRow}>
          <View style={{ gap: space.xs, flexShrink: 1 }}>
            <Text style={styles.pageTitle}>Alerts</Text>
            <Text style={styles.pageSubtitle}>
              {unreadCount > 0 ? `${pluralUnit(unreadCount, 'unread alert')} of ${alerts.length}` : `${pluralUnit(alerts.length, 'alert')}, all read`}
            </Text>
          </View>
          {unreadCount > 0 && (
            <Pressable onPress={onMarkAllRead} hitSlop={6} style={styles.markAllButton}>
              <Text style={styles.markAllLink}>Mark all as read</Text>
            </Pressable>
          )}
        </View>

        {alerts.length > 0 && (
          <View style={styles.tabRow} accessibilityRole="tablist">
            <FilterTab label="All" count={alerts.length} active={filter === 'ALL'} onPress={() => setFilter('ALL')} />
            <FilterTab label="Unread" count={unreadCount} active={filter === 'UNREAD'} onPress={() => setFilter('UNREAD')} />
          </View>
        )}

        {groups.length === 0 ? (
          <View style={styles.emptyCard}>
            <View style={styles.emptyMark}>
              <View style={styles.emptyCheck} />
            </View>
            <Text style={styles.emptyTitle}>{alerts.length === 0 ? 'No alerts yet' : "You're all caught up"}</Text>
            <Text style={[styles.mutedSmall, { textAlign: 'center' }]}>
              {alerts.length === 0
                ? 'Closing reminders, award decisions, messages and verification updates will show up here.'
                : 'No unread alerts. Switch to All to see earlier ones.'}
            </Text>
          </View>
        ) : (
          <View style={{ gap: space.xl, marginTop: space.lg }}>
            {groups.map((g) => (
              <View key={g.name} style={{ gap: space.sm }}>
                <Text style={styles.groupLabel}>{g.name}</Text>
                <View style={styles.groupCard}>
                  {g.items.map((a, i) => (
                    <AlertRow
                      key={a.id}
                      alert={a}
                      last={i === g.items.length - 1}
                      onPress={a.read ? undefined : () => onMarkRead?.(a.id)}
                    />
                  ))}
                </View>
              </View>
            ))}
          </View>
        )}
      </View>
    </ScreenScroll>
  );
}

/* ─── Styles ─────────────────────────────────────────── */

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: color.surfaceSunken },
  scrollContent: { alignItems: 'center', paddingVertical: space.lg, paddingBottom: space.xxl },

  page: { width: '100%', maxWidth: layout.maxWidth, paddingHorizontal: layout.screenPadding },
  pageWide: { width: '100%', maxWidth: 820, paddingHorizontal: layout.screenPadding },

  breadcrumbRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, flexWrap: 'wrap' },
  breadcrumbLink: { fontFamily: font.body, fontSize: fontSize.sm, color: color.inkFaint },
  breadcrumbSep: { fontFamily: font.body, fontSize: fontSize.sm, color: color.inkFaint },
  breadcrumbCurrent: { fontFamily: font.body, fontSize: fontSize.sm, color: color.inkMuted },

  titleRow: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: space.lg, flexWrap: 'wrap', marginTop: space.md },
  pageTitle: { fontFamily: font.display, fontSize: fontSize.display, lineHeight: lineHeight.display, letterSpacing: letterSpacing.tight, color: color.ink },
  pageSubtitle: { fontFamily: font.body, fontSize: fontSize.sm, color: color.inkMuted },
  markAllButton: { borderWidth: 1, borderColor: color.primaryBorder, backgroundColor: color.surface, borderRadius: radius.pill, paddingHorizontal: space.lg, paddingVertical: space.sm },
  markAllLink: { fontFamily: font.bodyMedium, fontSize: fontSize.sm, color: color.primary },

  tabRow: { flexDirection: 'row', gap: space.sm, marginTop: space.lg },
  tab: { flexDirection: 'row', alignItems: 'center', gap: space.sm, borderWidth: 1, borderColor: color.border, backgroundColor: color.surface, borderRadius: radius.pill, paddingHorizontal: space.lg, paddingVertical: space.sm },
  tabHovered: { borderColor: color.borderStrong },
  tabActive: { backgroundColor: color.ink, borderColor: color.ink },
  tabLabel: { fontFamily: font.bodyMedium, fontSize: fontSize.sm, color: color.inkMuted },
  tabLabelActive: { color: color.canvas },
  tabCount: { minWidth: 20, alignItems: 'center', borderRadius: radius.pill, backgroundColor: color.surfaceSunken, paddingHorizontal: 6, paddingVertical: 1 },
  tabCountActive: { backgroundColor: 'rgba(255, 255, 255, 0.16)' },
  tabCountLabel: { fontFamily: font.mono, fontSize: fontSize.micro, color: color.inkMuted },
  tabCountLabelActive: { color: color.canvas },

  groupLabel: { fontFamily: font.mono, fontSize: fontSize.micro, letterSpacing: letterSpacing.label, textTransform: 'uppercase', color: color.inkFaint, paddingHorizontal: space.xs },
  groupCard: { ...elevation.card, backgroundColor: color.surface, borderRadius: radius.xl, overflow: 'hidden' },

  mutedSmall: { fontFamily: font.body, fontSize: fontSize.sm, lineHeight: lineHeight.sm, color: color.inkMuted },
  emptyCard: { ...elevation.card, marginTop: space.lg, backgroundColor: color.surface, borderRadius: radius.xl, padding: space.xxl, alignItems: 'center', gap: space.sm },
  emptyMark: { width: 44, height: 44, borderRadius: radius.pill, backgroundColor: color.primaryFaint, alignItems: 'center', justifyContent: 'center', marginBottom: space.xs },
  // A check mark from two borders of a rotated box — no icon library in this project.
  emptyCheck: { width: 10, height: 18, borderRightWidth: 2.5, borderBottomWidth: 2.5, borderColor: color.primary, transform: [{ rotate: '45deg' }], marginTop: -4 },
  emptyTitle: { fontFamily: font.display, fontSize: fontSize.md, color: color.ink },

  row: { flexDirection: 'row', gap: space.md, paddingVertical: space.lg, paddingRight: space.lg },
  rowDivider: { borderBottomWidth: 1, borderBottomColor: color.borderFaint },
  rowUnread: { backgroundColor: color.canvas },
  rowHovered: { backgroundColor: color.primaryFaint },
  rowAccent: { width: 3, alignSelf: 'stretch', borderTopRightRadius: 2, borderBottomRightRadius: 2 },
  rowTopLine: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  typeTag: { borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: space.sm, paddingVertical: 2 },
  typeTagLabel: { fontFamily: font.mono, fontSize: fontSize.micro, letterSpacing: letterSpacing.label, textTransform: 'uppercase' },
  rowTime: { fontFamily: font.body, fontSize: fontSize.sm, color: color.inkFaint },
  unreadDot: { width: 8, height: 8, borderRadius: radius.pill },
  rowTitle: { fontFamily: font.bodyMedium, fontSize: fontSize.base, lineHeight: lineHeight.base, color: color.inkMuted },
  rowTitleUnread: { fontFamily: font.bodySemi, color: color.ink },
  rowDetail: { fontFamily: font.body, fontSize: fontSize.sm, lineHeight: lineHeight.sm, color: color.inkMuted },
  markReadHint: { fontFamily: font.body, fontSize: fontSize.micro, color: color.primary },
});
