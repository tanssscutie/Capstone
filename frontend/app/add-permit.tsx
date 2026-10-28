// app/add-permit.tsx
// "Add your Mayor's permit" — HomeFeed's ProfileCard previously pointed at a
// dead onPress={() => {}}. Real upload flow, own route.
import { useCallback, useEffect, useState } from 'react';
import { View, Text, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import AddPermit from '../features/add-permit/AddPermit';
import { getVerificationStatus, uploadDocument } from '../lib/api/business';
import { color, font, fontSize, space } from '../components/ui/tokens';
import { ApiError, errorMessage } from '../lib/api/client';

export default function AddPermitRoute() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [ownerName, setOwnerName] = useState('');
  const [businessName, setBusinessName] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const status = await getVerificationStatus();
      setOwnerName(status.contact_person ?? '');
      setBusinessName(status.registered_name ?? '');
    } catch (e: any) {
      setError(errorMessage(e, 'Could not load your business details.'));
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
    <AddPermit
      onBack={() => router.push('/home')}
      onSubmit={async (file, fileName, permitNumber) => {
        const upload = (confirmMismatch: boolean) => uploadDocument({
          docType: 'MAYORS_PERMIT',
          declaredOwnerName: ownerName,
          declaredBusinessName: businessName,
          declaredIdNumber: permitNumber,
          file,
          fileName,
          confirmMismatch,
        });
        try {
          await upload(false);
        } catch (e) {
          // 409: the AI check thinks it's a different document — the business
          // decides. A clear non-document (422) just shows its message.
          if (e instanceof ApiError && e.status === 409 && typeof window !== 'undefined'
              && window.confirm(`${e.message}\n\nUpload it as your Mayor's Permit anyway? An administrator still reviews it.`)) {
            await upload(true);
            return;
          }
          throw e;
        }
      }}
    />
  );
}
