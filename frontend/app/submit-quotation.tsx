import { useEffect, useRef, useState } from 'react';
import { useWithdrawConfirm } from '../components/ui/WithdrawConfirm';
import { View, Text, ActivityIndicator } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import QuotationSubmission, { pickedQuotationFiles } from '../features/quotation/QuotationSubmission';
import type { QuotationDraftInput } from '../features/quotation/QuotationSubmission';
import { requirementsApi } from '../lib/api/requirements';
import { requirementsCache } from '../lib/api/requirementsCache';
import { mapRequirement, mapPosterToBusiness } from '../lib/api/mappers';
import { getVerificationStatus } from '../lib/api/business';
import { me } from '../lib/api/auth';
import type { Business, LedgerEntry, Quotation, Requirement } from '../lib/types';
import { color, font, fontSize, space } from '../components/ui/tokens';
import { errorMessage } from '../lib/api/client';

export default function QuotationRoute() {
  const withdrawConfirm = useWithdrawConfirm();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [requirement, setRequirement] = useState<Requirement | null>(null);
  const [buyer, setBuyer] = useState<Business | null>(null);
  const [submission, setSubmission] = useState<{ quotation: Quotation; ledgerEntry: LedgerEntry } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [receiptNotice, setReceiptNotice] = useState<string | null>(null);
  // State updates aren't visible to a second press fired before the re-render,
  // so the in-flight guard lives in a ref too.
  const submittingRef = useRef(false);

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
        // post-requirement.tsx: always the status page, never straight into the
        // onboarding wizard — a brand-new account that never even started
        // verification still deserves the explanation first, not to be dropped
        // into a four-step form with no context. VerificationStatus.tsx's
        // "not started" state already covers that, with its own explicit
        // "Start verification" button.
        if (!verification.is_verified) {
          router.replace('/verification-status');
          return;
        }

        const [raw, user] = await Promise.all([requirementsCache.ensure(Number(id)), me()]);
        if (!raw) {
          setError("Couldn't find that requirement.");
          return;
        }
        // Only seller accounts quote (backend: require_seller) — a buyer who
        // lands here by URL sees the read-only requirement page instead.
        if (user.role !== 'seller') {
          router.replace({ pathname: '/requirement', params: { id } });
          return;
        }
        // Backend already 403s this (can't quote your own requirement — see
        // CannotQuoteOwnRequirement) — this catches it before they fill out
        // the whole sealed-quotation form, same as the verification gate
        // above. Sends them to the real owner view instead of a bare error,
        // since that's the page this requirement actually belongs to for them.
        if (raw.poster.id === user.id) {
          router.replace({ pathname: '/requirement', params: { id } });
          return;
        }
        setRequirement(mapRequirement(raw));
        setBuyer(mapPosterToBusiness(raw.poster));
      } catch (e: any) {
        setError(errorMessage(e, 'Failed to load this requirement.'));
      } finally {
        setLoading(false);
      }
    })();
  }, [id]);

  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: color.surfaceSunken, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={color.primary} />
      </View>
    );
  }

  if (error || !requirement || !buyer) {
    return (
      <View style={{ flex: 1, backgroundColor: color.surfaceSunken, alignItems: 'center', justifyContent: 'center', padding: space.xl }}>
        <Text style={{ fontFamily: font.body, fontSize: fontSize.base, color: color.danger, textAlign: 'center' }}>
          {error ?? 'Requirement not found.'}
        </Text>
      </View>
    );
  }

  if (submission) {
    return (
      <>
      <QuotationSubmission
        state="SEALED_RECEIPT"
        requirement={requirement}
        buyer={buyer}
        quotation={submission.quotation}
        ledgerEntry={submission.ledgerEntry}
        notice={receiptNotice}
        onWithdraw={() => withdrawConfirm.confirm(async () => {
          try {
            await requirementsApi.withdrawQuotation(Number(id));
            setSubmission(null);
            setReceiptNotice(null);
            setSubmitError(null);
          } catch (e: any) {
            setError(errorMessage(e, 'Could not withdraw this quotation.'));
          }
        })}
        onBack={() => router.back()}
        onTrack={() => router.push('/quotations')}
      />
      {withdrawConfirm.modal}
      </>
    );
  }

  return (
    <QuotationSubmission
      state="FORM"
      requirement={requirement}
      buyer={buyer}
      onBack={() => router.back()}
      onOpenBuyer={(businessId) => router.push({ pathname: '/business-profile', params: { id: businessId } })}
      onDraftWithAI={async () => {
        try {
          const d = await requirementsApi.quotationDraft(Number(id));
          return {
            source: d.source,
            message: d.message,
            lineItems: d.line_items.map((li) => ({ description: li.description, quantity: li.quantity, unitPrice: li.unit_price })),
            specResponses: d.spec_responses,
            leadTimeWeeks: d.lead_time_weeks,
            paymentTerms: d.payment_terms,
            validityDays: d.validity_days,
            notes: d.notes,
          };
        } catch (e: any) {
          throw new Error(errorMessage(e, 'Could not draft this right now. Try again, or fill it in yourself.'));
        }
      }}
      submitting={submitting}
      submitError={submitError}
      onSubmit={async (input: QuotationDraftInput) => {
        if (submittingRef.current) return;
        submittingRef.current = true;
        setSubmitting(true);
        setSubmitError(null);
        let receipt;
        try {
          receipt = await requirementsApi.submitQuotation(Number(id), {
            total_price: input.totalPrice,
            line_items: input.lineItems.map((li) => ({
              description: li.description,
              quantity: li.quantity,
              unit_price: li.unitPrice,
            })),
            delivery_lead_time: `${input.leadTimeDays} days`,
            payment_terms: input.paymentTerms,
            validity_period: `${input.validityDays} days`,
            notes: input.notesToBuyer,
            over_budget_reason: input.overBudgetReason || null,
            spec_responses: input.specResponses.map((r) => ({ label: r.label, complies: r.complies, offered: r.offered })),
          });
        } catch (e: any) {
          // Nothing was sealed — keep the form and everything typed into it.
          setSubmitError(errorMessage(e, 'Could not submit your quotation.'));
          submittingRef.current = false;
          setSubmitting(false);
          return;
        }

        // From here on the quotation IS sealed server-side. An attachment failure
        // must not drop back to an error screen — retrying would only 409 against
        // the quotation that already exists — so it's reported on the receipt.
        // Attachments need a real quotation id before they can upload, so this happens
        // as a second step after submitQuotation() rather than inline with it.
        // Native-fallback attachments (no real File behind them — see
        // pickedQuotationFiles) are skipped.
        const uploaded: typeof input.attachments = [];
        const failed: string[] = [];
        for (const att of input.attachments) {
          const file = pickedQuotationFiles.get(att.id);
          if (!file) continue;
          try {
            await requirementsApi.uploadQuotationAttachment(
              Number(id),
              receipt.quotation_id,
              file,
              att.filename,
              att.documentLabel ?? undefined,
            );
            uploaded.push(att);
          } catch {
            failed.push(att.filename);
          } finally {
            pickedQuotationFiles.delete(att.id);
          }
        }
        setReceiptNotice(
          failed.length > 0
            ? `Your quotation is sealed, but ${failed.length === 1 ? 'this attachment' : 'these attachments'} failed to upload: ${failed.join(', ')}. Withdraw and resubmit before closing to include ${failed.length === 1 ? 'it' : 'them'}.`
            : null,
        );

        const quotation: Quotation = {
          id: String(receipt.quotation_id),
          ref: receipt.quotation_ref,
          requirementId: String(id),
          respondentId: buyer.id, // placeholder — see mapPosterToBusiness note; not the viewer's real id
          status: 'SUBMITTED',
          totalPrice: input.totalPrice,
          lineItems: input.lineItems,
          specResponses: input.specResponses,
          leadTimeDays: input.leadTimeDays,
          paymentTerms: input.paymentTerms,
          validityDays: input.validityDays,
          notesToBuyer: input.notesToBuyer,
          attachments: uploaded,
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
          actorName: null, // it's always the viewer's own submission here — nothing to label
          hash: receipt.truncated_hash,
          previousHash: null, // BACKEND GAP — not returned
          createdAt: receipt.submitted_at,
        };
        setSubmission({ quotation, ledgerEntry });
        submittingRef.current = false;
        setSubmitting(false);
      }}
    />
  );
}
