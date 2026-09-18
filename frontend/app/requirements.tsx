// app/requirements.tsx
// "My requirements" — every requirement this business has posted, grouped by state.
// This is what HomeFeed.tsx's "Manage all" link (next to "Your requirements") now
// points to, instead of being a no-op.
import { useCallback, useState } from 'react';
import { View, Text, ActivityIndicator } from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import MyRequirements from '../features/my-requirements/MyRequirements';
import { me } from '../lib/api/auth';
import { requirementsApi } from '../lib/api/requirements';
import { mapMyRequirement } from '../lib/api/mappers';
import type { Requirement } from '../lib/types';
import { color, font, fontSize, space } from '../components/ui/tokens';
import { errorMessage } from '../lib/api/client';

export default function MyRequirementsRoute() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [requirements, setRequirements] = useState<Requirement[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [user, rows] = await Promise.all([me(), requirementsApi.listMine()]);
      const ownerId = String(user.id);
      setRequirements(rows.map((r) => mapMyRequirement(r, ownerId)));
    } catch (e: any) {
      setError(errorMessage(e, 'Failed to load your requirements.'));
    } finally {
      setLoading(false);
    }
  }, []);

  // useFocusEffect fires on initial mount too (no separate plain useEffect
  // needed), then again every time this screen regains focus — e.g. back from
  // Post a Requirement right after publishing — so a management list never
  // shows stale data. Worth the brief re-show of the spinner each time.
  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

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
    <MyRequirements
      requirements={requirements}
      onBack={() => router.push('/home')}
      onOpenRequirement={(requirementId) => router.push({ pathname: '/requirement', params: { id: requirementId } })}
      onPostRequirement={() => router.push('/post-requirement')}
    />
  );
}
