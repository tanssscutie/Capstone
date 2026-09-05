// app/settings.tsx
// "Account Settings" — the account dropdown previously pointed here with no
// route file behind it (Unmatched Route).
import { useCallback, useEffect, useState } from 'react';
import { View, ActivityIndicator, Text } from 'react-native';
import { useRouter } from 'expo-router';
import AccountSettings from '../features/settings/AccountSettings';
import { me, changeMobileNumber, changePassword, updateNotificationPreferences, type BackendUser } from '../lib/api/auth';
import { color, font, fontSize, space } from '../components/ui/tokens';

export default function SettingsRoute() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [user, setUser] = useState<BackendUser | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setUser(await me());
    } catch (e: any) {
      setError(typeof e?.detail === 'string' ? e.detail : e?.message ?? 'Could not load your account settings.');
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

  if (error || !user) {
    return (
      <View style={{ flex: 1, backgroundColor: color.canvas, alignItems: 'center', justifyContent: 'center', padding: space.xl }}>
        <Text style={{ fontFamily: font.body, fontSize: fontSize.base, color: color.danger, textAlign: 'center' }}>
          {error ?? 'Could not load your account settings.'}
        </Text>
      </View>
    );
  }

  return (
    <AccountSettings
      mobileNumber={user.mobile_number}
      notifyMessages={user.notify_messages}
      notifyActivity={user.notify_activity}
      onBack={() => router.push('/home')}
      onChangeMobileNumber={async (newNumber, currentPassword) => {
        const updated = await changeMobileNumber(newNumber, currentPassword);
        setUser(updated);
      }}
      onChangePassword={async (currentPassword, newPassword) => {
        await changePassword(currentPassword, newPassword);
      }}
      onChangeNotificationPreferences={async (notifyMessages, notifyActivity) => {
        const updated = await updateNotificationPreferences(notifyMessages, notifyActivity);
        setUser(updated);
      }}
    />
  );
}
