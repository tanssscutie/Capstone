// app/ledger.tsx
// "View full audit trail" — previously nowhere to go; GET /{id}/ledger existed
// but only ever fed one inline fact on Requirement Detail. Own route now.
import { useCallback, useEffect, useState } from 'react';
import { View, Text, ActivityIndicator } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import LedgerAudit from '../features/ledger/LedgerAudit';
import { me } from '../lib/api/auth';
import { requirementsApi } from '../lib/api/requirements';
import { mapLedgerEntry } from '../lib/api/mappers';
import type { LedgerEntry } from '../lib/types';
import { color, font, fontSize, space } from '../components/ui/tokens';
import { errorMessage } from '../lib/api/client';

export default function LedgerRoute() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [ref, setRef] = useState('');
  const [isOwner, setIsOwner] = useState(false);
  const [requirementOpen, setRequirementOpen] = useState(false);
  const [entries, setEntries] = useState<LedgerEntry[]>([]);

  const load = useCallback(async () => {
    if (!id) {
      setError('No requirement specified.');
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const numericId = Number(id);
      const [user, requirement, ledgerView] = await Promise.all([
        me(),
        requirementsApi.getById(numericId),
        requirementsApi.listLedger(numericId),
      ]);
      setTitle(requirement.title);
      setRef(requirement.ref_code);
      setIsOwner(requirement.poster.id === user.id);
      setRequirementOpen(requirement.status === 'open');
      setEntries(ledgerView.entries.map(mapLedgerEntry).sort((a, b) => a.sequence - b.sequence));
    } catch (e: any) {
      setError(errorMessage(e, 'Could not load the audit trail.'));
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

  if (error) {
    return (
      <View style={{ flex: 1, backgroundColor: color.canvas, alignItems: 'center', justifyContent: 'center', padding: space.xl }}>
        <Text style={{ fontFamily: font.body, fontSize: fontSize.base, color: color.danger, textAlign: 'center' }}>{error}</Text>
      </View>
    );
  }

  return (
    <LedgerAudit
      requirementTitle={title}
      requirementRef={ref}
      isOwner={isOwner}
      requirementOpen={requirementOpen}
      entries={entries}
      onBack={() => router.back()}
    />
  );
}
