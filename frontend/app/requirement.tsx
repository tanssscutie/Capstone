import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { View, Text, ActivityIndicator, Pressable } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import RequirementDetail from '../features/requirement-detail/RequirementDetail';
import { me } from '../lib/api/auth';
import { requirementsApi } from '../lib/api/requirements';
import { requirementsCache } from '../lib/api/requirementsCache';
import { messagesApi } from '../lib/api/messages';
import {
  mapRequirement,
  mapPosterToBusiness,
  mapMyQuotation,
  mapQuotationDetail,
  mapLedgerEntry,
  mapClarificationQuestion,
} from '../lib/api/mappers';
import type { Business, BusinessId, ClarificationQuestion, LedgerEntry, Quotation, Requirement } from '../lib/types';
import { color, font, fontSize, space } from '../components/ui/tokens';
import { errorMessage } from '../lib/api/client';

type Respondent = Pick<Business, 'id' | 'registeredName' | 'city' | 'province' | 'credibility'>;

export default function RequirementRoute() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Distinct from `error` above: `error` gates the full-screen replacement
  // for a failed initial load (nothing to show yet). An action failing
  // AFTER the screen already loaded (award, close-without-award, shortlist,
  // etc.) must not blank out the whole page the same way — the requirement
  // is still right there, the user just needs to see what went wrong and
  // keep going. Rendered as a dismissible banner over the loaded screen.
  const [actionError, setActionError] = useState<string | null>(null);
  const [isOwner, setIsOwner] = useState(false);
  const [requirement, setRequirement] = useState<Requirement | null>(null);
  const [buyer, setBuyer] = useState<Business | null>(null);
  const [hasSubmitted, setHasSubmitted] = useState(false);
  const [ownQuotation, setOwnQuotation] = useState<Quotation | null>(null);
  const [ledgerEntry, setLedgerEntry] = useState<LedgerEntry | null>(null);
  const [releasedQuotations, setReleasedQuotations] = useState<Quotation[]>([]);
  const [respondents, setRespondents] = useState<Record<BusinessId, Respondent>>({});
  const [questions, setQuestions] = useState<ClarificationQuestion[]>([]);

  async function load() {
    if (!id) {
      setError('No requirement specified.');
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const numericId = Number(id);
      const [user, raw] = await Promise.all([me(), requirementsCache.ensure(numericId)]);
      if (!raw) {
        setError("Couldn't find that requirement.");
        return;
      }
      const mapped = mapRequirement(raw);
      setRequirement(mapped);
      const owner = raw.poster.id === user.id;
      setIsOwner(owner);

      // Q&A only matters before closing — RESPONDENT and OWNER_SEALED are the two
      // states that render it; OWNER_RELEASED never does, so skip the fetch there.
      if (mapped.status === 'OPEN') {
        const rows = await requirementsApi.listQuestions(numericId);
        setQuestions(rows.map(mapClarificationQuestion));
      } else {
        setQuestions([]);
      }

      if (owner) {
        if (mapped.status === 'OPEN') {
          setReleasedQuotations([]);
          setRespondents({});
        } else {
          const view = await requirementsApi.listQuotations(numericId);
          const quotations = (view.quotations ?? []).map((q) => mapQuotationDetail(q, String(numericId)));
          const respMap: Record<BusinessId, Respondent> = {};
          (view.quotations ?? []).forEach((q) => {
            respMap[String(q.business.id)] = mapPosterToBusiness(q.business);
          });
          setReleasedQuotations(quotations);
          setRespondents(respMap);
        }
      } else {
        setBuyer(mapPosterToBusiness(raw.poster));
        if (raw.my_active_quotation_ref) {
          const [mine, ledgerView] = await Promise.all([
            requirementsApi.listMyQuotations(),
            requirementsApi.listLedger(numericId),
          ]);
          const match = mine.find((q) => q.requirement_id === numericId);
          if (match) {
            setHasSubmitted(true);
            setOwnQuotation(mapMyQuotation(match));
            const entry = ledgerView.entries.find(
              (e) => e.quotation_id === match.quotation_id && e.event_type === 'SUBMITTED',
            );
            setLedgerEntry(entry ? mapLedgerEntry(entry) : null);
          }
        } else {
          setHasSubmitted(false);
        }
      }
    } catch (e: any) {
      setError(errorMessage(e, 'Failed to load this requirement.'));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, [id]);

  async function reloadQuestions() {
    if (!id) return;
    try {
      const rows = await requirementsApi.listQuestions(Number(id));
      setQuestions(rows.map(mapClarificationQuestion));
    } catch (e: any) {
      setActionError(errorMessage(e, 'Could not refresh questions.'));
    }
  }

  /** Wraps an already-loaded screen with a dismissible banner for an action
   *  failure — never replaces the screen the way the full-page `error` case
   *  above does, since the requirement itself loaded fine. */
  function withActionErrorBanner(node: ReactNode) {
    return (
      <View style={{ flex: 1 }}>
        {node}
        {actionError && (
          <Pressable
            onPress={() => setActionError(null)}
            style={{
              position: 'absolute', top: 0, left: 0, right: 0, zIndex: 20,
              backgroundColor: color.dangerFaint, borderBottomWidth: 1, borderBottomColor: color.dangerBorder,
              paddingVertical: space.sm, paddingHorizontal: space.lg,
            }}
          >
            <Text style={{ fontFamily: font.body, fontSize: fontSize.sm, color: color.danger, textAlign: 'center' }}>
              {actionError} · Tap to dismiss
            </Text>
          </Pressable>
        )}
      </View>
    );
  }

  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: color.canvas, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={color.primary} />
      </View>
    );
  }

  if (error || !requirement) {
    return (
      <View style={{ flex: 1, backgroundColor: color.canvas, alignItems: 'center', justifyContent: 'center', padding: space.xl }}>
        <Text style={{ fontFamily: font.body, fontSize: fontSize.base, color: color.danger, textAlign: 'center' }}>
          {error ?? 'Requirement not found.'}
        </Text>
      </View>
    );
  }

  if (isOwner) {
    if (requirement.status === 'OPEN') {
      return withActionErrorBanner(
        <RequirementDetail
          state="OWNER_SEALED"
          requirement={requirement}
          questions={questions}
          onAnswerQuestion={async (questionId, answer) => {
            try {
              await requirementsApi.answerQuestion(Number(id), Number(questionId), answer);
              await reloadQuestions();
            } catch (e: any) {
              setActionError(errorMessage(e, 'Could not post that answer.'));
            }
          }}
          onExtendClosing={async (newClosesAt) => {
            try {
              await requirementsApi.extend(Number(id), newClosesAt);
              await load();
            } catch (e: any) {
              setActionError(errorMessage(e, 'Could not extend the closing time.'));
            }
          }}
          onCancelRequirement={async () => {
            try {
              await requirementsApi.cancel(Number(id));
              await load();
            } catch (e: any) {
              setActionError(errorMessage(e, 'Could not cancel this requirement.'));
            }
          }}
          onUpdateSiteNotes={async (accessHours, accessNotes) => {
            try {
              await requirementsApi.updateSiteNotes(Number(id), accessHours, accessNotes);
              await load();
            } catch (e: any) {
              setActionError(errorMessage(e, 'Could not save site notes.'));
            }
          }}
          onViewLedger={() => router.push({ pathname: '/ledger', params: { id } })}
        />
      );
    }
    return withActionErrorBanner(
      <RequirementDetail
        state="OWNER_RELEASED"
        requirement={requirement}
        quotations={releasedQuotations}
        respondents={respondents}
        onAward={async (quotationId) => {
          try {
            await requirementsApi.award(Number(id), Number(quotationId));
            await load();
            return true;
          } catch (e: any) {
            setActionError(errorMessage(e, 'Could not award this quotation.'));
            return false;
          }
        }}
        onShortlistToggle={async (quotationId) => {
          const current = releasedQuotations.find((q) => q.id === quotationId);
          const nextShortlisted = current?.status !== 'SHORTLISTED';
          try {
            await (nextShortlisted
              ? requirementsApi.shortlistQuotation(Number(id), Number(quotationId))
              : requirementsApi.unshortlistQuotation(Number(id), Number(quotationId)));
            await load();
          } catch (e: any) {
            setActionError(errorMessage(e, 'Could not update the shortlist.'));
          }
        }}
        onCloseWithoutAward={async () => {
          try {
            await requirementsApi.closeWithoutAward(Number(id));
            await load();
            return true;
          } catch (e: any) {
            setActionError(errorMessage(e, 'Could not close this requirement without an award.'));
            return false;
          }
        }}
        onViewRespondentProfile={(businessId) => router.push({ pathname: '/business-profile', params: { id: businessId } })}
        onMessageRespondent={async (businessId) => {
          try {
            const threads = await messagesApi.listThreads();
            const thread = threads.find(
              (t) => t.requirement_id === Number(id) && t.counterparty_id === Number(businessId),
            );
            if (!thread) {
              setActionError('No conversation with this business yet.');
              return;
            }
            router.push({ pathname: '/home', params: { openThread: String(thread.id) } });
          } catch (e: any) {
            setActionError(errorMessage(e, 'Could not open this conversation.'));
          }
        }}
        onViewLedger={() => router.push({ pathname: '/ledger', params: { id } })}
      />
    );
  }

  if (!buyer) return null;

  const onAskQuestion = async (question: string) => {
    if (!id) return;
    try {
      await requirementsApi.askQuestion(Number(id), question);
      await reloadQuestions();
    } catch (e: any) {
      setActionError(errorMessage(e, 'Could not post that question.'));
    }
  };

  if (hasSubmitted && ownQuotation && ledgerEntry) {
    return withActionErrorBanner(
      <RequirementDetail
        state="RESPONDENT"
        requirement={requirement}
        buyer={buyer}
        hasSubmitted
        ownQuotation={ownQuotation}
        ledgerEntry={ledgerEntry}
        questions={questions}
        onAskQuestion={onAskQuestion}
        onWithdraw={async () => {
          try {
            await requirementsApi.withdrawQuotation(Number(id));
            await load();
          } catch (e: any) {
            setActionError(errorMessage(e, 'Could not withdraw this quotation.'));
          }
        }}
        onAcceptAward={async () => {
          try {
            await requirementsApi.acceptAward(Number(id));
            await load();
          } catch (e: any) {
            setActionError(errorMessage(e, 'Could not accept this award.'));
          }
        }}
        onDeclineAward={async () => {
          try {
            await requirementsApi.declineAward(Number(id));
            await load();
          } catch (e: any) {
            setActionError(errorMessage(e, 'Could not decline this award.'));
          }
        }}
        onViewBuyerProfile={() => router.push({ pathname: '/business-profile', params: { id: buyer.id } })}
        onViewLedger={() => router.push({ pathname: '/ledger', params: { id } })}
      />
    );
  }

  return withActionErrorBanner(
    <RequirementDetail
      state="RESPONDENT"
      requirement={requirement}
      buyer={buyer}
      hasSubmitted={false}
      questions={questions}
      onAskQuestion={onAskQuestion}
      onSubmitQuotation={() => router.push({ pathname: '/submit-quotation', params: { id } })}
      onViewBuyerProfile={() => router.push({ pathname: '/business-profile', params: { id: buyer.id } })}
      onViewLedger={() => router.push({ pathname: '/ledger', params: { id } })}
    />
  );
}