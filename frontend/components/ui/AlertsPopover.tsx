// components/ui/AlertsPopover.tsx
// Small alerts panel anchored under the header's bell — the latest alerts at a
// glance, without leaving the page. "See all alerts" is the only way to the
// full /alerts screen. Same no-portal approach as AccountDropdown: a
// full-screen Pressable backdrop catches the outside tap, and the panel is
// positioned absolutely under the bell (anchorTop / anchorRight).

import { useEffect, useState } from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet, Platform, ActivityIndicator, useWindowDimensions, type ViewStyle } from 'react-native';
import { useRouter } from 'expo-router';
import { color, font, fontSize, lineHeight, space, radius } from './tokens';
import { notificationsApi } from '../../lib/api/notifications';
import { mapNotification } from '../../lib/api/mappers';
import type { Alert } from '../../lib/types';

const MAX_SHOWN = 8;

export interface AlertsPopoverProps {
  onDismiss: () => void;
  anchorTop: number;
  anchorRight: number;
  /** Fired with the new unread count whenever this panel reads or marks alerts,
   *  so the bell's badge stays in step. */
  onUnreadCountChange?: (count: number) => void;
}

function timeAgo(iso: string): string {
  const min = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (min < 1) return 'now';
  if (min < 60) return `${min}m`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h}h`;
  const d = Math.round(h / 24);
  return d < 7 ? `${d}d` : new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export default function AlertsPopover({ onDismiss, anchorTop, anchorRight, onUnreadCountChange }: AlertsPopoverProps) {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const [alerts, setAlerts] = useState<Alert[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    notificationsApi
      .listMine()
      .then((rows) => {
        if (cancelled) return;
        const mapped = rows.map(mapNotification);
        setAlerts(mapped);
        onUnreadCountChange?.(mapped.filter((a) => !a.read).length);
      })
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const unread = alerts?.filter((a) => !a.read).length ?? 0;

  const markAllRead = async () => {
    if (!alerts) return;
    setAlerts(alerts.map((a) => ({ ...a, read: true })));
    onUnreadCountChange?.(0);
    try {
      await notificationsApi.markAllRead();
    } catch {
      setAlerts(alerts);
      onUnreadCountChange?.(unread);
    }
  };

  const openAlert = (alert: Alert) => {
    if (!alert.read && alerts) {
      setAlerts(alerts.map((a) => (a.id === alert.id ? { ...a, read: true } : a)));
      onUnreadCountChange?.(Math.max(0, unread - 1));
      notificationsApi.markRead(Number(alert.id)).catch(() => {});
    }
    onDismiss();
    if (alert.relatedRequirementId) {
      router.push({ pathname: '/requirement', params: { id: alert.relatedRequirementId } });
    } else {
      router.push('/alerts');
    }
  };

  const seeAll = () => {
    onDismiss();
    router.push('/alerts');
  };

  // Full width minus gutters on a phone; a fixed card on anything wider.
  const panelWidth = Math.min(380, width - space.lg * 2);
  const panelStyle: ViewStyle = {
    position: 'absolute',
    top: anchorTop + 6,
    right: Math.min(anchorRight, Math.max(space.lg, width - panelWidth - space.lg)),
    width: panelWidth,
  };

  const shown = alerts?.slice(0, MAX_SHOWN) ?? [];

  return (
    <>
      <Pressable style={StyleSheet.absoluteFill} onPress={onDismiss} accessibilityLabel="Close alerts" />
      <View style={panelStyle} pointerEvents="box-none">
        <View style={styles.panel}>
          <View style={styles.headerRow}>
            <Text style={styles.title}>Alerts</Text>
            {unread > 0 && <Text style={styles.unreadCount}>{unread} new</Text>}
            <View style={{ flex: 1 }} />
            {unread > 0 && (
              <Pressable onPress={markAllRead} hitSlop={6}>
                <Text style={styles.link}>Mark all as read</Text>
              </Pressable>
            )}
          </View>

          {alerts === null && !failed ? (
            <View style={styles.state}><ActivityIndicator color={color.primary} /></View>
          ) : failed ? (
            <View style={styles.state}><Text style={styles.muted}>Couldn't load alerts.</Text></View>
          ) : shown.length === 0 ? (
            <View style={styles.state}><Text style={styles.muted}>You're all caught up.</Text></View>
          ) : (
            <ScrollView style={styles.list}>
              {shown.map((a) => (
                <Pressable
                  key={a.id}
                  onPress={() => openAlert(a)}
                  style={({ pressed }) => [styles.row, !a.read ? styles.rowUnread : null, pressed ? styles.rowPressed : null]}
                >
                  <View style={[styles.dot, { backgroundColor: a.read ? 'transparent' : a.urgent ? color.danger : color.primary }]} />
                  <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                    <View style={styles.rowTop}>
                      <Text style={[styles.rowTitle, !a.read ? styles.rowTitleUnread : null]} numberOfLines={1}>{a.title}</Text>
                      <Text style={styles.time}>{timeAgo(a.createdAt)}</Text>
                    </View>
                    <Text style={styles.detail} numberOfLines={2}>{a.detail}</Text>
                  </View>
                </Pressable>
              ))}
            </ScrollView>
          )}

          <Pressable onPress={seeAll} style={({ pressed }) => [styles.footer, pressed ? styles.rowPressed : null]}>
            <Text style={styles.footerLabel}>See all alerts</Text>
          </Pressable>
        </View>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  panel: {
    backgroundColor: color.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: color.border,
    overflow: 'hidden',
    ...Platform.select({
      web: { boxShadow: '0 8px 24px rgba(15,15,14,0.12), 0 2px 4px rgba(15,15,14,0.06)' },
      default: { elevation: 12 },
    }),
  },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingHorizontal: space.lg, paddingVertical: space.md, borderBottomWidth: 1, borderBottomColor: color.border },
  title: { fontFamily: font.bodySemi, fontSize: fontSize.base, color: color.ink },
  unreadCount: { fontFamily: font.mono, fontSize: 10, color: color.primary, textTransform: 'uppercase' },
  link: { fontFamily: font.bodyMedium, fontSize: fontSize.sm, color: color.primary },
  state: { paddingVertical: space.xl, alignItems: 'center' },
  muted: { fontFamily: font.body, fontSize: fontSize.sm, color: color.inkMuted },
  list: { maxHeight: 420 },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: space.sm, paddingHorizontal: space.lg, paddingVertical: space.md, borderBottomWidth: 1, borderBottomColor: color.borderFaint },
  rowUnread: { backgroundColor: color.primaryFaint },
  rowPressed: { backgroundColor: color.surfaceSunken },
  dot: { width: 7, height: 7, borderRadius: radius.pill, marginTop: 6 },
  rowTop: { flexDirection: 'row', alignItems: 'baseline', gap: space.sm },
  rowTitle: { flex: 1, fontFamily: font.body, fontSize: fontSize.sm, color: color.ink },
  rowTitleUnread: { fontFamily: font.bodySemi },
  time: { fontFamily: font.mono, fontSize: 10, color: color.inkFaint },
  detail: { fontFamily: font.body, fontSize: fontSize.sm, lineHeight: lineHeight.sm, color: color.inkMuted },
  footer: { paddingVertical: space.md, alignItems: 'center' },
  footerLabel: { fontFamily: font.bodySemi, fontSize: fontSize.sm, color: color.primary },
});
