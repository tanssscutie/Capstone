// app/business-profile.tsx
// "View buyer profile" / "View profile" from Requirement Detail — previously
// dead buttons (onPress={() => {}}). Reads ?id= for whichever business to show.
import { useCallback, useEffect, useState } from 'react';
import { View, Text, ActivityIndicator } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import BusinessProfile from '../features/business-profile/BusinessProfile';
import { getPublicProfile } from '../lib/api/business';
import { mapPublicBusinessProfile, type PublicBusinessProfile } from '../lib/api/mappers';
import { color, font, fontSize, space } from '../components/ui/tokens';
import { errorMessage } from '../lib/api/client';

export default function BusinessProfileRoute() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [profile, setProfile] = useState<PublicBusinessProfile | null>(null);

  const load = useCallback(async () => {
    if (!id) {
      setError('No business specified.');
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const raw = await getPublicProfile(Number(id));
      setProfile(mapPublicBusinessProfile(raw));
    } catch (e: any) {
      setError(errorMessage(e, 'Could not load this business profile.'));
    } finally {
      setLoading(false);
    }
  }, [id]);

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

  if (error || !profile) {
    return (
      <View style={{ flex: 1, backgroundColor: color.canvas, alignItems: 'center', justifyContent: 'center', padding: space.xl }}>
        <Text style={{ fontFamily: font.body, fontSize: fontSize.base, color: color.danger, textAlign: 'center' }}>
          {error ?? 'Could not load this business profile.'}
        </Text>
      </View>
    );
  }

  return <BusinessProfile profile={profile} onBack={() => router.back()} />;
}
