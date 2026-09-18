// features/home-feed/HomeFeed.tsx
// The authenticated business's main feed. One component, phone stack below
// breakpoint.desktop, wide dashboard at/above it — same pattern as RequirementDetail.tsx.
// Rebuilt from docs/design/Trustlink Home Feed.dc.html: same cards, same sections, same
// hierarchy as the design. Literal icon glyphs are dropped in favour of RN-native
// affordances (dots, badges, pills, initials chips) — the precedent RequirementDetail.tsx
// already set, since this project has no react-native-svg dependency.

import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import {
  View,
  Text,
  ScrollView,
  Pressable,
  TextInput,
  Animated,
  Image,
  StyleSheet,
  Platform,
  useWindowDimensions,
} from 'react-native';
import type { ViewStyle } from 'react-native';
import ScreenScroll from '../../components/ui/ScreenScroll';
import {
  color,
  font,
  fontSize,
  lineHeight,
  letterSpacing,
  space,
  radius,
  layout,
  breakpoint,
} from '../../components/ui/tokens';
import { AvatarChip, initials } from '../../components/ui/AvatarChip';
import type {
  Business,
  BusinessId,
  Requirement,
  MessageThread,
  Message,
  ISODateTime,
  TrustTier,
  RequirementStatus,
} from '../../lib/types';

/* ─── Props ─────────────────────────────────────────── */

/** Everything a feed card shows about the business that posted it — nothing more. */
type FeedBuyer = Pick<
  Business,
  'id' | 'registeredName' | 'displayName' | 'category' | 'city' | 'province' | 'capabilities' | 'credibility'
>;

export interface HomeFeedProps {
  viewer: Business;
  requirements: Requirement[];
  requirementBuyers: Record<BusinessId, FeedBuyer>;
  myRequirements: Requirement[];
  recentlyClosed: Requirement[];
  messageThreads: MessageThread[];
  /** Keyed by MessageThread.id. Only threads the viewer already holds are ever looked up
   *  here — there is no path in this component that constructs a new thread. */
  messagesByThread: Record<string, Message[]>;
  onSubmitQuotation?: (requirementId: string) => void;
  onPostRequirement?: () => void;
  onSelectRequirement?: (requirementId: string) => void;
  onManageRequirements?: () => void;
  /** `nextSaved` is what the toggle should become — the parent owns the actual
   *  save/unsave call and the optimistic update, this component only ever
   *  reflects `requirement.isSaved` back, never its own local guess. */
  onToggleSave?: (requirementId: string, nextSaved: boolean) => void;
  onSendMessage?: (threadId: string, body: string) => void;
  onOpenThread?: (threadId: string) => void;
  onCompleteVerification?: () => void;
  onAddMayorsPermit?: () => void;
  onUpdateCapabilities?: () => void;
  onUsePreviousRequirement?: () => void;
  /** Deep-link from Requirement Detail's "Message" button — opens this thread's
   *  conversation window as soon as the chat widget's threads load. */
  autoOpenThreadId?: string;
  /** Free-text search typed into the global header's search field (see
   *  AppHeader.tsx), forwarded down via the `?q=` route param. Matched against
   *  each open requirement's title, category, scope, delivery site, and the
   *  posting business's name/location — "requirements or businesses" per the
   *  search field's own placeholder. */
  searchQuery?: string;
}

/* ─── Formatting helpers ────────────────────────────── */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function formatMonthYear(iso: ISODateTime): string {
  const d = new Date(iso);
  return `${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

function formatPHP(amount: number): string {
  const rounded = Math.round(amount);
  const withCommas = rounded.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `₱${withCommas}`;
}

function formatBudget(min: number | null, max: number | null): string {
  if (min !== null && max !== null) return `${formatPHP(min)} – ${formatPHP(max)}`;
  if (min !== null) return `From ${formatPHP(min)}`;
  if (max !== null) return `Up to ${formatPHP(max)}`;
  return 'Not specified';
}

function timeAgoWords(iso: ISODateTime, now: number): string {
  const min = Math.max(0, Math.round((now - new Date(iso).getTime()) / 60000));
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  const h = Math.round(min / 60);
  if (h < 24) return h === 1 ? '1 hour ago' : `${h} hours ago`;
  const d = Math.round(h / 24);
  return d === 1 ? '1 day ago' : `${d} days ago`;
}

function formatClockTime(iso: ISODateTime): string {
  const d = new Date(iso);
  let h = d.getHours();
  const ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${h}:${mm} ${ampm}`;
}

function timeAgoCompact(iso: ISODateTime, now: number): string {
  const min = Math.max(0, Math.round((now - new Date(iso).getTime()) / 60000));
  if (min < 1) return 'now';
  if (min < 60) return `${min}m`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h}h`;
  const d = Math.round(h / 24);
  return `${d}d`;
}

/** `Xd Yh MMm` while more than a day remains, else a ticking `HH:MM:SS`. Distinct from
 *  RequirementDetail.tsx's word-form countdown — this screen's card treatment is a
 *  monospace ticking clock in the source design, a deliberately different presentation. */
function formatCompactCountdown(closingAt: ISODateTime, now: number): { label: string; closed: boolean; hoursLeft: number } {
  const target = new Date(closingAt).getTime();
  const remainingMs = target - now;
  if (remainingMs <= 0) return { label: 'Closed', closed: true, hoursLeft: 0 };
  const totalSeconds = Math.floor(remainingMs / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  const label = days > 0 ? `${days}d ${hours}h ${pad(minutes)}m` : `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
  return { label, closed: false, hoursLeft: remainingMs / 3600000 };
}

function shortCountdown(hoursLeft: number, closed: boolean): string {
  if (closed || hoursLeft <= 0) return 'Closed';
  if (hoursLeft < 1) return 'Ends within the hour';
  if (hoursLeft < 12) return `${Math.floor(hoursLeft)}h left`;
  return 'Ends today';
}

function requirementStatusLabel(status: RequirementStatus): string {
  switch (status) {
    case 'DRAFT': return 'Draft';
    case 'OPEN': return 'Open';
    case 'CLOSED': return 'Closed';
    case 'AWARD_PENDING': return 'Award pending';
    case 'AWARDED': return 'Awarded';
    case 'CLOSED_NO_AWARD': return 'Closed — No Award';
    case 'CANCELLED': return 'Cancelled';
  }
}

function tierLabel(tier: TrustTier | null): string {
  return tier === null ? 'Unrated' : `Tier ${tier}`;
}

/** Boilerplate progression copy, hardcoded like the design's own JSX (not data-driven —
 *  the specific documents named here belong to the onboarding flow, not this screen). */
function tierProgressionLine(tier: TrustTier | null): string | null {
  switch (tier) {
    case null: return 'Complete verification to start earning trust tiers.';
    case 1: return 'Reach Tier 2 by completing your BIR registration and 5 awarded requirements.';
    case 2: return "Reach Tier 3 by adding your Mayor's permit and completing 10 awarded requirements.";
    case 3: return null;
  }
}

type Signal = { label: string; hint: string; urgent: boolean } | null;

function computeSignal(requirement: Requirement, hoursLeft: number, closed: boolean, matched: boolean, now: number): Signal {
  if (!closed && hoursLeft < 24) {
    return { label: 'Closing soon', hint: 'This requirement closes in under 24 hours.', urgent: true };
  }
  const publishedMsAgo = requirement.publishedAt ? now - new Date(requirement.publishedAt).getTime() : Infinity;
  if (publishedMsAgo < 24 * 3600_000) {
    return { label: 'New', hint: 'Posted since your last visit.', urgent: false };
  }
  if (requirement.quotationCount >= 8) {
    return { label: 'High demand', hint: `${requirement.quotationCount} businesses have already sent quotations.`, urgent: false };
  }
  if (matched) {
    return { label: 'Matched', hint: 'Trustlink matched this to your business profile.', urgent: false };
  }
  return null;
}

function matchReason(buyerCity: string, viewer: Business): string {
  const capability = (viewer.capabilities[0] ?? viewer.category).toLowerCase();
  if (buyerCity === viewer.city) {
    return `Same category as your business, and the site is in ${viewer.city} — your service area. Your profile lists ${capability}.`;
  }
  return `Same category as your business. ${buyerCity} is within your listed delivery range, and the scope fits your ${capability} capability.`;
}

/* ─── Small building blocks ─────────────────────────── */

function VerifiedTag({ verifiedAt }: { verifiedAt: ISODateTime | null }) {
  if (!verifiedAt) return null;
  return (
    <View style={styles.verifiedTag}>
      <Text style={styles.verifiedTagLabel}>Verified {formatMonthYear(verifiedAt)}</Text>
    </View>
  );
}

function TierTag({ tier }: { tier: TrustTier | null }) {
  return (
    <View style={styles.tierTag}>
      <Text style={styles.tierTagLabel}>{tierLabel(tier)}</Text>
    </View>
  );
}

/* Simple shape-built glyphs — no icon library, same precedent as RequirementDetail.tsx's
 * plain-shape/dot icons and its ↑/↓ sort-direction text glyphs. */

function CategoryIcon({ tone = color.primary }: { tone?: string }) {
  return (
    <View style={[styles.categoryIcon, { borderColor: tone }]}>
      <View style={[styles.categoryIconLine, { backgroundColor: tone }]} />
    </View>
  );
}

function PinIcon({ tone = color.primary }: { tone?: string }) {
  return (
    <View style={[styles.pinIcon, { borderColor: tone }]}>
      <View style={[styles.pinIconDot, { backgroundColor: tone }]} />
    </View>
  );
}

function BookmarkIcon({ filled, tone }: { filled: boolean; tone: string }) {
  return <View style={[styles.bookmarkIcon, { borderColor: tone, backgroundColor: filled ? tone : 'transparent' }]} />;
}

function ArrowIcon({ tone }: { tone: string }) {
  return (
    <View style={styles.arrowIconRow}>
      <View style={[styles.arrowIconLine, { backgroundColor: tone }]} />
      <View style={[styles.arrowIconHead, { borderColor: tone }]} />
    </View>
  );
}

type ButtonVariant = 'primary' | 'outline' | 'text' | 'tinted';

function FeedButton({
  label,
  onPress,
  variant = 'outline',
  disabled = false,
  icon,
}: {
  label: string;
  onPress?: () => void;
  variant?: ButtonVariant;
  disabled?: boolean;
  icon?: ReactNode;
}) {
  return (
    <Pressable
      onPress={disabled ? undefined : onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.feedButton,
        {
          backgroundColor:
            variant === 'primary' ? (pressed ? color.primaryPressed : color.primary)
            : variant === 'tinted' ? color.primaryFaint
            : variant === 'text' ? 'transparent'
            : 'transparent',
          borderColor: variant === 'primary' ? color.primary : variant === 'tinted' ? color.primaryBorder : variant === 'text' ? 'transparent' : color.border,
          opacity: disabled ? 0.6 : pressed ? 0.85 : 1,
        },
      ]}
    >
      <View style={styles.feedButtonContent}>
        {icon}
        <Text
          style={[
            styles.feedButtonLabel,
            { color: variant === 'primary' ? color.onPrimary : variant === 'tinted' || variant === 'text' ? color.primary : color.inkMuted },
          ]}
        >
          {label}
        </Text>
      </View>
    </Pressable>
  );
}

function PulseDot({ dotColor, pulse }: { dotColor: string; pulse: boolean }) {
  const opacity = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (!pulse) {
      opacity.setValue(1);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 0.25, duration: 700, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 1, duration: 700, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse, opacity]);
  return <Animated.View style={[styles.dot, { backgroundColor: dotColor, opacity }]} />;
}

/* ─── Header pieces ─────────────────────────────────── */

function ThreadRow({ thread, now, onPress }: { thread: MessageThread; now: number; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={styles.threadRow}>
      <AvatarChip label={initials(thread.counterpartyName)} size={30} dark={!thread.unread} />
      <View style={{ flex: 1, minWidth: 0, gap: space.xs }}>
        <View style={styles.alertTopRow}>
          <Text style={[styles.threadName, { fontFamily: thread.unread ? font.bodySemi : font.body }]} numberOfLines={1}>
            {thread.counterpartyName}
          </Text>
          <Text style={styles.alertTime}>{timeAgoCompact(thread.lastMessageAt, now)}</Text>
        </View>
        <Text style={[styles.threadPreview, { color: thread.unread ? color.inkMuted : color.inkFaint }]} numberOfLines={1}>
          {thread.lastMessagePreview}
        </Text>
        <Text style={styles.threadRef}>{thread.requirementRef}</Text>
      </View>
      {thread.unread && <View style={styles.dot} />}
    </Pressable>
  );
}

/* ─── Messages dock: a list card plus independent conversation windows ──
 * Web only — same Platform.OS-gated check the sticky sidebar's stickyOnWeb/fixedOnWeb use
 * elsewhere in this file, just returning null outright instead of swapping a style, since a
 * floating dock has no sensible native/phone equivalent. Fixed to the bottom-right on web
 * via fixedOnWeb.
 *
 * Every item in the dock — the thread-list card and each open conversation — is built the
 * same way: a fixed-height header pinned to the bottom edge, with a content pane above it
 * whose `height` alone is what GrowPanel animates between 0 (collapsed: the card *is* just
 * its header) and DOCK_OPEN_HEIGHT (expanded). Nothing ever slides or repositions; only that
 * height changes, so a header never moves relative to the bottom edge it's docked to.
 *
 * They lay out left-to-right in one row, right edge pinned via the container's own `right`
 * offset so the row grows leftward as windows open: conversation windows first (oldest
 * furthest left, newest nearest the list), then the thread-list card last, which is why its
 * position never shifts as windows come and go. Selecting a thread from the list does not
 * touch the list itself — it opens a new conversation window beside it (or re-expands one
 * already open), and both stay visible at once; multiple conversations can be open
 * side by side.
 *
 * Each conversation window carries its own collapse and close controls, independent of the
 * list card's: collapse just re-targets its GrowPanel height back to 0 without unmounting
 * (no data loss — the draft and scroll position are still there when it re-expands), while
 * close does the same height animation and then, once it finishes, actually drops the
 * window from state via GrowPanel's `onClosed` — the same deferred-unmount idea
 * Onboarding.tsx/PostRequirement.tsx use for their outgoing step. `onClosed` also fires after
 * an ordinary collapse, so the callers below only act on it when a close was actually in
 * flight.
 *
 * Threads are never created here — the only way one exists is passed in via `threads`,
 * which by construction (see MessageThread's doc comment) only ever holds threads a buyer
 * and their awarded respondent already share. Plain text only: the composer is a single
 * TextInput, no attachment affordance — documents live on the quotation, not the thread. */

const DOCK_OPEN_HEIGHT = 400;
const DOCK_ANIM_MS = 220;

function MessageBubble({ message, mine }: { message: Message; mine: boolean }) {
  return (
    <View style={[styles.bubbleRow, mine ? styles.bubbleRowMine : null]}>
      <View style={[styles.bubble, mine ? styles.bubbleMine : styles.bubbleTheirs]}>
        <Text style={styles.bubbleText}>{message.body}</Text>
      </View>
      <Text style={styles.bubbleTime}>{formatClockTime(message.sentAt)}</Text>
    </View>
  );
}

function TrustlinkMark() {
  return <Image source={require('../../assets/logo.jpg')} style={styles.dockMark} resizeMode="contain" />;
}

function CloseGlyph() {
  return (
    <View style={styles.closeGlyphBox}>
      <View style={[styles.closeGlyphBar, { transform: [{ rotate: '45deg' }] }]} />
      <View style={[styles.closeGlyphBar, { transform: [{ rotate: '-45deg' }] }]} />
    </View>
  );
}

function ChevronGlyph({ up }: { up: boolean }) {
  return <View style={[styles.dockChevron, up ? styles.dockChevronUp : null]} />;
}

/** Animates only `height`, between 0 and DOCK_OPEN_HEIGHT — no translateY. overflow:hidden
 *  clips the pane away at height 0, which is what makes the header below look like a plain
 *  closed bar. Children stay mounted throughout (collapsing never unmounts), so `onClosed`
 *  — fired once an animation *into* the closed state finishes — doesn't distinguish a
 *  deliberate close from an ordinary collapse; callers that care check their own state. */
function GrowPanel({
  open,
  onClosed,
  style,
  children,
}: {
  open: boolean;
  onClosed?: () => void;
  style?: ViewStyle;
  children: ReactNode;
}) {
  const height = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(height, { toValue: open ? DOCK_OPEN_HEIGHT : 0, duration: DOCK_ANIM_MS, useNativeDriver: false }).start(({ finished }) => {
      if (finished && !open) onClosed?.();
    });
  }, [open, height, onClosed]);
  return <Animated.View style={[style, { height, overflow: 'hidden' }]}>{children}</Animated.View>;
}

function ThreadListCard({
  threads,
  now,
  open,
  onToggleOpen,
  onSelectThread,
  width,
}: {
  threads: MessageThread[];
  now: number;
  open: boolean;
  onToggleOpen: () => void;
  onSelectThread: (id: string) => void;
  width: number;
}) {
  const unread = threads.filter((t) => t.unread).length;
  return (
    <View style={[styles.dockPanel, { width }]}>
      <GrowPanel open={open}>
        {threads.length === 0 ? (
          <View style={styles.dockEmpty}>
            <Text style={styles.dockEmptyText}>
              No conversations yet. Messaging opens once a requirement you&apos;re part of is awarded.
            </Text>
          </View>
        ) : (
          <ScrollView style={styles.dockScroll}>
            {threads.map((t) => (
              <ThreadRow key={t.id} thread={t} now={now} onPress={() => onSelectThread(t.id)} />
            ))}
          </ScrollView>
        )}
      </GrowPanel>

      <Pressable onPress={onToggleOpen} style={[styles.dockBar, open ? styles.dockBarOpen : null]}>
        <TrustlinkMark />
        <Text style={styles.dockBarLabel}>Messages</Text>
        <View style={{ flex: 1 }} />
        {unread > 0 && (
          <View style={styles.chatBadge}>
            <Text style={styles.chatBadgeLabel}>{unread}</Text>
          </View>
        )}
      </Pressable>
    </View>
  );
}

function ConversationWindow({
  thread,
  messages,
  viewerId,
  collapsed,
  closing,
  onToggleCollapse,
  onClose,
  onClosed,
  onSend,
  width,
}: {
  thread: MessageThread;
  messages: Message[];
  viewerId: BusinessId;
  collapsed: boolean;
  closing: boolean;
  onToggleCollapse: () => void;
  onClose: () => void;
  onClosed: () => void;
  onSend: (body: string) => void;
  width: number;
}) {
  const [draft, setDraft] = useState('');
  const scrollRef = useRef<ScrollView>(null);
  const open = !collapsed && !closing;

  const handleSend = () => {
    const body = draft.trim();
    if (!body) return;
    onSend(body);
    setDraft('');
  };

  return (
    <View style={[styles.dockPanel, { width }]}>
      {/* onClosed only wired while an actual close is in flight — an ordinary collapse
       *  also animates height to 0, but must not trigger the deferred unmount below. */}
      <GrowPanel open={open} onClosed={closing ? onClosed : undefined}>
        <View style={{ flex: 1 }}>
          <ScrollView
            ref={scrollRef}
            style={styles.dockScroll}
            contentContainerStyle={styles.bubbleList}
            onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: false })}
          >
            {messages.map((m) => (
              <MessageBubble key={m.id} message={m} mine={m.senderId === viewerId} />
            ))}
          </ScrollView>
          <View style={styles.composerRow}>
            <TextInput
              value={draft}
              onChangeText={setDraft}
              placeholder="Write a message"
              placeholderTextColor={color.inkFaint}
              style={styles.composerInput}
              multiline
              onSubmitEditing={handleSend}
            />
            <Pressable onPress={handleSend} disabled={!draft.trim()} style={[styles.composerSend, !draft.trim() ? { opacity: 0.4 } : null]}>
              <Text style={styles.composerSendLabel}>Send</Text>
            </Pressable>
          </View>
        </View>
      </GrowPanel>

      <View style={[styles.dockBar, open ? styles.dockBarOpen : null]}>
        <Pressable onPress={onToggleCollapse} hitSlop={8} style={styles.dockHeaderPress}>
          <ChevronGlyph up={open} />
          <View style={{ minWidth: 0 }}>
            <Text style={styles.dockBarLabel} numberOfLines={1}>{thread.counterpartyName}</Text>
            <Text style={styles.dockMeta}>{thread.requirementRef}</Text>
          </View>
        </Pressable>
        <View style={{ flex: 1 }} />
        <Pressable onPress={onClose} hitSlop={8}>
          <CloseGlyph />
        </Pressable>
      </View>
    </View>
  );
}

function ChatWidget({
  threads,
  messagesByThread,
  viewerId,
  now,
  onSend,
  onOpenThread,
  autoOpenThreadId,
}: {
  threads: MessageThread[];
  messagesByThread: Record<string, Message[]>;
  viewerId: BusinessId;
  now: number;
  /** Parent persists the message for real; this component's own sentByThread
   *  state is only what makes it appear instantly, before that round-trip returns. */
  onSend?: (threadId: string, body: string) => void;
  /** Fired once per thread the moment its conversation window opens — the parent's
   *  cue to mark the thread read on the server. */
  onOpenThread?: (threadId: string) => void;
  /** Deep-link from elsewhere (e.g. Requirement Detail's "Message" button) —
   *  opens this thread's conversation window the moment it shows up in `threads`. */
  autoOpenThreadId?: string;
}) {
  const [listOpen, setListOpen] = useState(false);
  const [openThreadIds, setOpenThreadIds] = useState<string[]>([]);
  const [collapsedThreadIds, setCollapsedThreadIds] = useState<Set<string>>(new Set());
  const [closingThreadIds, setClosingThreadIds] = useState<Set<string>>(new Set());
  const [sentByThread, setSentByThread] = useState<Record<string, Message[]>>({});
  const { width } = useWindowDimensions();
  const panelWidth = Math.min(320, width - 40);
  const autoOpenedRef = useRef<string | null>(null);

  const toggleList = () => setListOpen((v) => !v);

  const openThread = (id: string) => {
    setOpenThreadIds((prev) => (prev.includes(id) ? prev : [...prev, id]));
    setCollapsedThreadIds((prev) => (prev.has(id) ? new Set([...prev].filter((x) => x !== id)) : prev));
    setClosingThreadIds((prev) => (prev.has(id) ? new Set([...prev].filter((x) => x !== id)) : prev));
    onOpenThread?.(id);
  };
  useEffect(() => {
    if (!autoOpenThreadId || autoOpenedRef.current === autoOpenThreadId) return;
    if (!threads.some((t) => t.id === autoOpenThreadId)) return; // still loading
    autoOpenedRef.current = autoOpenThreadId;
    setListOpen(true);
    openThread(autoOpenThreadId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoOpenThreadId, threads]);

  const toggleCollapseThread = (id: string) =>
    setCollapsedThreadIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  const requestCloseThread = (id: string) => setClosingThreadIds((prev) => new Set(prev).add(id));
  const finalizeCloseThread = (id: string) => {
    setOpenThreadIds((prev) => prev.filter((t) => t !== id));
    setClosingThreadIds((prev) => new Set([...prev].filter((x) => x !== id)));
  };

  const sendMessage = (threadId: string, body: string) => {
    const message: Message = {
      id: `m-local-${Date.now()}`,
      threadId,
      senderId: viewerId,
      body,
      sentAt: new Date().toISOString(),
      read: true,
    };
    setSentByThread((prev) => ({ ...prev, [threadId]: [...(prev[threadId] ?? []), message] }));
    onSend?.(threadId, body);
  };

  if (Platform.OS !== 'web') return null;

  return (
    <View style={[styles.chatWidget, fixedOnWeb]} pointerEvents="box-none">
      {openThreadIds.map((id) => {
        const thread = threads.find((t) => t.id === id);
        if (!thread) return null;
        return (
          <ConversationWindow
            key={id}
            thread={thread}
            messages={[...(messagesByThread[id] ?? []), ...(sentByThread[id] ?? [])]}
            viewerId={viewerId}
            collapsed={collapsedThreadIds.has(id)}
            closing={closingThreadIds.has(id)}
            onToggleCollapse={() => toggleCollapseThread(id)}
            onClose={() => requestCloseThread(id)}
            onClosed={() => finalizeCloseThread(id)}
            onSend={(body) => sendMessage(id, body)}
            width={panelWidth}
          />
        );
      })}

      <ThreadListCard
        threads={threads}
        now={now}
        open={listOpen}
        onToggleOpen={toggleList}
        onSelectThread={openThread}
        width={panelWidth}
      />
    </View>
  );
}

/* ─── Category filter ───────────────────────────────── */

function CategoryPills({
  categories,
  active,
  onSelect,
}: {
  categories: { name: string; count: number }[];
  active: string;
  onSelect: (name: string) => void;
}) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.categoryRow}>
      {categories.map((c) => {
        const on = c.name === active;
        return (
          <Pressable
            key={c.name}
            onPress={() => onSelect(c.name)}
            style={[styles.categoryPill, on ? styles.categoryPillActive : null]}
          >
            <Text style={[styles.categoryPillLabel, on ? styles.categoryPillLabelActive : null]}>{c.name}</Text>
            <Text style={[styles.categoryPillCount, on ? styles.categoryPillCountActive : null]}>{c.count}</Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

/* ─── Profile sidebar ───────────────────────────────── */

function ProfileCard({ viewer, onAddMayorsPermit }: { viewer: Business; onAddMayorsPermit?: () => void }) {
  const name = viewer.displayName ?? viewer.registeredName;
  const tier = viewer.credibility.tier;
  return (
    <View style={styles.profileCard}>
      <View style={styles.profileTopRow}>
        <AvatarChip label={initials(name)} size={44} />
        <View style={{ minWidth: 0, flex: 1 }}>
          <Text style={styles.profileName}>{name}</Text>
          {viewer.credibility.status === 'VERIFIED' && (
            <Text style={styles.profileVerified}>Verified business</Text>
          )}
        </View>
      </View>

      <View style={styles.profileFactList}>
        <View style={styles.profileFactRow}>
          <CategoryIcon />
          <Text style={styles.profileFact}>{viewer.category}</Text>
        </View>
        <View style={styles.profileFactRow}>
          <PinIcon />
          <Text style={styles.profileFact}>{viewer.city}, {viewer.province}</Text>
        </View>
      </View>

      <View style={styles.profileSection}>
        <View style={styles.profileSectionRow}>
          <Text style={styles.microLabel}>Trust tier</Text>
          <Text style={styles.profileSectionValue}>{tierLabel(tier)} of 3</Text>
        </View>
        <View style={styles.tierBarRow}>
          {[1, 2, 3].map((n) => (
            <View key={n} style={[styles.tierBarSegment, tier !== null && n <= tier ? styles.tierBarSegmentFilled : null]} />
          ))}
        </View>
        <Text style={styles.profileSectionCaption}>
          {viewer.credibility.verifiedAt ? `Verified ${formatMonthYear(viewer.credibility.verifiedAt)}` : 'Not yet verified'}
          {viewer.credibility.recheckDueAt ? ` · re-check due ${formatMonthYear(viewer.credibility.recheckDueAt)}.` : '.'}
          {tierProgressionLine(tier) ? ` ${tierProgressionLine(tier)}` : ''}
        </Text>
      </View>

      <View style={styles.profileSection}>
        <View style={styles.profileSectionRow}>
          <Text style={styles.microLabel}>Profile completion</Text>
          <Text style={styles.profileSectionValueMono}>{viewer.profileCompletionPct}%</Text>
        </View>
        <View style={styles.progressTrack}>
          <View style={[styles.progressFill, { width: `${viewer.profileCompletionPct}%` }]} />
        </View>
        {tier === 1 && (
          <Pressable style={styles.profileNextStep} onPress={onAddMayorsPermit}>
            <Text style={styles.profileNextStepLabel}>Add your Mayor&apos;s permit</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

function ActivityStatsCard({ viewer }: { viewer: Business }) {
  const c = viewer.credibility;
  const rows: { label: string; value: string }[] = [
    { label: 'Requirements posted', value: String(c.requirementsPosted) },
    { label: 'Quotations submitted', value: String(c.quotationsSubmitted) },
    { label: 'Requirements awarded to you', value: String(c.requirementsAwarded) },
    { label: 'On Trustlink since', value: String(viewer.memberSinceYear) },
  ];
  return (
    <View style={styles.statsCard}>
      <Text style={styles.microLabel}>Your activity on Trustlink</Text>
      <View style={{ marginTop: space.md }}>
        {rows.map((r) => (
          <View key={r.label} style={styles.statRow}>
            <Text style={styles.statLabel}>{r.label}</Text>
            <Text style={styles.statValue}>{r.value}</Text>
          </View>
        ))}
      </View>
      <Text style={styles.statsCaption}>
        Buyers see these counts on your profile. Responding to more requirements raises your standing.
      </Text>
    </View>
  );
}

function CtaBanner({
  verified,
  onPostRequirement,
  onCompleteVerification,
  hasPreviousRequirement,
  onUsePreviousRequirement,
}: {
  verified: boolean;
  onPostRequirement?: () => void;
  onCompleteVerification?: () => void;
  hasPreviousRequirement: boolean;
  onUsePreviousRequirement?: () => void;
}) {
  return (
    <View style={styles.ctaBanner}>
      <View style={{ flexShrink: 1, minWidth: 200, gap: space.xs }}>
        <Text style={styles.ctaTitle}>Need suppliers, contractors, or business partners?</Text>
        <Text style={styles.ctaSubtitle}>
          {verified
            ? 'Reach verified businesses in your industry.'
            : 'Complete verification to post a requirement and reach verified businesses.'}
        </Text>
      </View>
      <View style={styles.ctaActions}>
        {verified ? (
          <FeedButton label="Post a Requirement" variant="primary" onPress={onPostRequirement} />
        ) : (
          <FeedButton label="Complete Verification" variant="primary" onPress={onCompleteVerification} />
        )}
        {verified && hasPreviousRequirement && (
          <FeedButton label="Use Previous Requirement" variant="outline" onPress={onUsePreviousRequirement} />
        )}
      </View>
    </View>
  );
}

/* ─── Feed card ──────────────────────────────────────── */

/** `transitionProperty`/`transitionDuration` aren't in RN's ViewStyle type — react-native-web
 *  passes them straight through to CSS, same escape hatch as stickyOnWeb/fixedOnWeb below.
 *  Native has no hover state to transition, so this is a no-op there. */
const cardHoverTransitionOnWeb: ViewStyle =
  Platform.OS === 'web'
    ? ({
        transitionProperty: 'transform, border-color',
        transitionDuration: '150ms',
        transitionTimingFunction: 'ease-out',
      } as unknown as ViewStyle)
    : {};

function RequirementCard({
  requirement,
  buyer,
  viewer,
  now,
  saved,
  quoted,
  onToggleSave,
  onSubmitQuotation,
  onSelect,
}: {
  requirement: Requirement;
  buyer: FeedBuyer;
  viewer: Business;
  now: number;
  saved: boolean;
  quoted: boolean;
  onToggleSave: () => void;
  onSubmitQuotation: () => void;
  onSelect: () => void;
}) {
  const { label: countdownLabel, closed, hoursLeft } = formatCompactCountdown(requirement.closingAt, now);
  const matched = requirement.category === viewer.category;
  const signal = computeSignal(requirement, hoursLeft, closed, matched, now);
  const urgent = !closed && hoursLeft < 24;
  const critical = !closed && hoursLeft < 6;
  const buyerName = buyer.displayName ?? buyer.registeredName;
  const [hovered, setHovered] = useState(false);

  return (
    <Pressable
      onPress={onSelect}
      {...(Platform.OS === 'web'
        ? { onHoverIn: () => setHovered(true), onHoverOut: () => setHovered(false) }
        : null)}
      style={[
        styles.card,
        cardHoverTransitionOnWeb,
        { borderColor: urgent ? (hovered ? color.danger : color.dangerBorder) : hovered ? color.borderStrong : color.border },
        hovered ? styles.cardHovered : null,
        matched ? styles.cardMatched : null,
      ]}
    >
      <View style={styles.cardTopRow}>
        <View style={styles.categoryBadge}>
          <Text style={styles.categoryBadgeLabel}>{requirement.category}</Text>
        </View>
        {signal && (
          <View style={[styles.signalBadge, signal.urgent ? styles.signalBadgeUrgent : null]}>
            <Text style={[styles.signalBadgeLabel, signal.urgent ? styles.signalBadgeLabelUrgent : null]}>{signal.label}</Text>
          </View>
        )}
        <View style={{ flex: 1 }} />
        <Text style={styles.cardRef}>{requirement.ref} · posted {requirement.publishedAt ? timeAgoWords(requirement.publishedAt, now) : ''}</Text>
      </View>

      <Text style={styles.cardTitle}>{requirement.title}</Text>

      <View style={styles.buyerRow}>
        <AvatarChip label={initials(buyerName)} size={32} />
        <View style={{ minWidth: 0, flex: 1, gap: space.xs }}>
          <View style={styles.buyerNameRow}>
            <Text style={styles.buyerName}>{buyerName}</Text>
            <VerifiedTag verifiedAt={buyer.credibility.verifiedAt} />
            <TierTag tier={buyer.credibility.tier} />
          </View>
          <Text style={styles.mutedSmall}>
            {buyer.credibility.requirementsPosted} requirements posted · {buyer.credibility.requirementsAwarded} awarded on Trustlink
          </Text>
        </View>
      </View>

      <View style={styles.factsRow}>
        <View style={styles.factItem}>
          <Text style={styles.microLabel}>Budget</Text>
          <Text style={styles.factValue}>{formatBudget(requirement.budgetMin, requirement.budgetMax)}</Text>
        </View>
        <View style={styles.factItem}>
          <Text style={styles.microLabel}>Location</Text>
          <Text style={styles.factValue}>{buyer.city}</Text>
        </View>
        <View style={styles.factItem}>
          <Text style={styles.microLabel}>Quotations received</Text>
          <Text style={styles.factValue}>
            {requirement.quotationCount} quotation{requirement.quotationCount === 1 ? '' : 's'}
            {requirement.lastQuotationAt ? ` · latest ${timeAgoWords(requirement.lastQuotationAt, now)}` : ''}
          </Text>
        </View>
      </View>

      {matched && (
        <View style={styles.matchBox}>
          <Text style={styles.microLabel}>Why this matches</Text>
          <Text style={styles.matchReasonText}>{matchReason(buyer.city, viewer)}</Text>
        </View>
      )}

      <View style={styles.cardFooter}>
        <View style={styles.countdownRow}>
          <PulseDot dotColor={urgent ? color.danger : color.inkMuted} pulse={critical} />
          <Text style={styles.countdownLabelText}>Closes in</Text>
          <Text style={[styles.countdownValue, { color: urgent ? color.danger : color.inkMuted }]}>{countdownLabel}</Text>
        </View>
        <View style={{ flex: 1 }} />
        <FeedButton
          label={saved ? 'Saved' : 'Save'}
          variant={saved ? 'tinted' : 'outline'}
          onPress={onToggleSave}
          icon={<BookmarkIcon filled={saved} tone={saved ? color.primary : color.inkMuted} />}
        />
        <FeedButton label="View requirement" variant="outline" onPress={onSelect} />
        <FeedButton
          label={quoted ? 'Quotation sent' : 'Submit quotation'}
          variant={quoted ? 'text' : 'primary'}
          disabled={quoted}
          onPress={onSubmitQuotation}
          icon={!quoted ? <ArrowIcon tone={color.onPrimary} /> : undefined}
        />
      </View>
    </Pressable>
  );
}

/* ─── Your requirements / recently closed / closing soon ── */

function MyRequirementRow({
  requirement,
  now,
  onSelect,
}: {
  requirement: Requirement;
  now: number;
  onSelect?: () => void;
}) {
  const { hoursLeft, closed } = formatCompactCountdown(requirement.closingAt, now);
  let statusLabel: string;
  let statusColor: string;
  if (requirement.status === 'OPEN' && !closed && hoursLeft < 24) {
    statusLabel = `Closing in ${Math.max(1, Math.ceil(hoursLeft))}h`;
    statusColor = color.danger;
  } else if (requirement.status === 'OPEN') {
    statusLabel = 'Open';
    statusColor = color.primary;
  } else {
    statusLabel = requirementStatusLabel(requirement.status);
    statusColor = color.inkFaint;
  }
  const posted = requirement.publishedAt ? `Posted ${timeAgoWords(requirement.publishedAt, now)}` : 'Not yet published';
  const meta = `${posted} · ${requirement.category} · ${requirement.deliverySite.address} · ${formatBudget(requirement.budgetMin, requirement.budgetMax)}`;

  return (
    <View style={styles.myReqRow}>
      <View style={{ flex: 1, minWidth: 200, gap: space.xs }}>
        <View style={styles.myReqStatusRow}>
          <View style={[styles.dot, { backgroundColor: statusColor }]} />
          <Text style={[styles.myReqStatusLabel, { color: statusColor }]}>{statusLabel}</Text>
          <Text style={styles.cardRef}>{requirement.ref}</Text>
        </View>
        <Text style={styles.myReqTitle}>{requirement.title}</Text>
        <Text style={styles.mutedSmall}>{meta}</Text>
      </View>
      <View style={styles.myReqRight}>
        <View style={{ alignItems: 'flex-end' }}>
          <Text style={styles.myReqCount}>{requirement.quotationCount}</Text>
          <Text style={styles.microLabel}>Quotations</Text>
        </View>
        <FeedButton
          label={requirement.status === 'AWARDED' ? 'View award' : 'Review quotations'}
          variant="outline"
          onPress={onSelect}
        />
      </View>
    </View>
  );
}

function ClosedRequirementRow({ requirement, buyerName, now }: { requirement: Requirement; buyerName: string; now: number }) {
  const outcome =
    requirement.status === 'AWARDED'
      ? { label: `Awarded · ${requirement.quotationCount} quotation${requirement.quotationCount === 1 ? '' : 's'}`, color: color.primary, border: color.primaryBorder }
      : { label: 'Closed · no quotations received', color: color.inkFaint, border: color.border };
  const meta = `${buyerName} · ${requirement.deliverySite.address} · ${formatBudget(requirement.budgetMin, requirement.budgetMax)}`;

  return (
    <View style={styles.closedRow}>
      <View style={{ flex: 1, minWidth: 220, gap: space.xs }}>
        <View style={styles.myReqStatusRow}>
          <View style={styles.categoryBadgeMuted}>
            <Text style={styles.categoryBadgeMutedLabel}>{requirement.category}</Text>
          </View>
          <Text style={styles.cardRef}>{requirement.ref} · closed {requirement.publishedAt ? timeAgoWords(requirement.closingAt, now) : ''}</Text>
        </View>
        <Text style={styles.closedTitle}>{requirement.title}</Text>
        <Text style={styles.mutedSmall}>{meta}</Text>
      </View>
      <View style={[styles.outcomeTag, { borderColor: outcome.border }]}>
        <View style={[styles.dot, { backgroundColor: outcome.color }]} />
        <Text style={[styles.outcomeLabel, { color: outcome.color }]}>{outcome.label}</Text>
      </View>
    </View>
  );
}

function ClosingSoonItem({ requirement, buyerName, now, onSelect }: { requirement: Requirement; buyerName: string; now: number; onSelect: () => void }) {
  const { hoursLeft, closed } = formatCompactCountdown(requirement.closingAt, now);
  return (
    <Pressable style={styles.closingSoonRow} onPress={onSelect}>
      <Text style={styles.closingSoonTitle} numberOfLines={2}>{requirement.title}</Text>
      <Text style={styles.mutedSmall}>{buyerName} · {formatBudget(requirement.budgetMin, requirement.budgetMax)}</Text>
      <View style={styles.myReqStatusRow}>
        <View style={[styles.dot, { backgroundColor: color.danger }]} />
        <Text style={[styles.closingSoonCountdown]}>{shortCountdown(hoursLeft, closed)}</Text>
      </View>
    </Pressable>
  );
}

function HowMatchingWorksCard({ onUpdateCapabilities }: { onUpdateCapabilities?: () => void }) {
  return (
    <View style={styles.statsCard}>
      <Text style={styles.microLabel}>How matching works</Text>
      <Text style={styles.howMatchingBody}>
        Trustlink compares each new requirement against your category, service area, and the capabilities listed on
        your profile. Matched opportunities carry a blue edge and a written reason.
      </Text>
      <Pressable onPress={onUpdateCapabilities} style={{ marginTop: space.md }}>
        <Text style={styles.profileNextStepLabel}>Update your capabilities</Text>
      </Pressable>
    </View>
  );
}

/* ─── Shared state hook ─────────────────────────────── */

function useHomeFeed(props: HomeFeedProps) {
  const { viewer, requirements, requirementBuyers, searchQuery } = props;
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const [categoryFilter, setCategoryFilter] = useState('All');
  const [sessionQuoted, setSessionQuoted] = useState<Set<string>>(new Set());

  const query = (searchQuery ?? '').trim().toLowerCase();
  const searchMatched = requirements.filter((r) => {
    if (!query) return true;
    const buyer = requirementBuyers[r.buyerId];
    const haystack = [
      r.title,
      r.category,
      r.scope,
      r.deliverySite.name,
      r.deliverySite.address,
      buyer?.registeredName,
      buyer?.displayName,
      buyer?.city,
      buyer?.province,
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    return haystack.includes(query);
  });

  const categoryNames = Array.from(new Set(searchMatched.map((r) => r.category)));
  const categories = ['All', ...categoryNames].map((name) => ({
    name,
    count: name === 'All' ? searchMatched.length : searchMatched.filter((r) => r.category === name).length,
  }));

  const filtered = searchMatched.filter((r) => categoryFilter === 'All' || r.category === categoryFilter);
  const matchedCount = filtered.filter((r) => r.category === viewer.category).length;
  const resultLabel = query
    ? `${filtered.length} Result${filtered.length === 1 ? '' : 's'} for "${searchQuery!.trim()}"`
    : `${filtered.length} Open · ${matchedCount} Matched to You`;

  const submitQuotation = (id: string) => {
    setSessionQuoted((prev) => new Set(prev).add(id));
    props.onSubmitQuotation?.(id);
  };

  const closingSoon = requirements
    .map((r) => ({ requirement: r, ...formatCompactCountdown(r.closingAt, now) }))
    .filter((r) => !r.closed && r.hoursLeft < 24)
    .sort((a, b) => a.hoursLeft - b.hoursLeft)
    .slice(0, 4);

  return {
    now,
    categories,
    categoryFilter,
    setCategoryFilter,
    filtered,
    resultLabel,
    queryDisplay: (searchQuery ?? '').trim(),
    sessionQuoted,
    submitQuotation,
    closingSoon,
  };
}

function NoOpportunitiesRow({ query }: { query: string }) {
  return (
    <View style={styles.emptyOpportunities}>
      <Text style={styles.mutedSmall}>
        {query ? `No open requirements match "${query}".` : 'No open requirements right now — check back soon.'}
      </Text>
    </View>
  );
}

/* ─── Phone layout ───────────────────────────────────── */

function PhoneHomeFeed(props: HomeFeedProps) {
  const st = useHomeFeed(props);
  const { viewer, myRequirements, recentlyClosed, requirementBuyers, messageThreads, messagesByThread } = props;

  return (
    <View style={styles.root}>
    <ScreenScroll style={styles.root} contentContainerStyle={styles.scrollContent}>
      <View style={styles.page}>
        <CategoryPills categories={st.categories} active={st.categoryFilter} onSelect={st.setCategoryFilter} />
        <ProfileCard viewer={viewer} onAddMayorsPermit={props.onAddMayorsPermit} />
        <ActivityStatsCard viewer={viewer} />
        <CtaBanner
          verified={viewer.credibility.status === 'VERIFIED'}
          onPostRequirement={props.onPostRequirement}
          onCompleteVerification={props.onCompleteVerification}
          hasPreviousRequirement={myRequirements.length > 0 || recentlyClosed.length > 0}
          onUsePreviousRequirement={props.onUsePreviousRequirement}
        />

        <View style={styles.sectionHeaderRow}>
          <Text style={styles.sectionHeading}>Business Opportunities</Text>
          <Text style={styles.microLabel}>{st.resultLabel}</Text>
        </View>
        <View style={{ gap: space.md }}>
          {st.filtered.length === 0 && <NoOpportunitiesRow query={st.queryDisplay} />}
          {st.filtered.map((r) => (
            <RequirementCard
              key={r.id}
              requirement={r}
              buyer={requirementBuyers[r.buyerId]}
              viewer={viewer}
              now={st.now}
              saved={r.isSaved}
              quoted={st.sessionQuoted.has(r.id)}
              onToggleSave={() => props.onToggleSave?.(r.id, !r.isSaved)}
              onSubmitQuotation={() => st.submitQuotation(r.id)}
              onSelect={() => props.onSelectRequirement?.(r.id)}
            />
          ))}
        </View>

        <View style={styles.sectionBlock}>
          <View style={styles.sectionHeaderRow}>
            <Text style={styles.sectionHeading}>Your requirements</Text>
            <Pressable onPress={() => props.onManageRequirements?.()}><Text style={styles.manageAllLink}>Manage all</Text></Pressable>
          </View>
          <View style={{ gap: space.md }}>
            {myRequirements.map((r) => (
              <MyRequirementRow key={r.id} requirement={r} now={st.now} onSelect={() => props.onSelectRequirement?.(r.id)} />
            ))}
          </View>
        </View>

        <View style={styles.sectionBlock}>
          <View style={styles.sectionHeaderRow}>
            <Text style={styles.sectionHeading}>Recently closed on Trustlink</Text>
            <Text style={styles.microLabel}>Last 7 days</Text>
          </View>
          <Text style={styles.mutedSmall}>
            Outcomes are published once a buyer closes a requirement, so you can see what actually gets awarded in
            your category.
          </Text>
          <View style={{ gap: space.md, marginTop: space.sm }}>
            {recentlyClosed.map((r) => (
              <ClosedRequirementRow key={r.id} requirement={r} buyerName={requirementBuyers[r.buyerId]?.displayName ?? requirementBuyers[r.buyerId]?.registeredName ?? ''} now={st.now} />
            ))}
          </View>
        </View>

        <View style={styles.sectionBlock}>
          <Text style={styles.microLabel}>Closing within 24 hours</Text>
          <View>
            {st.closingSoon.map(({ requirement }) => (
              <ClosingSoonItem
                key={requirement.id}
                requirement={requirement}
                buyerName={requirementBuyers[requirement.buyerId]?.displayName ?? requirementBuyers[requirement.buyerId]?.registeredName ?? ''}
                now={st.now}
                onSelect={() => props.onSelectRequirement?.(requirement.id)}
              />
            ))}
          </View>
        </View>

        <HowMatchingWorksCard onUpdateCapabilities={props.onUpdateCapabilities} />
      </View>
    </ScreenScroll>
    <ChatWidget
      threads={messageThreads}
      messagesByThread={messagesByThread}
      viewerId={viewer.id}
      now={st.now}
      onSend={props.onSendMessage}
      onOpenThread={props.onOpenThread}
      autoOpenThreadId={props.autoOpenThreadId}
    />
    </View>
  );
}

/* ─── Wide layout ─────────────────────────────────────
 * Reproduces docs/design/Trustlink Home Feed.dc.html's structure directly: left sidebar
 * (profile + stats), centre column (CTA, feed, your requirements, recently closed), right
 * sidebar (closing-soon rail, how-matching), floating messages widget. Capped at
 * layout.maxWidthDashboard (1760) — wider than RequirementDetail.tsx's two-column
 * layout.maxWidthWide, since a three-column dashboard needs the extra room, and wider
 * than the source design's own 1720px so the three columns use more of the window on
 * large screens.
 *
 * The top nav chrome (logo, search, primary nav, account block) lives in AppHeader,
 * mounted once above this screen by app/_layout.tsx — it is not part of this component.
 * The category filter row lives in page content (not the header), and on web sticks to
 * the top of this screen's own scroll area — which sits directly below AppHeader — once
 * the user scrolls past it. Its resting position is 0 (nothing else above it in this
 * scroll area); the sidebar, which docks beneath the filter row, derives its offset from
 * the filter row's measured height via onLayout instead of a hardcoded constant. */

const stickyOnWeb: ViewStyle =
  Platform.OS === 'web' ? ({ position: 'sticky', top: 0 } as unknown as ViewStyle) : {};

/** `position: 'fixed'` isn't in RN's own Position type and StyleSheet.create silently
 *  drops it, same reason stickyOnWeb above is merged via the style array instead of
 *  baked into a StyleSheet.create entry. Native has no fixed-to-viewport concept, so it
 *  falls back to absolute (positioned by the nearest positioned ancestor). */
const fixedOnWeb: ViewStyle =
  Platform.OS === 'web' ? ({ position: 'fixed' } as unknown as ViewStyle) : { position: 'absolute' };

function WideHomeFeed(props: HomeFeedProps) {
  const st = useHomeFeed(props);
  const { viewer, myRequirements, recentlyClosed, requirementBuyers, messageThreads, messagesByThread } = props;
  const [categoryHeight, setCategoryHeight] = useState(0);
  const sidebarTop: ViewStyle = Platform.OS === 'web' ? { top: categoryHeight } : {};

  return (
    <View style={styles.root}>
    <ScreenScroll style={styles.root} contentContainerStyle={styles.scrollContentWide}>
      <View
        style={[styles.categorySticky, stickyOnWeb]}
        onLayout={(e) => setCategoryHeight(e.nativeEvent.layout.height)}
      >
        <View style={styles.pageWide}>
          <CategoryPills categories={st.categories} active={st.categoryFilter} onSelect={st.setCategoryFilter} />
        </View>
      </View>

      <View style={styles.pageWide}>
        <View style={styles.columnsWide}>
          <View style={[styles.sideColumn, stickyOnWeb, sidebarTop]}>
            <ProfileCard viewer={viewer} onAddMayorsPermit={props.onAddMayorsPermit} />
            <ActivityStatsCard viewer={viewer} />
          </View>

          <View style={styles.mainColumnWide}>
            <CtaBanner
          verified={viewer.credibility.status === 'VERIFIED'}
          onPostRequirement={props.onPostRequirement}
          onCompleteVerification={props.onCompleteVerification}
          hasPreviousRequirement={myRequirements.length > 0 || recentlyClosed.length > 0}
          onUsePreviousRequirement={props.onUsePreviousRequirement}
        />

            <View style={styles.sectionHeaderRow}>
              <Text style={styles.sectionHeading}>Business Opportunities</Text>
              <Text style={styles.microLabel}>{st.resultLabel}</Text>
            </View>
            <View style={{ gap: space.md }}>
              {st.filtered.length === 0 && <NoOpportunitiesRow query={st.queryDisplay} />}
              {st.filtered.map((r) => (
                <RequirementCard
                  key={r.id}
                  requirement={r}
                  buyer={requirementBuyers[r.buyerId]}
                  viewer={viewer}
                  now={st.now}
                  saved={r.isSaved}
                  quoted={st.sessionQuoted.has(r.id)}
                  onToggleSave={() => props.onToggleSave?.(r.id, !r.isSaved)}
                  onSubmitQuotation={() => st.submitQuotation(r.id)}
                  onSelect={() => props.onSelectRequirement?.(r.id)}
                />
              ))}
            </View>

            <View style={styles.sectionBlock}>
              <View style={styles.sectionHeaderRow}>
                <Text style={styles.sectionHeading}>Your requirements</Text>
                <Pressable onPress={() => props.onManageRequirements?.()}><Text style={styles.manageAllLink}>Manage all</Text></Pressable>
              </View>
              <View style={{ gap: space.md }}>
                {myRequirements.map((r) => (
                  <MyRequirementRow key={r.id} requirement={r} now={st.now} onSelect={() => props.onSelectRequirement?.(r.id)} />
                ))}
              </View>
            </View>

            <View style={styles.sectionBlock}>
              <View style={styles.sectionHeaderRow}>
                <Text style={styles.sectionHeading}>Recently closed on Trustlink</Text>
                <Text style={styles.microLabel}>Last 7 days</Text>
              </View>
              <Text style={styles.mutedSmall}>
                Outcomes are published once a buyer closes a requirement, so you can see what actually gets awarded
                in your category.
              </Text>
              <View style={{ gap: space.md, marginTop: space.sm }}>
                {recentlyClosed.map((r) => (
                  <ClosedRequirementRow key={r.id} requirement={r} buyerName={requirementBuyers[r.buyerId]?.displayName ?? requirementBuyers[r.buyerId]?.registeredName ?? ''} now={st.now} />
                ))}
              </View>
            </View>
          </View>

          <View style={[styles.sideColumn, stickyOnWeb, sidebarTop]}>
            <View style={styles.statsCard}>
              <Text style={styles.microLabel}>Closing within 24 hours</Text>
              <View>
                {st.closingSoon.map(({ requirement }) => (
                  <ClosingSoonItem
                    key={requirement.id}
                    requirement={requirement}
                    buyerName={requirementBuyers[requirement.buyerId]?.displayName ?? requirementBuyers[requirement.buyerId]?.registeredName ?? ''}
                    now={st.now}
                    onSelect={() => props.onSelectRequirement?.(requirement.id)}
                  />
                ))}
              </View>
            </View>
            <HowMatchingWorksCard onUpdateCapabilities={props.onUpdateCapabilities} />
          </View>
        </View>
      </View>
    </ScreenScroll>
    <ChatWidget
      threads={messageThreads}
      messagesByThread={messagesByThread}
      viewerId={viewer.id}
      now={st.now}
      onSend={props.onSendMessage}
      onOpenThread={props.onOpenThread}
      autoOpenThreadId={props.autoOpenThreadId}
    />
    </View>
  );
}

/* ─── Root component ────────────────────────────────── */

export default function HomeFeed(props: HomeFeedProps) {
  const { width } = useWindowDimensions();
  const isWide = width >= breakpoint.desktop;
  return isWide ? <WideHomeFeed {...props} /> : <PhoneHomeFeed {...props} />;
}

/* ─── Styles ─────────────────────────────────────────── */

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: color.canvas },
  scrollContent: { paddingBottom: space.section },
  scrollContentWide: { paddingBottom: space.section },
  page: { width: '100%', paddingHorizontal: layout.screenPadding, gap: space.lg, paddingTop: space.lg },
  pageWide: { width: '100%', maxWidth: layout.maxWidthDashboard, marginHorizontal: 'auto', paddingHorizontal: layout.screenPadding },
  categorySticky: { backgroundColor: color.canvas, borderBottomWidth: 1, borderBottomColor: color.border, zIndex: 40 },
  columnsWide: { flexDirection: 'row', alignItems: 'flex-start', gap: space.xxl, paddingVertical: space.xl },
  sideColumn: { flex: 1, minWidth: layout.sideColumnMinWidth, maxWidth: 340, gap: space.lg },
  mainColumnWide: { flex: 3, minWidth: 0, gap: space.lg },
  sectionBlock: { gap: space.md, marginTop: space.xl, paddingTop: space.xl, borderTopWidth: 1, borderTopColor: color.border },

  /* messages dock — one bordered card, flush to the bottom-right corner. dockPanel is the
   * whole card (content pane + bar); its rounded top corners read correctly whether the
   * pane above is open or collapsed to nothing, since the bar's own edges never carry a
   * radius of their own */
  dockPanel: { backgroundColor: color.surface, borderWidth: 1, borderColor: color.border, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, overflow: 'hidden' },
  dockScroll: { flex: 1 },
  dockMeta: { fontFamily: font.mono, fontSize: 10, letterSpacing: letterSpacing.label, textTransform: 'uppercase', color: color.inkFaint },
  dockEmpty: { padding: space.xl },
  dockEmptyText: { fontFamily: font.body, fontSize: fontSize.sm, lineHeight: lineHeight.sm, color: color.inkMuted, textAlign: 'center' },

  alertTopRow: { flexDirection: 'row', alignItems: 'baseline', gap: space.sm },
  alertTime: { fontFamily: font.mono, fontSize: fontSize.micro, color: color.inkFaint },

  threadRow: { flexDirection: 'row', alignItems: 'flex-start', gap: space.md, padding: space.md, borderBottomWidth: 1, borderBottomColor: color.borderFaint },
  threadName: { flex: 1, fontSize: fontSize.sm, color: color.ink },
  threadPreview: { fontFamily: font.body, fontSize: fontSize.sm },
  threadRef: { fontFamily: font.mono, fontSize: fontSize.micro, letterSpacing: letterSpacing.label, textTransform: 'uppercase', color: color.inkFaint },

  /* conversation view */
  bubbleList: { padding: space.md, gap: space.sm },
  bubbleRow: { alignSelf: 'flex-start', maxWidth: '82%', gap: 2 },
  bubbleRowMine: { alignSelf: 'flex-end', alignItems: 'flex-end' },
  bubble: { borderRadius: radius.lg, paddingHorizontal: space.md, paddingVertical: space.sm },
  bubbleTheirs: { backgroundColor: color.surfaceSunken },
  bubbleMine: { backgroundColor: color.primaryFaint, borderWidth: 1, borderColor: color.primaryBorder },
  bubbleText: { fontFamily: font.body, fontSize: fontSize.sm, lineHeight: lineHeight.sm, color: color.ink },
  bubbleTime: { fontFamily: font.mono, fontSize: 10, color: color.inkFaint },

  composerRow: { flexDirection: 'row', alignItems: 'flex-end', gap: space.sm, padding: space.md, borderTopWidth: 1, borderTopColor: color.border },
  composerInput: { flex: 1, minHeight: 36, maxHeight: 80, borderWidth: 1, borderColor: color.border, borderRadius: radius.lg, paddingHorizontal: space.md, paddingVertical: space.sm, fontFamily: font.body, fontSize: fontSize.sm, color: color.ink },
  composerSend: { backgroundColor: color.primary, borderRadius: radius.pill, paddingHorizontal: space.lg, paddingVertical: space.sm },
  composerSendLabel: { fontFamily: font.bodySemi, fontSize: fontSize.sm, color: color.onPrimary },

  /* dock row — right edge pinned via `right`, grows leftward as conversation windows open;
   * every item (conversation windows, then the list card) shares the bottom edge */
  chatWidget: { right: space.xl, bottom: 0, flexDirection: 'row', alignItems: 'flex-end', gap: space.md, zIndex: 80 },
  /* dock bar/header — fixed-height row pinned to the bottom of dockPanel, its top border
   * only drawn while the pane above it is expanded so it reads as one divider, not a
   * doubled edge */
  dockBar: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingHorizontal: space.lg, paddingVertical: space.md },
  dockBarOpen: { borderTopWidth: 1, borderTopColor: color.border },
  dockBarLabel: { fontFamily: font.bodySemi, fontSize: fontSize.sm, color: color.ink },
  dockMark: { width: 16, height: 16, borderRadius: radius.pill },
  dockHeaderPress: { flexDirection: 'row', alignItems: 'center', gap: space.sm, flex: 1, minWidth: 0 },
  chatBadge: { backgroundColor: color.primary, borderRadius: radius.pill, paddingHorizontal: space.xs, paddingVertical: 1, minWidth: 16, alignItems: 'center' },
  chatBadgeLabel: { fontFamily: font.mono, fontSize: fontSize.micro, color: color.onPrimary },

  /* conversation window header glyphs — × close, and a rotate-driven chevron for
   * collapse/expand, same border-corner technique QuotationSubmission.tsx's own
   * chevronGlyph/chevronGlyphOpen pair uses */
  closeGlyphBox: { width: 10, height: 10, alignItems: 'center', justifyContent: 'center' },
  closeGlyphBar: { position: 'absolute', width: 10, height: 1.4, borderRadius: 1, backgroundColor: color.inkMuted },
  dockChevron: { width: 6, height: 6, borderRightWidth: 1.4, borderBottomWidth: 1.4, borderColor: color.inkMuted, transform: [{ rotate: '45deg' }] },
  dockChevronUp: { transform: [{ rotate: '-135deg' }] },

  /* category pills */
  categoryRow: { flexDirection: 'row', gap: space.sm, paddingVertical: space.md },
  categoryPill: { flexDirection: 'row', alignItems: 'center', gap: space.sm, borderWidth: 1, borderColor: color.border, borderRadius: radius.pill, paddingHorizontal: space.lg, paddingVertical: space.sm },
  categoryPillActive: { backgroundColor: color.ink, borderColor: color.ink },
  categoryPillLabel: { fontFamily: font.bodyMedium, fontSize: fontSize.sm, color: color.inkMuted },
  categoryPillLabelActive: { color: color.canvas },
  categoryPillCount: { fontFamily: font.mono, fontSize: fontSize.micro, color: color.inkFaint },
  categoryPillCountActive: { color: color.canvas },

  /* profile sidebar */
  profileCard: { borderWidth: 1, borderColor: color.border, borderRadius: radius.xl, backgroundColor: color.surface, padding: space.xl },
  profileTopRow: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  profileName: { fontFamily: font.display, fontSize: fontSize.md, color: color.ink },
  profileVerified: { marginTop: space.xs, fontFamily: font.mono, fontSize: fontSize.micro, letterSpacing: letterSpacing.label, textTransform: 'uppercase', color: color.primary },
  profileFactList: { gap: space.sm, marginTop: space.lg, paddingTop: space.lg, borderTopWidth: 1, borderTopColor: color.border },
  profileFactRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  profileFact: { fontFamily: font.body, fontSize: fontSize.sm, color: color.inkMuted },
  profileSection: { marginTop: space.lg, paddingTop: space.lg, borderTopWidth: 1, borderTopColor: color.border },
  profileSectionRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  profileSectionValue: { fontFamily: font.display, fontSize: fontSize.sm, color: color.ink },
  profileSectionValueMono: { fontFamily: font.mono, fontSize: fontSize.sm, color: color.ink },
  profileSectionCaption: { marginTop: space.sm, fontFamily: font.body, fontSize: fontSize.sm, lineHeight: lineHeight.sm, color: color.inkMuted },
  tierBarRow: { flexDirection: 'row', gap: space.xs, marginTop: space.sm },
  tierBarSegment: { flex: 1, height: 5, borderRadius: radius.pill, backgroundColor: color.borderFaint },
  tierBarSegmentFilled: { backgroundColor: color.ink },
  progressTrack: { height: 5, borderRadius: radius.pill, backgroundColor: color.borderFaint, marginTop: space.sm, overflow: 'hidden' },
  progressFill: { height: '100%', backgroundColor: color.ink, borderRadius: radius.pill },
  profileNextStep: { marginTop: space.md },
  profileNextStepLabel: { fontFamily: font.bodyMedium, fontSize: fontSize.sm, color: color.ink },

  /* activity stats */
  statsCard: { borderWidth: 1, borderColor: color.border, borderRadius: radius.xl, padding: space.xl },
  statRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', paddingVertical: space.sm, borderBottomWidth: 1, borderBottomColor: color.borderFaint },
  statLabel: { fontFamily: font.body, fontSize: fontSize.sm, color: color.inkMuted },
  statValue: { fontFamily: font.display, fontSize: fontSize.md, color: color.ink },
  statsCaption: { marginTop: space.md, fontFamily: font.body, fontSize: fontSize.sm, lineHeight: lineHeight.sm, color: color.inkMuted },
  howMatchingBody: { marginTop: space.sm, fontFamily: font.body, fontSize: fontSize.sm, lineHeight: lineHeight.sm, color: color.inkMuted },

  /* CTA banner */
  ctaBanner: { borderWidth: 1, borderColor: color.border, borderRadius: radius.lg, backgroundColor: color.surface, padding: space.lg, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.lg, flexWrap: 'wrap' },
  ctaTitle: { fontFamily: font.bodySemi, fontSize: fontSize.base, color: color.ink },
  ctaSubtitle: { fontFamily: font.body, fontSize: fontSize.sm, color: color.inkMuted },
  ctaActions: { flexDirection: 'row', gap: space.sm, flexWrap: 'wrap' },

  /* section headers */
  sectionHeaderRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: space.md },
  sectionHeading: { fontFamily: font.display, fontSize: fontSize.xl, color: color.ink },
  manageAllLink: { fontFamily: font.body, fontSize: fontSize.sm, color: color.inkMuted },
  microLabel: { fontFamily: font.mono, fontSize: fontSize.micro, letterSpacing: letterSpacing.label, textTransform: 'uppercase', color: color.inkFaint },
  mutedSmall: { fontFamily: font.body, fontSize: fontSize.sm, color: color.inkMuted },
  emptyOpportunities: { borderWidth: 1, borderColor: color.border, borderRadius: radius.lg, backgroundColor: color.surface, padding: space.lg, alignItems: 'center' },

  /* feed card */
  card: { borderWidth: 1, borderRadius: radius.xl, backgroundColor: color.surface, padding: space.xl, gap: space.md },
  cardMatched: { borderLeftWidth: 3, borderLeftColor: color.primary },
  cardHovered: { transform: [{ scale: 1.01 }] },
  cardTopRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, flexWrap: 'wrap' },
  categoryBadge: { borderWidth: 1, borderColor: color.primaryBorder, borderRadius: radius.pill, paddingHorizontal: space.md, paddingVertical: space.xs },
  categoryBadgeLabel: { fontFamily: font.mono, fontSize: fontSize.micro, letterSpacing: letterSpacing.label, textTransform: 'uppercase', color: color.primary },
  categoryBadgeMuted: { borderWidth: 1, borderColor: color.border, borderRadius: radius.pill, paddingHorizontal: space.sm, paddingVertical: 2 },
  categoryBadgeMutedLabel: { fontFamily: font.mono, fontSize: fontSize.micro, letterSpacing: letterSpacing.label, textTransform: 'uppercase', color: color.inkMuted },
  signalBadge: { borderWidth: 1, borderColor: color.border, borderRadius: radius.pill, paddingHorizontal: space.md, paddingVertical: space.xs },
  signalBadgeUrgent: { backgroundColor: color.danger, borderColor: color.danger },
  signalBadgeLabel: { fontFamily: font.mono, fontSize: fontSize.micro, letterSpacing: letterSpacing.label, textTransform: 'uppercase', color: color.inkMuted },
  signalBadgeLabelUrgent: { color: color.onPrimary },
  cardRef: { fontFamily: font.mono, fontSize: fontSize.micro, color: color.inkFaint },
  cardTitle: { fontFamily: font.display, fontSize: fontSize.lg, lineHeight: lineHeight.lg, color: color.ink },

  buyerRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, backgroundColor: color.surfaceSunken, borderRadius: radius.lg, padding: space.md },
  buyerNameRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, flexWrap: 'wrap' },
  buyerName: { fontFamily: font.bodySemi, fontSize: fontSize.base, color: color.ink },
  verifiedTag: { flexDirection: 'row', alignItems: 'center' },
  verifiedTagLabel: { fontFamily: font.mono, fontSize: fontSize.micro, letterSpacing: letterSpacing.label, textTransform: 'uppercase', color: color.primary },
  tierTag: { borderWidth: 1, borderColor: color.border, borderRadius: radius.pill, paddingHorizontal: space.sm, paddingVertical: 2 },
  tierTagLabel: { fontFamily: font.mono, fontSize: fontSize.micro, letterSpacing: letterSpacing.label, textTransform: 'uppercase', color: color.inkMuted },

  factsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: space.lg },
  factItem: { minWidth: layout.factMinWidth, gap: space.xs },
  factValue: { fontFamily: font.bodyMedium, fontSize: fontSize.base, color: color.ink },

  matchBox: { flexDirection: 'row', gap: space.sm, borderWidth: 1, borderStyle: 'dashed', borderColor: color.border, borderRadius: radius.lg, padding: space.md },
  matchReasonText: { marginTop: space.xs, fontFamily: font.body, fontSize: fontSize.sm, lineHeight: lineHeight.sm, color: color.ink },

  cardFooter: { flexDirection: 'row', alignItems: 'center', gap: space.md, flexWrap: 'wrap', paddingTop: space.md, borderTopWidth: 1, borderTopColor: color.borderFaint },
  countdownRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  countdownLabelText: { fontFamily: font.body, fontSize: fontSize.base, color: color.inkMuted },
  countdownValue: { fontFamily: font.mono, fontSize: fontSize.base },
  dot: { width: 7, height: 7, borderRadius: radius.pill },

  feedButton: { borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: space.lg, paddingVertical: space.sm },
  feedButtonContent: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  feedButtonLabel: { fontFamily: font.bodyMedium, fontSize: fontSize.sm },

  /* simple shape-built icons */
  categoryIcon: { width: 13, height: 10, borderWidth: 1.2, borderRadius: 2, justifyContent: 'center' },
  categoryIconLine: { height: 1.2, marginHorizontal: 1.5 },
  pinIcon: { width: 12, height: 12, borderRadius: radius.pill, borderWidth: 1.3, alignItems: 'center', justifyContent: 'center' },
  pinIconDot: { width: 4, height: 4, borderRadius: radius.pill },
  bookmarkIcon: { width: 10, height: 10, borderWidth: 1.3, borderRadius: 2 },
  arrowIconRow: { flexDirection: 'row', alignItems: 'center' },
  arrowIconLine: { width: 7, height: 1.4 },
  arrowIconHead: { width: 6, height: 6, borderTopWidth: 1.4, borderRightWidth: 1.4, transform: [{ rotate: '45deg' }], marginLeft: -3 },

  /* your requirements */
  myReqRow: { borderWidth: 1, borderColor: color.border, borderRadius: radius.xl, padding: space.lg, flexDirection: 'row', alignItems: 'center', gap: space.lg, flexWrap: 'wrap' },
  myReqStatusRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  myReqStatusLabel: { fontFamily: font.mono, fontSize: fontSize.micro, letterSpacing: letterSpacing.label, textTransform: 'uppercase' },
  myReqTitle: { fontFamily: font.display, fontSize: fontSize.base, color: color.ink },
  myReqRight: { flexDirection: 'row', alignItems: 'center', gap: space.xl },
  myReqCount: { fontFamily: font.display, fontSize: fontSize.xl, color: color.ink },

  /* recently closed */
  closedRow: { borderWidth: 1, borderColor: color.borderFaint, borderRadius: radius.xl, backgroundColor: color.surfaceSunken, padding: space.lg, flexDirection: 'row', alignItems: 'center', gap: space.lg, flexWrap: 'wrap' },
  closedTitle: { fontFamily: font.bodySemi, fontSize: fontSize.base, color: color.ink },
  outcomeTag: { flexDirection: 'row', alignItems: 'center', gap: space.sm, borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: space.md, paddingVertical: space.sm },
  outcomeLabel: { fontFamily: font.bodyMedium, fontSize: fontSize.sm },

  /* closing soon */
  closingSoonRow: { gap: space.xs, paddingVertical: space.md, borderBottomWidth: 1, borderBottomColor: color.borderFaint },
  closingSoonTitle: { fontFamily: font.bodySemi, fontSize: fontSize.sm, color: color.ink },
  closingSoonCountdown: { fontFamily: font.mono, fontSize: fontSize.sm, color: color.danger },
});
