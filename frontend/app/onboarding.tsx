import { useEffect, useState } from 'react';
import { View, Text, ActivityIndicator } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import Onboarding, { pickedDocumentFiles } from '../features/onboarding/Onboarding';
import type { IdentityDraft, OperationsDraft, DocumentsDraft } from '../features/onboarding/Onboarding';
import type { Business, OnboardingStep, SignupIntent } from '../lib/types';
import { color, font, fontSize, space } from '../components/ui/tokens';
import { submitOnboarding, uploadDocument, submitForVerification, getVerificationStatus, extractDocumentFields, suggestDescription } from '../lib/api/business';
import { mapViewerBusiness } from '../lib/api/mappers';
import { me } from '../lib/api/auth';
import { getDashboardStats } from '../lib/api/business';
import { errorMessage } from '../lib/api/client';

export default function OnboardingRoute() {
  const router = useRouter();
  const { mode } = useLocalSearchParams<{ mode?: string }>();
  // Reached from My Profile's "Update in onboarding" — an already-verified business
  // editing their name/contact/capabilities, not someone verifying for the first time.
  // Never touches DOCUMENTS or re-triggers verification: forcing a re-upload just to
  // fix a phone number risks a validation flag demoting them out of "verified" for
  // something that has nothing to do with their documents.
  const editMode = mode === 'edit';

  const [step, setStep] = useState<OnboardingStep>('IDENTITY');
  const [identity, setIdentity] = useState<IdentityDraft | null>(null);
  const [operations, setOperations] = useState<OperationsDraft | null>(null);
  const [documents, setDocuments] = useState<DocumentsDraft | null>(null);
  const [business, setBusiness] = useState<Business | null>(null);
  const [seeding, setSeeding] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Always checks first, edit mode or not: a business that already finished
  // IDENTITY + OPERATIONS (onboarding_completed) but never got past DOCUMENTS —
  // e.g. they left and came back via "Continue onboarding" on the verification
  // status page — used to be dropped straight back into a blank IDENTITY step,
  // forcing them to retype everything already on file. Now that data is seeded
  // from the backend the same way edit mode already seeded it, and a non-edit
  // resume skips straight to DOCUMENTS, the one step actually still missing.
  // A brand-new business (onboarding_completed: false) still starts at IDENTITY,
  // same as before — there's nothing to seed for them.
  useEffect(() => {
    (async () => {
      try {
        const status = await getVerificationStatus();
        if (!status.onboarding_completed) return;
        setIdentity({
          signupIntent: (status.signup_intent as SignupIntent) ?? 'BOTH',
          registeredName: status.registered_name ?? '',
          displayName: status.display_name ?? '',
          businessType: (status.business_type as IdentityDraft['businessType']) ?? 'SOLE_PROP',
          category: status.industry_category ?? '',
          city: status.city ?? '',
          province: status.province ?? '',
          contactPerson: status.contact_person ?? '',
          contactMobile: status.contact_mobile ?? '',
        });
        setOperations({
          capabilities: status.capabilities,
          serviceAreas: status.service_areas,
          businessDescription: status.business_description ?? '',
        });
        if (!editMode) setStep('DOCUMENTS');
      } catch (e: any) {
        // A brand-new business with no status on file yet shouldn't block them
        // from starting fresh at IDENTITY — only surface this in edit mode,
        // where silently landing on an empty form would look like data loss.
        if (editMode) setSubmitError(errorMessage(e, 'Could not load your current profile.'));
      } finally {
        setSeeding(false);
      }
    })();
  }, [editMode]);

  async function handleEditSave(operationsDraft: OperationsDraft, identityDraft: IdentityDraft) {
    setSubmitting(true);
    setSubmitError(null);
    try {
      await submitOnboarding(identityDraft, operationsDraft);
      router.replace('/account');
    } catch (e: any) {
      setSubmitError(errorMessage(e, 'Could not save your changes.'));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDocumentsSubmit(draft: DocumentsDraft, identityDraft: IdentityDraft, operationsDraft: OperationsDraft) {
    setSubmitting(true);
    setSubmitError(null);
    try {
      // 1) Persist the profile collected across IDENTITY + OPERATIONS.
      await submitOnboarding(identityDraft, operationsDraft);

      // 2) Upload each captured document, along with the ID number the business
      // typed in for it on the DOCUMENTS step — validated client-side against the
      // same per-doc-type format the backend checks (see Onboarding.tsx's
      // ID_FORMAT_PATTERNS), so what lands here always passes that check.
      const regKind = identityDraft.businessType === 'SOLE_PROP' ? 'DTI' : 'SEC';
      const uploads: Array<[typeof draft.registrationDoc, string, string]> = [
        [draft.registrationDoc, regKind, draft.registrationIdNumber],
        [draft.birDoc, 'BIR', draft.birIdNumber],
        [draft.mayorsPermit, 'MAYORS_PERMIT', draft.mayorsPermitIdNumber],
      ];
      for (const [doc, docType, idNumber] of uploads) {
        if (!doc) continue;
        const file = pickedDocumentFiles.get(doc.id);
        if (!file) continue; // native fallback path — no real bytes captured yet
        await uploadDocument({
          docType,
          declaredOwnerName: identityDraft.contactPerson,
          declaredBusinessName: identityDraft.registeredName,
          declaredIdNumber: idNumber,
          file,
          fileName: doc.filename,
        });
      }

      // 3) Formally submit for review, then build the real Business from what the
      // backend now has on file (not a client-side placeholder).
      const status = await submitForVerification();
      const [user, stats] = await Promise.all([me(), getDashboardStats()]);
      setBusiness(mapViewerBusiness(user, status, stats));
      setDocuments(draft);
      setStep('ARRIVAL');
    } catch (e: any) {
      setSubmitError(errorMessage(e, 'Submission failed. Please try again.'));
    } finally {
      setSubmitting(false);
    }
  }

  if (seeding) {
    return (
      <View style={{ flex: 1, backgroundColor: color.canvas, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={color.primary} />
      </View>
    );
  }

  if (submitting) {
    return (
      <View style={{ flex: 1, backgroundColor: color.canvas, alignItems: 'center', justifyContent: 'center', gap: space.md }}>
        <ActivityIndicator color={color.primary} />
        <Text style={{ fontFamily: font.body, fontSize: fontSize.base, color: color.inkMuted }}>
          {editMode ? 'Saving your changes…' : 'Submitting your application…'}
        </Text>
      </View>
    );
  }

  if (step === 'OPERATIONS' && identity) {
    return (
      <View style={{ flex: 1 }}>
        {submitError && (
          <View style={{ padding: space.md, backgroundColor: color.dangerFaint }}>
            <Text style={{ fontFamily: font.body, fontSize: fontSize.sm, color: color.danger }}>{submitError}</Text>
          </View>
        )}
        <Onboarding
          step="OPERATIONS"
          identity={identity}
          initial={operations ?? undefined}
          editMode={editMode}
          onContinue={(draft) => {
            if (editMode) {
              handleEditSave(draft, identity);
              return;
            }
            setOperations(draft);
            setStep('DOCUMENTS');
          }}
          onBack={() => setStep('IDENTITY')}
          onSuggestDescription={async (capabilities, serviceAreas) => {
            try {
              const result = await suggestDescription(identity, capabilities, serviceAreas);
              return result.description;
            } catch {
              return null;
            }
          }}
        />
      </View>
    );
  }

  if (step === 'DOCUMENTS' && identity && operations) {
    return (
      <View style={{ flex: 1 }}>
        {submitError && (
          <View style={{ padding: space.md, backgroundColor: color.dangerFaint }}>
            <Text style={{ fontFamily: font.body, fontSize: fontSize.sm, color: color.danger }}>{submitError}</Text>
          </View>
        )}
        <Onboarding
          step="DOCUMENTS"
          identity={identity}
          operations={operations}
          onSubmit={(draft) => handleDocumentsSubmit(draft, identity, operations)}
          onBack={() => setStep('OPERATIONS')}
          onExtractDocument={async (docType, file) => {
            try {
              const result = await extractDocumentFields(docType, file, file.name);
              return result.id_number;
            } catch {
              // Assistive extraction is a convenience only — a failed call
              // (no key configured, network hiccup, etc.) just means no
              // suggestion, same as if the feature weren't there at all.
              return null;
            }
          }}
        />
      </View>
    );
  }

  if (step === 'ARRIVAL' && business && documents) {
    return <Onboarding step="ARRIVAL" business={business} documents={documents} onEnterApp={() => router.replace('/home')} />;
  }

  return (
    <Onboarding
      step="IDENTITY"
      initial={identity ?? undefined}
      onContinue={(draft) => {
        setIdentity(draft);
        setStep('OPERATIONS');
      }}
      onExit={() => router.replace(editMode ? '/account' : '/home')}
    />
  );
}
