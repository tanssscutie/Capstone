import { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, ActivityIndicator } from 'react-native';
import { useRouter, useLocalSearchParams, useFocusEffect } from 'expo-router';
import HomeFeed from '../features/home-feed/HomeFeed';
import { me } from '../lib/api/auth';
import { getVerificationStatus, getDashboardStats } from '../lib/api/business';
import { requirementsApi } from '../lib/api/requirements';
import { requirementsCache } from '../lib/api/requirementsCache';
import { useMessaging } from '../lib/useMessaging';
import { postRequirementClone } from '../lib/postRequirementClone';
import { mapRequirement, mapMyRequirement, mapPosterToFeedBuyer, mapViewerBusiness } from '../lib/api/mappers';
import type { Business, Requirement, BusinessId } from '../lib/types';
import { color, font, fontSize, space } from '../components/ui/tokens';
import { errorMessage } from '../lib/api/client';

export default function HomeRoute() {
  const router = useRouter();
  const { q, openThread } = useLocalSearchParams<{ q?: string; openThread?: string }>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [viewer, setViewer] = useState<Business | null>(null);
  const [requirements, setRequirements] = useState<Requirement[]>([]);
  const [requirementBuyers, setRequirementBuyers] = useState<Record<BusinessId, ReturnType<typeof mapPosterToFeedBuyer>>>({});
  const [myRequirements, setMyRequirements] = useState<Requirement[]>([]);
  const [recentlyClosed, setRecentlyClosed] = useState<Requirement[]>([]);
  const chat = useMessaging();
  // Whether they've submitted for verification at least once — decides where "Complete
  // Verification" sends them: straight into the form (never submitted) vs the status
  // page (already submitted, no point re-doing onboarding from scratch to check on it).
  const [hasSubmittedVerification, setHasSubmittedVerification] = useState(false);

  // `showSpinner` is only true for the very first load — a refetch triggered by
  // returning to this screen (e.g. back from Post a Requirement, right after
  // publishing) updates the feed quietly in the background instead of blanking
  // the whole screen back to a spinner, the same way the message-thread poll
  // below never shows one either.
  const loadFeed = useCallback(async (showSpinner: boolean) => {
    if (showSpinner) setLoading(true);
    try {
      const [user, verification, stats, openReqs, mineReqs] = await Promise.all([
        me(),
        getVerificationStatus(),
        getDashboardStats(),
        requirementsApi.listOpen(),
        requirementsApi.listMine(),
      ]);

      setViewer(mapViewerBusiness(user, verification, stats));
      setHasSubmittedVerification(verification.has_submitted);

      const buyers: Record<BusinessId, ReturnType<typeof mapPosterToFeedBuyer>> = {};
      openReqs.forEach((r) => {
        buyers[String(r.poster.id)] = mapPosterToFeedBuyer(r.poster);
      });
      setRequirementBuyers(buyers);
      setRequirements(openReqs.map(mapRequirement));
      requirementsCache.putMany(openReqs);

      const ownerId = String(user.id);
      const mine = mineReqs.map((r) => mapMyRequirement(r, ownerId));
      setMyRequirements(mine.filter((r) => r.status === 'OPEN'));
      // No dedicated "recently closed" endpoint yet — approximated from the
      // owner's own requirements that are no longer open.
      setRecentlyClosed(mine.filter((r) => r.status !== 'OPEN'));

      if (showSpinner) setError(null);
    } catch (e: any) {
      // A silent background refetch failing shouldn't blank out a feed that's
      // already showing perfectly good data — only the first load surfaces an error.
      if (showSpinner) setError(errorMessage(e, 'Failed to load your feed.'));
    } finally {
      if (showSpinner) setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadFeed(true);
  }, [loadFeed]);

  // Refetches every time this screen regains focus — e.g. navigating back from
  // Post a Requirement right after publishing, or from Requirement Detail after
  // awarding — so a change made elsewhere shows up without a manual page reload.
  // Skips the very first focus, which the mount effect above already covers.
  const isFirstFocus = useRef(true);
  useFocusEffect(
    useCallback(() => {
      if (isFirstFocus.current) {
        isFirstFocus.current = false;
        return;
      }
      loadFeed(false);
      chat.refreshThreads();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [loadFeed]),
  );

  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: color.canvas, alignItems: 'center', justifyContent: 'center', gap: space.md }}>
        <ActivityIndicator color={color.primary} />
        <Text style={{ fontFamily: font.body, fontSize: fontSize.base, color: color.inkMuted }}>Loading your feed…</Text>
      </View>
    );
  }

  if (error || !viewer) {
    return (
      <View style={{ flex: 1, backgroundColor: color.canvas, alignItems: 'center', justifyContent: 'center', padding: space.xl }}>
        <Text style={{ fontFamily: font.body, fontSize: fontSize.base, color: color.danger, textAlign: 'center' }}>
          {error ?? 'Could not load your account.'}
        </Text>
      </View>
    );
  }

  return (
    <HomeFeed
      viewer={viewer}
      requirements={requirements}
      searchQuery={typeof q === 'string' ? q : ''}
      autoOpenThreadId={typeof openThread === 'string' ? openThread : undefined}
      requirementBuyers={requirementBuyers}
      myRequirements={myRequirements}
      recentlyClosed={recentlyClosed}
      messageThreads={chat.threads}
      messagesByThread={chat.messagesByThread}
      onExpandMessages={(threadId) => router.push(threadId ? { pathname: '/messages', params: { thread: threadId } } : '/messages')}
      onPostRequirement={() => router.push('/post-requirement')}
      onCompleteVerification={() => router.push(hasSubmittedVerification ? '/verification-status' : '/onboarding')}
      onAddMayorsPermit={() => router.push('/add-permit')}
      onUpdateCapabilities={() => router.push('/onboarding?mode=edit')}
      onUsePreviousRequirement={() => {
        const candidates = [...myRequirements, ...recentlyClosed].sort(
          (a, b) => new Date(b.publishedAt ?? 0).getTime() - new Date(a.publishedAt ?? 0).getTime(),
        );
        const source = candidates[0];
        if (!source) return;
        postRequirementClone.set(
          {
            category: source.category,
            // Null on an older requirement — the buyer picks an item again.
            itemCode: source.itemCode ?? '',
            title: source.title,
            scope: source.scope,
            specifications: source.specifications,
            quantity: source.quantity,
            budgetMin: source.budgetMin,
            budgetMax: source.budgetMax,
            strictBudget: source.strictBudget ?? false,
            requiredDocuments: source.requiredDocuments,
          },
          { city: source.deliverySite.name, address: source.deliverySite.address },
        );
        router.push('/post-requirement');
      }}
      onSelectRequirement={(requirementId) => router.push({ pathname: '/requirement', params: { id: requirementId } })}
      onSubmitQuotation={(requirementId) => router.push({ pathname: '/submit-quotation', params: { id: requirementId } })}
      onManageRequirements={() => router.push('/requirements')}
      onToggleSave={async (requirementId, nextSaved) => {
        // Optimistic — the toggle should feel instant; revert only if the call fails.
        setRequirements((prev) => prev.map((r) => (r.id === requirementId ? { ...r, isSaved: nextSaved } : r)));
        try {
          await (nextSaved ? requirementsApi.save(Number(requirementId)) : requirementsApi.unsave(Number(requirementId)));
        } catch {
          setRequirements((prev) => prev.map((r) => (r.id === requirementId ? { ...r, isSaved: !nextSaved } : r)));
        }
      }}
      fulfillmentByThread={chat.fulfillmentByThread}
      onOpenThread={chat.onOpenThread}
      onOpenAttachment={chat.onOpenAttachment}
      onSendMessage={chat.onSendMessage}
    />
  );
}
