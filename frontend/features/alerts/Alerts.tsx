// features/alerts/Alerts.tsx
// Every alert delivered to the viewer — closing-soon reminders, award decisions,
// verification updates, new messages, and clarification Q&A activity (see
// AlertType, lib/types). Deliberately nothing for an individual quotation
// submission — the buyer is never notified of one, only the running count they
// can pull from the requirement itself.
// Same page shell as MyQuotations.tsx / MyRequirements.tsx (breadcrumb, display
// title, bordered rows) — a plain reverse-chronological list, since alerts have
// no natural grouping the way quotations/requirements group by status.

import { useState } from 'react';
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
  }
}

/* ─── Row ───────────────────────────────────────────── */

function AlertRow({ alert, onPress }: { alert: Alert; onPress?: () => void }) {
  const dotColor = !alert.read ? (alert.urgent ? color.danger : color.primary) : color.inkFaint;
  return (
    <Pressable onPress={onPress} style={[styles.row, !alert.read ? styles.rowUnread : null]}>
      <View style={[styles.dot, { backgroundColor: dotColor }]} />
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <View style={styles.rowTopLine}>
          <Text style={styles.rowTypeLabel}>{alertTypeLabel(alert.type)}</Text>
          <Text style={styles.rowTime}>{timeAgoWords(alert.createdAt)}</Text>
        </View>
        <Text style={[styles.rowTitle, !alert.read ? styles.rowTitleUnread : null]}>{alert.title}</Text>
        <Text style={styles.rowDetail}>{alert.detail}</Text>
      </View>
    </Pressable>
  );
}

/* ─── Root component ────────────────────────────────── */

export default function Alerts(props: AlertsProps) {
  const { alerts, onBack, onMarkRead, onMarkAllRead } = props;
  const { width } = useWindowDimensions();
  const isWide = width >= breakpoint.desktop;
  const unreadCount = alerts.filter((a) => !a.read).length;

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
            <Pressable onPress={onMarkAllRead} hitSlop={6}>
              <Text style={styles.markAllLink}>Mark all as read</Text>
            </Pressable>
          )}
        </View>

        {alerts.length === 0 ? (
          <View style={styles.emptyCard}>
            <Text style={styles.mutedSmall}>Nothing here yet.</Text>
          </View>
        ) : (
          <View style={{ marginTop: space.lg }}>
            {alerts.map((a) => (
              <AlertRow key={a.id} alert={a} onPress={a.read ? undefined : () => onMarkRead?.(a.id)} />
            ))}
          </View>
        )}
      </View>
    </ScreenScroll>
  );
}

/* ─── Styles ─────────────────────────────────────────── */

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: color.canvas },
  scrollContent: { alignItems: 'center', paddingVertical: space.lg, paddingBottom: space.xxl },

  page: { width: '100%', maxWidth: layout.maxWidth, paddingHorizontal: layout.screenPadding },
  pageWide: { width: '100%', maxWidth: layout.maxWidthWide, paddingHorizontal: layout.screenPadding },

  breadcrumbRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, flexWrap: 'wrap' },
  breadcrumbLink: { fontFamily: font.body, fontSize: fontSize.sm, color: color.inkFaint },
  breadcrumbSep: { fontFamily: font.body, fontSize: fontSize.sm, color: color.inkFaint },
  breadcrumbCurrent: { fontFamily: font.body, fontSize: fontSize.sm, color: color.inkMuted },

  titleRow: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: space.lg, flexWrap: 'wrap', marginTop: space.md },
  pageTitle: { fontFamily: font.display, fontSize: fontSize.display, lineHeight: lineHeight.display, letterSpacing: letterSpacing.tight, color: color.ink },
  pageSubtitle: { fontFamily: font.body, fontSize: fontSize.sm, color: color.inkMuted },
  markAllLink: { fontFamily: font.bodyMedium, fontSize: fontSize.sm, color: color.primary },

  mutedSmall: { fontFamily: font.body, fontSize: fontSize.sm, lineHeight: lineHeight.sm, color: color.inkMuted },
  emptyCard: { marginTop: space.lg, borderWidth: 1, borderColor: color.borderFaint, borderRadius: radius.xl, padding: space.xl, alignItems: 'center' },

  row: { flexDirection: 'row', gap: space.md, padding: space.md, borderRadius: radius.lg, borderBottomWidth: 1, borderBottomColor: color.borderFaint },
  rowUnread: { backgroundColor: color.primaryFaint, borderBottomColor: 'transparent' },
  dot: { width: 7, height: 7, borderRadius: radius.pill, marginTop: 6 },
  rowTopLine: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.sm },
  rowTypeLabel: { fontFamily: font.mono, fontSize: fontSize.micro, letterSpacing: letterSpacing.label, textTransform: 'uppercase', color: color.inkFaint },
  rowTime: { fontFamily: font.body, fontSize: fontSize.sm, color: color.inkFaint },
  rowTitle: { fontFamily: font.bodyMedium, fontSize: fontSize.base, color: color.ink },
  rowTitleUnread: { fontFamily: font.bodySemi },
  rowDetail: { fontFamily: font.body, fontSize: fontSize.sm, lineHeight: lineHeight.sm, color: color.inkMuted },
});
