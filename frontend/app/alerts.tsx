// app/alerts.tsx
import { useCallback, useEffect, useState } from 'react';
import { View, Text, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import Alerts from '../features/alerts/Alerts';
import { notificationsApi } from '../lib/api/notifications';
import { mapNotification } from '../lib/api/mappers';
import type { Alert } from '../lib/types';
import { color, font, fontSize, space } from '../components/ui/tokens';

export default function AlertsRoute() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [alerts, setAlerts] = useState<Alert[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const rows = await notificationsApi.listMine();
      setAlerts(rows.map(mapNotification));
    } catch (e: any) {
      setError(typeof e?.detail === 'string' ? e.detail : e?.message ?? 'Failed to load your alerts.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: color.canvas, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={color.primary} />
      </View>
    );
  }

  if (error) {
    return (
      <View style={{ flex: 1, backgroundColor: color.canvas, alignItems: 'center', justifyContent: 'center', padding: space.xl }}>
        <Text style={{ fontFamily: font.body, fontSize: fontSize.base, color: color.danger, textAlign: 'center' }}>{error}</Text>
      </View>
    );
  }

  return (
    <Alerts
      alerts={alerts}
      onBack={() => router.push('/home')}
      onMarkRead={async (alertId) => {
        setAlerts((prev) => prev.map((a) => (a.id === alertId ? { ...a, read: true } : a)));
        try {
          await notificationsApi.markRead(Number(alertId));
        } catch {
          setAlerts((prev) => prev.map((a) => (a.id === alertId ? { ...a, read: false } : a)));
        }
      }}
      onMarkAllRead={async () => {
        const previouslyUnread = alerts.filter((a) => !a.read).map((a) => a.id);
        setAlerts((prev) => prev.map((a) => ({ ...a, read: true })));
        try {
          await notificationsApi.markAllRead();
        } catch {
          setAlerts((prev) => prev.map((a) => (previouslyUnread.includes(a.id) ? { ...a, read: false } : a)));
        }
      }}
    />
  );
}
