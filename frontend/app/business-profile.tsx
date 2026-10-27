// app/business-profile.tsx
// "View buyer profile" / "View profile" from Requirement Detail — previously
// dead buttons (onPress={() => {}}). Reads ?id= for whichever business to show.
import { useCallback, useEffect, useState } from 'react';
import { View, Text, ActivityIndicator } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import BusinessProfile from '../features/business-profile/BusinessProfile';
import {
  getPublicProfile,
  reportBusiness,
  listPortfolio,
  addPortfolioItem,
  removePortfolioItem,
  portfolioImagePath,
  type PortfolioItemOut,
} from '../lib/api/business';
import { fetchAuthedBlobUrl, openAuthedFile } from '../lib/api/client';
import { me } from '../lib/api/auth';
import { mapPublicBusinessProfile, type PublicBusinessProfile } from '../lib/api/mappers';
import { color, font, fontSize, space } from '../components/ui/tokens';
import { errorMessage } from '../lib/api/client';

export default function BusinessProfileRoute() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [profile, setProfile] = useState<PublicBusinessProfile | null>(null);
  const [viewerId, setViewerId] = useState<number | null>(null);
  const [portfolio, setPortfolio] = useState<PortfolioItemOut[] | undefined>(undefined);

  const load = useCallback(async () => {
    if (!id) {
      setError('No business specified.');
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const [raw, user] = await Promise.all([getPublicProfile(Number(id)), me().catch(() => null)]);
      setProfile(mapPublicBusinessProfile(raw));
      setViewerId(user?.id ?? null);
      // Sellers only; a failed list just hides the section.
      setPortfolio(raw.role === 'seller' ? await listPortfolio(Number(id)).catch(() => []) : undefined);
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

  // Not on your own profile. contactDetailsVisible is only true for a verified
  // viewer (or the owner, excluded above) — the backend's rule for reporting too.
  const canReport = viewerId !== null && String(viewerId) !== String(profile.id) && profile.contactDetailsVisible;
  const isOwn = viewerId !== null && String(viewerId) === String(profile.id);
  const businessId = Number(profile.id);
  const reloadPortfolio = async () => setPortfolio(await listPortfolio(businessId).catch(() => portfolio ?? []));

  return (
    <BusinessProfile
      profile={profile}
      onBack={() => router.back()}
      portfolio={portfolio}
      loadPortfolioImage={(itemId) => fetchAuthedBlobUrl(portfolioImagePath(businessId, itemId))}
      onOpenPortfolioImage={(itemId) => { openAuthedFile(portfolioImagePath(businessId, itemId)).catch(() => {}); }}
      onAddPortfolioItem={isOwn ? async (file, caption, itemCode) => {
        try {
          await addPortfolioItem(file, file.name, caption, itemCode);
          await reloadPortfolio();
          return null;
        } catch (e: any) {
          return errorMessage(e, 'Could not add that photo.');
        }
      } : undefined}
      onRemovePortfolioItem={isOwn ? async (itemId) => {
        try {
          await removePortfolioItem(itemId);
          await reloadPortfolio();
          return null;
        } catch (e: any) {
          return errorMessage(e, 'Could not remove that photo.');
        }
      } : undefined}
      onReport={canReport ? async (reason, details) => {
        try {
          await reportBusiness(Number(profile.id), reason, details);
          return null;
        } catch (e: any) {
          return errorMessage(e, 'Could not send the report.');
        }
      } : undefined}
    />
  );
}
