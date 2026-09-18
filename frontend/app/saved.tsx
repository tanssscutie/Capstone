// app/saved.tsx
// Requirements the viewer bookmarked from the feed. GET /requirements/saved already
// returns each one with its poster embedded, so the buyer map is built the same way
// app/home.tsx builds requirementBuyers for the open-requirements feed.
import { useCallback, useEffect, useState } from 'react';
import { View, Text, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import Saved from '../features/saved/Saved';
import { requirementsApi } from '../lib/api/requirements';
import { mapRequirement, mapPosterToFeedBuyer } from '../lib/api/mappers';
import type { Requirement, BusinessId } from '../lib/types';
import { color, font, fontSize, space } from '../components/ui/tokens';
import { errorMessage } from '../lib/api/client';

export default function SavedRoute() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [requirements, setRequirements] = useState<Requirement[]>([]);
  const [buyers, setBuyers] = useState<Record<BusinessId, ReturnType<typeof mapPosterToFeedBuyer>>>({});

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const rows = await requirementsApi.listSaved();
      const buyerMap: Record<BusinessId, ReturnType<typeof mapPosterToFeedBuyer>> = {};
      rows.forEach((r) => {
        buyerMap[String(r.poster.id)] = mapPosterToFeedBuyer(r.poster);
      });
      setBuyers(buyerMap);
      setRequirements(rows.map(mapRequirement));
    } catch (e: any) {
      setError(errorMessage(e, 'Failed to load your saved requirements.'));
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
    <Saved
      requirements={requirements}
      buyers={buyers}
      onBack={() => router.push('/home')}
      onOpenRequirement={(requirementId) => router.push({ pathname: '/requirement', params: { id: requirementId } })}
      onUnsave={async (requirementId) => {
        // Optimistic — remove immediately, put it back if the call fails.
        const removed = requirements.find((r) => r.id === requirementId);
        setRequirements((prev) => prev.filter((r) => r.id !== requirementId));
        try {
          await requirementsApi.unsave(Number(requirementId));
        } catch {
          if (removed) setRequirements((prev) => [...prev, removed]);
        }
      }}
    />
  );
}
