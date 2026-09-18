// app/verification-status.tsx
// A persistent page for "what state am I in?" — reachable any time, unlike
// Onboarding.tsx's ARRIVAL confirmation which only ever shows once, right after
// submitting, and can't be reconstructed afterward.
import { useCallback, useEffect, useState } from 'react';
import { View, Text, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import VerificationStatus from '../features/verification/VerificationStatus';
import { getVerificationStatus } from '../lib/api/business';
import type { VerificationStatusOut } from '../lib/api/business';
import { color, font, fontSize, space } from '../components/ui/tokens';
import { errorMessage } from '../lib/api/client';

export default function VerificationStatusRoute() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<VerificationStatusOut | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setStatus(await getVerificationStatus());
    } catch (e: any) {
      setError(errorMessage(e, 'Failed to load your verification status.'));
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

  if (error || !status) {
    return (
      <View style={{ flex: 1, backgroundColor: color.canvas, alignItems: 'center', justifyContent: 'center', padding: space.xl }}>
        <Text style={{ fontFamily: font.body, fontSize: fontSize.base, color: color.danger, textAlign: 'center' }}>
          {error ?? 'Could not load your verification status.'}
        </Text>
      </View>
    );
  }

  return (
    <VerificationStatus
      status={status}
      onBack={() => router.push('/home')}
      onContinueOnboarding={() => router.push('/onboarding')}
    />
  );
}
