import { useEffect, useState } from 'react';
import { View, Text, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import PostRequirement, { pickedRequirementFiles } from '../features/post-requirement/PostRequirement';
import type {
  RequirementDetailsDraft,
  RequirementDeliveryDraft,
  RequirementClosingDraft,
} from '../features/post-requirement/PostRequirement';
import type { PostRequirementState, Business } from '../lib/types';
import { color, font, fontSize, space } from '../components/ui/tokens';
import { me } from '../lib/api/auth';
import { getVerificationStatus, getDashboardStats } from '../lib/api/business';
import { mapViewerBusiness } from '../lib/api/mappers';
import { requirementsApi } from '../lib/api/requirements';
import { requirementsCache } from '../lib/api/requirementsCache';
import { errorMessage } from '../lib/api/client';
import { postRequirementClone } from '../lib/postRequirementClone';

export default function PostRequirementRoute() {
  const router = useRouter();
  const [step, setStep] = useState<PostRequirementState>('DETAILS');
  const [details, setDetails] = useState<RequirementDetailsDraft | null>(null);
  const [delivery, setDelivery] = useState<RequirementDeliveryDraft | null>(null);
  // Seeded once from postRequirementClone ("Use Previous Requirement") — kept separate
  // from `delivery` above, which only ever holds the DELIVERY step's *completed* draft.
  const [cloneDeliveryInitial, setCloneDeliveryInitial] = useState<Partial<RequirementDeliveryDraft> | undefined>(undefined);
  const [closing, setClosing] = useState<RequirementClosingDraft | null>(null);
  const [poster, setPoster] = useState<Business | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [publishError, setPublishError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const [user, verification, stats] = await Promise.all([me(), getVerificationStatus(), getDashboardStats()]);
      const business = mapViewerBusiness(user, verification, stats);
      // Backend already 403s an unverified POST /requirements (require_verified) —
      // this just catches it before the user fills out a whole four-step form only
      // to hit that wall at the very end. Never sets `poster`, so the loading
      // spinner below just keeps showing until the redirect lands.
      if (business.credibility.status !== 'VERIFIED') {
        // Always the status page — even a brand-new account that never started
        // verification sees an explanation and an explicit "Start verification"
        // button there (VerificationStatus.tsx's "not started" state), instead
        // of being dropped straight into the onboarding wizard with no context.
        router.replace('/verification-status');
        return;
      }
      setPoster(business);

      const clone = postRequirementClone.take();
      if (clone) {
        setDetails(clone.details);
        setCloneDeliveryInitial(clone.delivery);
      }
    })();
  }, []);

  if (!poster) {
    return (
      <View style={{ flex: 1, backgroundColor: color.canvas, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={color.primary} />
      </View>
    );
  }

  if (publishing) {
    return (
      <View style={{ flex: 1, backgroundColor: color.canvas, alignItems: 'center', justifyContent: 'center', gap: space.md }}>
        <ActivityIndicator color={color.primary} />
        <Text style={{ fontFamily: font.body, fontSize: fontSize.base, color: color.inkMuted }}>Publishing…</Text>
      </View>
    );
  }

  if (step === 'DELIVERY' && details) {
    return (
      <PostRequirement
        state="DELIVERY"
        poster={poster}
        details={details}
        initial={delivery ?? cloneDeliveryInitial}
        onContinue={(draft) => {
          setDelivery(draft);
          setStep('CLOSING');
        }}
        onBack={() => setStep('DETAILS')}
      />
    );
  }

  if (step === 'CLOSING' && details && delivery) {
    return (
      <PostRequirement
        state="CLOSING"
        poster={poster}
        details={details}
        delivery={delivery}
        initial={closing ?? undefined}
        onContinue={(draft) => {
          setClosing(draft);
          setStep('REVIEW');
        }}
        onBack={() => setStep('DELIVERY')}
      />
    );
  }

  if (step === 'REVIEW' && details && delivery && closing) {
    return (
      <PostRequirement
        state="REVIEW"
        poster={poster}
        details={details}
        delivery={delivery}
        closing={closing}
        onBack={() => setStep('CLOSING')}
        publishError={publishError}
        onPublish={async (input) => {
          setPublishing(true);
          setPublishError(null);
          try {
            const created = await requirementsApi.create({
              category: input.category,
              title: input.title,
              scope: input.scope,
              specifications: input.specifications,
              quantity: input.quantity,
              price_min: input.budgetMin,
              price_max: input.budgetMax,
              city: input.deliveryCity,
              site_address: input.deliveryAddress || null,
              delivery_start: input.deliveryWindowFrom ? new Date(input.deliveryWindowFrom).toISOString() : null,
              delivery_end: input.deliveryWindowTo ? new Date(input.deliveryWindowTo).toISOString() : null,
              required_documents: input.requiredDocuments,
              closes_at: input.closingAt,
            });
            requirementsCache.put(created);
            // Attachments need a real requirement id before they can upload, so this happens
            // as a second step after create() rather than inline with it. Native-fallback
            // attachments (no real File behind them — see pickedRequirementFiles) are skipped.
            for (const att of input.attachments) {
              const file = pickedRequirementFiles.get(att.id);
              if (!file) continue;
              try {
                await requirementsApi.uploadAttachment(created.id, file, att.filename);
              } finally {
                pickedRequirementFiles.delete(att.id);
              }
            }
            setDetails(null);
            setDelivery(null);
            setClosing(null);
            setStep('DETAILS');
            router.push({ pathname: '/requirement', params: { id: String(created.id) } });
          } catch (e: any) {
            const message = errorMessage(e, 'Could not publish this requirement.');
            setPublishError(message);
            // eslint-disable-next-line no-console
            console.error('[post-requirement] publish failed:', message);
          } finally {
            setPublishing(false);
          }
        }}
      />
    );
  }

  return (
    <PostRequirement
      state="DETAILS"
      poster={poster}
      initial={details ?? undefined}
      onContinue={(draft) => {
        setDetails(draft);
        setStep('DELIVERY');
      }}
      onSuggestCategory={async (title, scope) => {
        try {
          const result = await requirementsApi.suggestCategory(title, scope);
          return result.category;
        } catch {
          return null;
        }
      }}
    />
  );
}
