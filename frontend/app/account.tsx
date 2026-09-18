// app/account.tsx
// "My Profile" — reached from the header's account dropdown, which previously
// pointed at this exact path with no route file behind it (Unmatched Route).
import { useCallback, useEffect, useState } from 'react';
import { View, Text, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import AccountProfile from '../features/account/AccountProfile';
import { me } from '../lib/api/auth';
import { getVerificationStatus, getDashboardStats } from '../lib/api/business';
import { mapViewerBusiness } from '../lib/api/mappers';
import type { Business } from '../lib/types';
import { color, font, fontSize, space } from '../components/ui/tokens';
import { errorMessage } from '../lib/api/client';

export default function AccountRoute() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [viewer, setViewer] = useState<Business | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [user, verification, stats] = await Promise.all([me(), getVerificationStatus(), getDashboardStats()]);
      setViewer(mapViewerBusiness(user, verification, stats));
    } catch (e: any) {
      setError(errorMessage(e, 'Could not load your profile.'));
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

  if (error || !viewer) {
    return (
      <View style={{ flex: 1, backgroundColor: color.canvas, alignItems: 'center', justifyContent: 'center', padding: space.xl }}>
        <Text style={{ fontFamily: font.body, fontSize: fontSize.base, color: color.danger, textAlign: 'center' }}>
          {error ?? 'Could not load your profile.'}
        </Text>
      </View>
    );
  }

  return (
    <AccountProfile
      viewer={viewer}
      onBack={() => router.push('/home')}
      onEditProfile={() => router.push('/onboarding?mode=edit')}
    />
  );
}
