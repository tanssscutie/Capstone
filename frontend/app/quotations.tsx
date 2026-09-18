import { useEffect, useState } from 'react';
import { View, Text, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import MyQuotations from '../features/my-quotations/MyQuotations';
import { requirementsApi } from '../lib/api/requirements';
import { mapMyQuotation, mapMyQuotationRequirement, mapPosterToBusiness } from '../lib/api/mappers';
import type { Quotation, Requirement, Business, BusinessId } from '../lib/types';
import { color, font, fontSize, space } from '../components/ui/tokens';
import { errorMessage } from '../lib/api/client';

export default function MyQuotationsRoute() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [quotations, setQuotations] = useState<Quotation[]>([]);
  const [requirements, setRequirements] = useState<Record<string, Requirement>>({});
  const [buyers, setBuyers] = useState<Record<BusinessId, Business>>({});

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const rows = await requirementsApi.listMyQuotations();
      setQuotations(rows.map(mapMyQuotation));

      const reqMap: Record<string, Requirement> = {};
      const buyerMap: Record<BusinessId, Business> = {};
      rows.forEach((row) => {
        reqMap[String(row.requirement_id)] = mapMyQuotationRequirement(row);
        buyerMap[String(row.poster.id)] = mapPosterToBusiness(row.poster);
      });
      setRequirements(reqMap);
      setBuyers(buyerMap);
    } catch (e: any) {
      setError(errorMessage(e, 'Failed to load your quotations.'));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

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
    <MyQuotations
      quotations={quotations}
      requirements={requirements}
      buyers={buyers}
      onBack={() => router.back()}
      onOpenRequirement={(requirementId) => router.push({ pathname: '/requirement', params: { id: requirementId } })}
      onResubmit={(requirementId) => router.push({ pathname: '/submit-quotation', params: { id: requirementId } })}
      onWithdraw={async (quotationId) => {
        const quotation = quotations.find((q) => q.id === quotationId);
        if (!quotation) return;
        // Optimistic update, then reload from the server so outcome/status stay accurate
        // (the backend, not the client, decides what "withdrawn" means going forward).
        setQuotations((prev) =>
          prev.map((q) => (q.id === quotationId ? { ...q, status: 'WITHDRAWN', withdrawnAt: new Date().toISOString() } : q)),
        );
        try {
          await requirementsApi.withdrawQuotation(Number(quotation.requirementId));
          await load();
        } catch (e: any) {
          setError(errorMessage(e, 'Could not withdraw this quotation.'));
        }
      }}
    />
  );
}
