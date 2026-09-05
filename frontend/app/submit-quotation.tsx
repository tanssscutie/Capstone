import { useEffect, useState } from 'react';
import { View, Text, ActivityIndicator } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import QuotationSubmission, { pickedQuotationFiles } from '../features/quotation/QuotationSubmission';
import type { QuotationDraftInput } from '../features/quotation/QuotationSubmission';
import { requirementsApi } from '../lib/api/requirements';
import { requirementsCache } from '../lib/api/requirementsCache';
import { mapRequirement, mapPosterToBusiness } from '../lib/api/mappers';
import { getVerificationStatus } from '../lib/api/business';
import type { Business, LedgerEntry, Quotation, Requirement } from '../lib/types';
import { color, font, fontSize, space } from '../components/ui/tokens';

export default function QuotationRoute() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [requirement, setRequirement] = useState<Requirement | null>(null);
  const [buyer, setBuyer] = useState<Business | null>(null);
  const [submission, setSubmission] = useState<{ quotation: Quotation; ledgerEntry: LedgerEntry } | null>(null);

  useEffect(() => {
    (async () => {
      if (!id) {
        setError('No requirement specified.');
        setLoading(false);
        return;
      }
      try {
        const verification = await getVerificationStatus();
        // Backend already 403s an unverified POST .../quotations (require_verified) —
        // this catches it before they fill out the whole form. Same gate as
        // post-requirement.tsx, same reasoning: send them to the status page if
        // they've already submitted for review, otherwise into onboarding.
        if (!verification.is_verified) {
          router.replace(verification.has_submitted ? '/verification-status' : '/onboarding');
          return;
        }

        const raw = await requirementsCache.ensure(Number(id));
        if (!raw) {
          setError("Couldn't find that requirement.");
          return;
        }
        setRequirement(mapRequirement(raw));
        setBuyer(mapPosterToBusiness(raw.poster));
      } catch (e: any) {
        setError(typeof e?.detail === 'string' ? e.detail : e?.message ?? 'Failed to load this requirement.');
      } finally {
        setLoading(false);
      }
    })();
  }, [id]);

  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: color.canvas, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={color.primary} />
      </View>
    );
  }

  if (error || !requirement || !buyer) {
    return (
      <View style={{ flex: 1, backgroundColor: color.canvas, alignItems: 'center', justifyContent: 'center', padding: space.xl }}>
        <Text style={{ fontFamily: font.body, fontSize: fontSize.base, color: color.danger, textAlign: 'center' }}>
          {error ?? 'Requirement not found.'}
        </Text>
      </View>
    );
  }

  if (submission) {
    return (
      <QuotationSubmission
        state="SEALED_RECEIPT"
        requirement={requirement}
        buyer={buyer}
        quotation={submission.quotation}
        ledgerEntry={submission.ledgerEntry}
        onWithdraw={async () => {
          try {
            await requirementsApi.withdrawQuotation(Number(id));
            setSubmission(null);
          } catch (e: any) {
            setError(typeof e?.detail === 'string' ? e.detail : e?.message ?? 'Could not withdraw this quotation.');
          }
        }}
        onBack={() => router.back()}
        onTrack={() => router.push('/quotations')}
      />
    );
  }

  return (
    <QuotationSubmission
      state="FORM"
      requirement={requirement}
      buyer={buyer}
      onBack={() => router.back()}
      onOpenBuyer={(businessId) => router.push({ pathname: '/business-profile', params: { id: businessId } })}
      onSubmit={async (input: QuotationDraftInput) => {
        try {
          const receipt = await requirementsApi.submitQuotation(Number(id), {
            total_price: input.totalPrice,
            delivery_lead_time: `${input.leadTimeDays} days`,
            payment_terms: input.paymentTerms,
            validity_period: `${input.validityDays} days`,
            notes: input.notesToBuyer,
          });
          // Attachments need a real quotation id before they can upload, so this happens
          // as a second step after submitQuotation() rather than inline with it.
          // Native-fallback attachments (no real File behind them — see
          // pickedQuotationFiles) are skipped.
          for (const att of input.attachments) {
            const file = pickedQuotationFiles.get(att.id);
            if (!file) continue;
            try {
              await requirementsApi.uploadQuotationAttachment(Number(id), receipt.quotation_id, file, att.filename);
            } finally {
              pickedQuotationFiles.delete(att.id);
            }
          }

          const quotation: Quotation = {
            id: String(receipt.quotation_id),
            ref: receipt.quotation_ref,
            requirementId: String(id),
            respondentId: buyer.id, // placeholder — see mapPosterToBusiness note; not the viewer's real id
            status: 'SUBMITTED',
            totalPrice: input.totalPrice,
            leadTimeDays: input.leadTimeDays,
            paymentTerms: input.paymentTerms,
            validityDays: input.validityDays,
            notesToBuyer: input.notesToBuyer,
            attachments: input.attachments,
            submittedAt: receipt.submitted_at,
            hashTruncated: receipt.truncated_hash,
            ledgerEntryId: String(receipt.ledger_entry_number),
            integrity: null,
            withdrawnAt: null,
            replacedByQuotationId: null,
          };
          const ledgerEntry: LedgerEntry = {
            id: String(receipt.ledger_entry_number),
            sequence: receipt.ledger_entry_number,
            type: 'QUOTATION_SUBMITTED',
            subjectId: quotation.id,
            hash: receipt.truncated_hash,
            previousHash: null, // BACKEND GAP — not returned
            createdAt: receipt.submitted_at,
          };
          setSubmission({ quotation, ledgerEntry });
        } catch (e: any) {
          setError(typeof e?.detail === 'string' ? e.detail : e?.message ?? 'Could not submit your quotation.');
        }
      }}
    />
  );
}
