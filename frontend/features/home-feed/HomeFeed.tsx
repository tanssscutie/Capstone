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
  elevation,
  layout,
  breakpoint,
} from '../../components/ui/tokens';
import { AvatarChip, initials } from '../../components/ui/AvatarChip';
import { isWebFilePickerSupported, pickWebFile } from '../../lib/pickWebFile';
import { ReportLink } from '../../components/ui/ReportBusinessModal';
import { OrderStatusLine, isChatClosed } from '../../components/ui/OrderStatusPanel';
import type { FulfillmentOut } from '../../lib/api/requirements';
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

export type HomeFeedProps = {
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
  /** With `file`, resolves to an error message or null — no optimistic bubble
   *  for a file, the parent re-fetches the thread once it's uploaded. */
  onSendMessage?: (threadId: string, body: string, file?: File) => Promise<string | null> | void;
  onOpenThread?: (threadId: string) => void;
  onOpenAttachment?: (threadId: string, messageId: string) => void;
  /** Opens the full /messages page — on a thread, or the inbox when none. */
  onExpandMessages?: (threadId?: string) => void;
} & CloseoutChatProps & {
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
};

/** Order status per award thread (fulfillment_service) — read-only in the chat;
 *  updates happen on My Quotations / My Requirements. Keyed by thread id. */
interface CloseoutChatProps {
  fulfillmentByThread?: Record<string, FulfillmentOut | null>;
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

/** "Today" / "Yesterday" / "Oct 21" (plus the year if it isn't this one) — the
 *  conversation's day separators, by the device's calendar day. */
function dayLabel(iso: ISODateTime): string {
  const d = new Date(iso);
  const today = new Date();
  const startOf = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((startOf(today) - startOf(d)) / 86_400_000);
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  const base = `${MONTHS[d.getMonth()]} ${d.getDate()}`;
  return d.getFullYear() === today.getFullYear() ? base : `${base}, ${d.getFullYear()}`;
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
    case 'INSUFFICIENT_QUOTATIONS': return 'Archived — not enough quotations';
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

/** RN-web passes these straight through as CSS; native ignores them. */
function webTransition(properties: string): ViewStyle {
  return Platform.OS === 'web'
    ? ({ transitionProperty: properties, transitionDuration: '160ms', transitionTimingFunction: 'ease-out' } as unknown as ViewStyle)
    : {};
}

/** Hover is web-only; on native the handlers are simply not attached. */
function useHover() {
  const [hovered, setHovered] = useState(false);
  const handlers =
    Platform.OS === 'web' ? { onHoverIn: () => setHovered(true), onHoverOut: () => setHovered(false) } : {};
  return [hovered, handlers] as const;
}

/** Soft resting shadow for white cards on the sunken page, and a lifted one on hover. */
const cardShadow: ViewStyle =
  Platform.OS === 'web' ? ({ boxShadow: '0 1px 2px rgba(20, 24, 31, 0.04)' } as unknown as ViewStyle) : {};
const cardShadowHovered: ViewStyle =
  Platform.OS === 'web' ? ({ boxShadow: '0 10px 24px rgba(20, 24, 31, 0.08)' } as unknown as ViewStyle) : {};

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
  const [hovered, hoverHandlers] = useHover();
  const live = hovered && !disabled;
  return (
    <Pressable
      {...hoverHandlers}
      onPress={disabled ? undefined : onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.feedButton,
        webTransition('background-color, border-color, transform'),
        {
          backgroundColor:
            variant === 'primary' ? (pressed || live ? color.primaryPressed : color.primary)
            : variant === 'tinted' ? color.primaryFaint
            : variant === 'outline' ? (live ? color.surfaceSunken : color.surface)
            : 'transparent',
          borderColor:
            variant === 'primary' ? color.primary
            : variant === 'tinted' ? (live ? color.primary : color.primaryBorder)
            : variant === 'text' ? 'transparent'
            : live ? color.borderStrong : color.border,
          opacity: disabled ? 0.6 : 1,
        },
        pressed && !disabled && styles.pressedScale,
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

export function ThreadRow({ thread, now, onPress }: { thread: MessageThread; now: number; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.threadRow, pressed ? styles.threadRowPressed : null]}>
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
      {thread.unread && <View style={[styles.dot, styles.threadUnreadDot]} />}
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
 * same way: a fixed-height header on top, with a content pane below it whose `height` alone
 * is what GrowPanel animates between 0 (collapsed: the card *is* just its header, sitting on
 * the bottom edge) and DOCK_OPEN_HEIGHT (expanded: the header rides up with the pane, like a
 * chat window). The panel's bottom edge never moves; only that height changes.
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

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  return kb < 1024 ? `${Math.round(kb)} KB` : `${(kb / 1024).toFixed(1)} MB`;
}

function AttachmentCard({ attachment, onOpen }: { attachment: NonNullable<Message['attachment']>; onOpen?: () => void }) {
  return (
    <Pressable onPress={onOpen} disabled={!onOpen} style={({ pressed }) => [styles.attachmentCard, pressed ? { opacity: 0.7 } : null]}>
      <Text style={styles.attachmentIcon}>📎</Text>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={styles.attachmentName} numberOfLines={1}>{attachment.filename}</Text>
        <Text style={styles.bubbleTime}>{formatFileSize(attachment.sizeBytes)}{onOpen ? ' · Open' : ''}</Text>
      </View>
    </Pressable>
  );
}

function MessageBubble({ message, mine, onOpenAttachment }: { message: Message; mine: boolean; onOpenAttachment?: () => void }) {
  if (message.isSystem) {
    return (
      <View style={styles.systemBubble}>
        <View style={styles.systemBubbleHead}>
          <TrustlinkMark />
          <Text style={styles.systemBubbleLabel}>TrustLink</Text>
        </View>
        <Text style={styles.bubbleText}>{message.body}</Text>
        <Text style={styles.bubbleTime}>{formatClockTime(message.sentAt)}</Text>
      </View>
    );
  }
  return (
    <View style={[styles.bubbleRow, mine ? styles.bubbleRowMine : null]}>
      <View style={[styles.bubble, mine ? styles.bubbleMine : styles.bubbleTheirs, { gap: space.xs }]}>
        {message.attachment && <AttachmentCard attachment={message.attachment} onOpen={onOpenAttachment} />}
        {message.body.length > 0 && <Text style={styles.bubbleText}>{message.body}</Text>}
      </View>
      <Text style={styles.bubbleTime}>{formatClockTime(message.sentAt)}</Text>
    </View>
  );
}

export function TrustlinkMark() {
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

/** "Open in full page" — a small outlined square. */
function ExpandGlyph() {
  return <View style={styles.expandGlyph} />;
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
  onExpand,
  width,
}: {
  threads: MessageThread[];
  now: number;
  open: boolean;
  onToggleOpen: () => void;
  onSelectThread: (id: string) => void;
  onExpand?: () => void;
  width: number;
}) {
  const unread = threads.filter((t) => t.unread).length;
  return (
    <View style={[styles.dockPanel, { width }]}>
      <Pressable onPress={onToggleOpen} style={[styles.dockBar, open ? styles.dockBarOpen : null]}>
        <TrustlinkMark />
        <Text style={styles.dockBarLabel}>Messages</Text>
        <View style={{ flex: 1 }} />
        {unread > 0 && (
          <View style={styles.chatBadge}>
            <Text style={styles.chatBadgeLabel}>{unread}</Text>
          </View>
        )}
        {open && onExpand && (
          <Pressable onPress={onExpand} hitSlop={8} accessibilityLabel="Open Messages page">
            <ExpandGlyph />
          </Pressable>
        )}
      </Pressable>

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
  onExpand,
  width,
  fulfillment,
  onOpenAttachment,
}: ConversationPaneProps & {
  thread: MessageThread;
  collapsed: boolean;
  closing: boolean;
  onToggleCollapse: () => void;
  onClose: () => void;
  onClosed: () => void;
  onExpand?: () => void;
  width: number;
}) {
  const open = !collapsed && !closing;

  return (
    <View style={[styles.dockPanel, { width }]}>
      <View style={[styles.dockBar, open ? styles.dockBarOpen : null]}>
        <Pressable onPress={onToggleCollapse} hitSlop={8} style={styles.dockHeaderPress}>
          <ChevronGlyph up={!open} />
          <View style={{ minWidth: 0 }}>
            <Text style={styles.dockBarLabel} numberOfLines={1}>{thread.counterpartyName}</Text>
            <Text style={styles.dockMeta}>{thread.requirementRef}</Text>
          </View>
        </Pressable>
        <View style={{ flex: 1 }} />
        {open && <ReportLink businessId={thread.counterpartyId} businessName={thread.counterpartyName} />}
        {open && onExpand && (
          <Pressable onPress={onExpand} hitSlop={8} accessibilityLabel="Open in Messages page">
            <ExpandGlyph />
          </Pressable>
        )}
        <Pressable onPress={onClose} hitSlop={8}>
          <CloseGlyph />
        </Pressable>
      </View>

      {/* onClosed only wired while an actual close is in flight — an ordinary collapse
       *  also animates height to 0, but must not trigger the deferred unmount below. */}
      <GrowPanel open={open} onClosed={closing ? onClosed : undefined}>
        <ConversationPane
          messages={messages}
          viewerId={viewerId}
          onSend={onSend}
          onOpenAttachment={onOpenAttachment}
          fulfillment={fulfillment}
        />
      </GrowPanel>
    </View>
  );
}

export interface ConversationPaneProps {
  messages: Message[];
  viewerId: BusinessId;
  onSend: (body: string, file?: File) => Promise<string | null> | void;
  onOpenAttachment?: (messageId: string) => void;
  /** Read-only order status line at the top. */
  fulfillment?: FulfillmentOut | null;
}

/** The body of one conversation — status bar, messages, composer. Used by the
 *  dock's ConversationWindow and by the full /messages page. Fills its parent. */
export function ConversationPane({
  messages,
  viewerId,
  onSend,
  onOpenAttachment,
  fulfillment,
}: ConversationPaneProps) {
  const [draft, setDraft] = useState('');
  // One file per message — picked here, sent with whatever text is in the draft.
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const scrollRef = useRef<ScrollView>(null);
  const canSend = !uploading && (draft.trim().length > 0 || file !== null);
  const readOnly = isChatClosed(fulfillment?.status);

  const pickFile = async () => {
    if (uploading || !isWebFilePickerSupported()) return;
    const picked = await pickWebFile('.pdf,.doc,.docx,.xls,.xlsx,.jpg,.jpeg,.png,.ai,.psd,application/pdf,image/*');
    if (!picked) return;
    if (picked.size > 10 * 1024 * 1024) {
      setSendError('Files can be up to 10 MB.');
      return;
    }
    setSendError(null);
    setFile(picked);
  };

  const handleSend = async () => {
    if (!canSend) return;
    const body = draft.trim();
    if (!file) {
      onSend(body);
      setDraft('');
      return;
    }
    setUploading(true);
    setSendError(null);
    const err = await Promise.resolve(onSend(body, file)).catch(() => 'Could not send that file.');
    setUploading(false);
    if (err) {
      setSendError(err);
    } else {
      setFile(null);
      setDraft('');
    }
  };

  return (
    <View style={{ flex: 1 }}>
      <OrderStatusLine fulfillment={fulfillment} />
      <ScrollView
        ref={scrollRef}
        style={styles.dockScroll}
        contentContainerStyle={styles.bubbleList}
        onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: false })}
      >
        {messages.length === 0 && (
          <Text style={styles.dockEmptyText}>No messages yet. Say hello to start coordinating.</Text>
        )}
        {messages.map((m, i) => {
          const day = dayLabel(m.sentAt);
          const newDay = i === 0 || dayLabel(messages[i - 1].sentAt) !== day;
          return (
            <View key={m.id} style={{ gap: space.sm }}>
              {newDay && (
                <View style={styles.daySeparator}>
                  <View style={styles.daySeparatorLine} />
                  <Text style={styles.daySeparatorLabel}>{day}</Text>
                  <View style={styles.daySeparatorLine} />
                </View>
              )}
              <MessageBubble
                message={m}
                mine={!m.isSystem && m.senderId === viewerId}
                onOpenAttachment={m.attachment && onOpenAttachment ? () => onOpenAttachment(m.id) : undefined}
              />
            </View>
          );
        })}
      </ScrollView>
      {readOnly ? (
        <View style={styles.composerClosed}>
          <Text style={styles.composerClosedText}>This transaction is completed. The conversation stays as a record.</Text>
        </View>
      ) : (
      <>
      {(file || sendError) && (
        <View style={styles.composerStaged}>
          {file && (
            <View style={styles.stagedChip}>
              <Text style={styles.attachmentIcon}>📎</Text>
              <Text style={[styles.attachmentName, { flex: 1 }]} numberOfLines={1}>{file.name}</Text>
              <Text style={styles.bubbleTime}>{formatFileSize(file.size)}</Text>
              {!uploading && (
                <Pressable onPress={() => setFile(null)} hitSlop={8}>
                  <CloseGlyph />
                </Pressable>
              )}
            </View>
          )}
          {sendError && <Text style={styles.closeoutError}>{sendError}</Text>}
        </View>
      )}
      <View style={styles.composerRow}>
        <Pressable onPress={pickFile} disabled={uploading} hitSlop={6} style={styles.composerAttach} accessibilityLabel="Attach a file">
          <Text style={styles.composerAttachIcon}>📎</Text>
        </Pressable>
        <TextInput
          value={draft}
          onChangeText={setDraft}
          placeholder={file ? 'Add a message (optional)' : 'Write a message'}
          placeholderTextColor={color.inkFaint}
          style={styles.composerInput}
          multiline
          maxLength={2000}
          // Web: Enter sends, Shift+Enter adds a new line. onSubmitEditing never
          // fires for a multiline input, which left Enter doing nothing useful.
          onKeyPress={(e) => {
            const ev = e.nativeEvent as unknown as { key: string; shiftKey?: boolean };
            if (ev.key === 'Enter' && !ev.shiftKey) {
              (e as unknown as { preventDefault?: () => void }).preventDefault?.();
              handleSend();
            }
          }}
        />
        <Pressable onPress={handleSend} disabled={!canSend} style={[styles.composerSend, !canSend ? { opacity: 0.4 } : null]}>
          <Text style={styles.composerSendLabel}>{uploading ? 'Sending…' : 'Send'}</Text>
        </Pressable>
      </View>
      </>
      )}
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
  onOpenAttachment,
  autoOpenThreadId,
  onExpandMessages,
  fulfillmentByThread,
}: CloseoutChatProps & {
  onExpandMessages?: (threadId?: string) => void;
  threads: MessageThread[];
  messagesByThread: Record<string, Message[]>;
  viewerId: BusinessId;
  now: number;
  /** Parent persists the message for real; this component's own sentByThread
   *  state is only what makes it appear instantly, before that round-trip returns. */
  onSend?: (threadId: string, body: string, file?: File) => Promise<string | null> | void;
  onOpenAttachment?: (threadId: string, messageId: string) => void;
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
  // Below this the list card and a conversation can't sit side by side — show one
  // conversation at a time, in place of the list, full width minus the gutters.
  const compact = width < 720;
  const panelWidth = compact ? width - space.lg * 2 : 320;
  const autoOpenedRef = useRef<string | null>(null);

  const toggleList = () => setListOpen((v) => !v);

  const openThread = (id: string) => {
    setOpenThreadIds((prev) => (compact ? [id] : prev.includes(id) ? prev : [...prev, id]));
    // The parent re-fetches this thread on open, which already includes anything sent
    // optimistically here — keeping those local copies would show them twice.
    setSentByThread((prev) => {
      if (!prev[id]) return prev;
      const next = { ...prev };
      delete next[id];
      return next;
    });
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

  // Whenever the parent re-fetches a thread (on open, after a file or a close-out
  // action), that list already has every message sent from here — drop the local
  // optimistic copies for it so nothing shows twice.
  const lastServerLists = useRef(messagesByThread);
  useEffect(() => {
    const changed = Object.keys(messagesByThread).filter((id) => messagesByThread[id] !== lastServerLists.current[id]);
    lastServerLists.current = messagesByThread;
    if (changed.length === 0) return;
    setSentByThread((prev) => {
      if (!changed.some((id) => prev[id])) return prev;
      const next = { ...prev };
      changed.forEach((id) => delete next[id]);
      return next;
    });
  }, [messagesByThread]);

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

  const sendMessage = (threadId: string, body: string, file?: File) => {
    // A file has no optimistic bubble: it shows once the parent re-fetches.
    if (file) return onSend?.(threadId, body, file);
    const message: Message = {
      id: `m-local-${Date.now()}`,
      threadId,
      senderId: viewerId,
      body,
      isSystem: false,
      attachment: null,
      sentAt: new Date().toISOString(),
      read: true,
    };
    setSentByThread((prev) => ({ ...prev, [threadId]: [...(prev[threadId] ?? []), message] }));
    return onSend?.(threadId, body);
  };

  if (Platform.OS !== 'web') return null;

  const showList = !compact || openThreadIds.length === 0;

  return (
    <View style={[styles.chatWidget, compact ? styles.chatWidgetCompact : null, fixedOnWeb]} pointerEvents="box-none">
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
            onSend={(body, file) => sendMessage(id, body, file)}
            onExpand={onExpandMessages && (() => onExpandMessages(id))}
            onOpenAttachment={onOpenAttachment && ((messageId) => onOpenAttachment(id, messageId))}
            width={panelWidth}
            fulfillment={fulfillmentByThread?.[id]}
          />
        );
      })}

      {showList && (
        <ThreadListCard
          threads={threads}
          now={now}
          open={listOpen}
          onToggleOpen={toggleList}
          onSelectThread={openThread}
          onExpand={onExpandMessages && (() => onExpandMessages())}
          width={panelWidth}
        />
      )}
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
      {categories.map((c) => (
        <CategoryPill key={c.name} name={c.name} count={c.count} active={c.name === active} onPress={() => onSelect(c.name)} />
      ))}
    </ScrollView>
  );
}

function CategoryPill({ name, count, active, onPress }: { name: string; count: number; active: boolean; onPress: () => void }) {
  const [hovered, hoverHandlers] = useHover();
  return (
    <Pressable
      {...hoverHandlers}
      onPress={onPress}
      style={({ pressed }) => [
        styles.categoryPill,
        webTransition('background-color, border-color, transform'),
        hovered && !active && styles.categoryPillHovered,
        active ? styles.categoryPillActive : null,
        pressed && styles.pressedScale,
      ]}
    >
      <Text style={[styles.categoryPillLabel, active ? styles.categoryPillLabelActive : null]}>{name}</Text>
      <View style={[styles.categoryPillCountBubble, active && styles.categoryPillCountBubbleActive]}>
        <Text style={[styles.categoryPillCount, active ? styles.categoryPillCountActive : null]}>{count}</Text>
      </View>
    </Pressable>
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
  const isBuyer = viewer.role === 'buyer';
  const rows: { label: string; value: string }[] = isBuyer
    ? [
        { label: 'Requirements posted', value: String(c.requirementsPosted) },
        { label: 'On Trustlink since', value: String(viewer.memberSinceYear) },
      ]
    : [
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
        {isBuyer
          ? 'Sellers see these counts on your profile.'
          : 'Buyers see these counts on your profile. Responding to more requirements raises your standing.'}
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

/** A seller's counterpart to CtaBanner — there's nothing to post, so it only
 *  appears while verification (required before quoting) is still missing. */
function SellerVerifyBanner({ onCompleteVerification }: { onCompleteVerification?: () => void }) {
  return (
    <View style={styles.ctaBanner}>
      <View style={{ flexShrink: 1, minWidth: 200, gap: space.xs }}>
        <Text style={styles.ctaTitle}>Ready to win new business?</Text>
        <Text style={styles.ctaSubtitle}>Complete verification to submit quotations on open requirements.</Text>
      </View>
      <View style={styles.ctaActions}>
        <FeedButton label="Complete Verification" variant="primary" onPress={onCompleteVerification} />
      </View>
    </View>
  );
}

/** The banner at the top of the centre column — buyer or seller flavour. */
/* ─── Getting started (first-time guide) ──────────────
 * A new account sees three steps, each ticked off from its own data, each with
 * one button. It disappears once all are done, or when hidden (remembered per
 * account in this browser — a convenience, so storage failing is harmless). */

function guideHiddenKey(viewerId: string) {
  return `trustlink.guideHidden.${viewerId}`;
}

function GettingStartedCard(props: HomeFeedProps) {
  const { viewer } = props;
  const [hidden, setHidden] = useState(() => {
    try {
      return typeof window !== 'undefined' && window.localStorage.getItem(guideHiddenKey(viewer.id)) === '1';
    } catch {
      return false;
    }
  });
  const c = viewer.credibility;
  const verified = c.status === 'VERIFIED';
  const steps: { label: string; done: boolean; action?: { label: string; onPress?: () => void } }[] =
    viewer.role === 'buyer'
      ? [
          { label: 'Get your business verified', done: verified, action: { label: 'Complete verification', onPress: props.onCompleteVerification } },
          { label: 'Post your first requirement', done: c.requirementsPosted > 0, action: verified ? { label: 'Post a requirement', onPress: props.onPostRequirement } : undefined },
          { label: 'Review the quotations and award one', done: c.requirementsAwarded > 0, action: c.requirementsPosted > 0 ? { label: 'My requirements', onPress: props.onManageRequirements } : undefined },
        ]
      : [
          { label: 'Get your business verified', done: verified, action: { label: 'Complete verification', onPress: props.onCompleteVerification } },
          { label: 'Add your capabilities so the right requirements find you', done: viewer.capabilities.length > 0, action: { label: 'Update your capabilities', onPress: props.onUpdateCapabilities } },
          { label: 'Submit your first quotation from the feed below', done: c.quotationsSubmitted > 0 },
        ];
  const doneCount = steps.filter((st) => st.done).length;
  if (hidden || doneCount === steps.length) return null;
  const next = steps.find((st) => !st.done);

  const hide = () => {
    setHidden(true);
    try {
      window.localStorage.setItem(guideHiddenKey(viewer.id), '1');
    } catch {
      // Private mode or blocked storage — it just reappears next visit.
    }
  };

  return (
    <View style={styles.guideCard}>
      <View style={styles.guideHeader}>
        <Text style={styles.guideTitle}>Getting started · {doneCount} of {steps.length}</Text>
        <Pressable onPress={hide} hitSlop={8} accessibilityRole="button">
          <Text style={styles.guideHide}>Hide</Text>
        </Pressable>
      </View>
      {steps.map((st, i) => (
        <View key={st.label} style={styles.guideRow}>
          <View style={[styles.guideCheck, st.done ? styles.guideCheckDone : null]}>
            <Text style={[styles.guideCheckLabel, st.done ? { color: color.onPrimary } : null]}>{st.done ? '✓' : i + 1}</Text>
          </View>
          <Text style={[styles.guideStep, st.done ? styles.guideStepDone : null]}>{st.label}</Text>
          {st === next && st.action?.onPress && (
            <FeedButton label={st.action.label} variant="primary" onPress={st.action.onPress} />
          )}
        </View>
      ))}
    </View>
  );
}

function RoleBanner(props: HomeFeedProps) {
  const { viewer, myRequirements, recentlyClosed } = props;
  const verified = viewer.credibility.status === 'VERIFIED';
  if (viewer.role !== 'buyer') {
    return verified ? null : <SellerVerifyBanner onCompleteVerification={props.onCompleteVerification} />;
  }
  return (
    <CtaBanner
      verified={verified}
      onPostRequirement={props.onPostRequirement}
      onCompleteVerification={props.onCompleteVerification}
      hasPreviousRequirement={myRequirements.length > 0 || recentlyClosed.length > 0}
      onUsePreviousRequirement={props.onUsePreviousRequirement}
    />
  );
}

/* ─── Feed card ──────────────────────────────────────── */

/** `transitionProperty`/`transitionDuration` aren't in RN's ViewStyle type — react-native-web
 *  passes them straight through to CSS, same escape hatch as stickyOnWeb/fixedOnWeb below.
 *  Native has no hover state to transition, so this is a no-op there. */
const cardHoverTransitionOnWeb: ViewStyle =
  Platform.OS === 'web'
    ? ({
        transitionProperty: 'transform, border-color, box-shadow',
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
        cardShadow,
        cardHoverTransitionOnWeb,
        { borderColor: urgent ? (hovered ? color.danger : color.dangerBorder) : hovered ? color.borderStrong : color.borderFaint },
        hovered ? [styles.cardHovered, cardShadowHovered] : null,
        matched ? styles.cardMatched : null,
      ]}
    >
      <View style={styles.cardTopRow}>
        <View style={styles.categoryBadge}>
          <Text style={styles.categoryBadgeLabel}>
            {requirement.itemName ? `${requirement.category} · ${requirement.itemName}` : requirement.category}
          </Text>
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
          <Text style={styles.microLabel}>{requirement.strictBudget ? 'Budget · strict max' : 'Budget'}</Text>
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

  const [hovered, hoverHandlers] = useHover();

  return (
    <Pressable
      {...hoverHandlers}
      onPress={onSelect}
      style={[
        styles.myReqRow,
        cardShadow,
        webTransition('transform, border-color, box-shadow'),
        hovered && [styles.rowHovered, cardShadowHovered],
      ]}
    >
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
    </Pressable>
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
  const [hovered, hoverHandlers] = useHover();
  return (
    <Pressable
      {...hoverHandlers}
      style={[styles.closingSoonRow, webTransition('background-color'), hovered && styles.closingSoonRowHovered]}
      onPress={onSelect}
    >
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
      <View style={{ marginTop: space.md, alignSelf: 'flex-start' }}>
        <FeedButton label="Update your capabilities" variant="primary" onPress={onUpdateCapabilities} />
      </View>
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
  // Buyers get their own requirements and the post CTA; sellers get the
  // opportunities feed, closing-soon rail, and matching explainer instead.
  const isSeller = viewer.role !== 'buyer';

  return (
    <View style={styles.root}>
    <ScreenScroll style={styles.root} contentContainerStyle={styles.scrollContent}>
      <View style={styles.page}>
        {isSeller && <CategoryPills categories={st.categories} active={st.categoryFilter} onSelect={st.setCategoryFilter} />}
        <ProfileCard viewer={viewer} onAddMayorsPermit={props.onAddMayorsPermit} />
        <ActivityStatsCard viewer={viewer} />
        <GettingStartedCard {...props} />
        <RoleBanner {...props} />

        {isSeller && <>
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
        </>}

        {!isSeller && (
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
        )}

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

        {isSeller && <>
        {st.closingSoon.length > 0 && (
        <View style={styles.sectionBlock}>
          <Text style={styles.microLabel}>Closing within 24 hours · {st.closingSoon.length}</Text>
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
        )}

        <HowMatchingWorksCard onUpdateCapabilities={props.onUpdateCapabilities} />
        </>}
      </View>
    </ScreenScroll>
    <ChatWidget
      threads={messageThreads}
      messagesByThread={messagesByThread}
      viewerId={viewer.id}
      now={st.now}
      onSend={props.onSendMessage}
      onOpenThread={props.onOpenThread}
      onOpenAttachment={props.onOpenAttachment}
      autoOpenThreadId={props.autoOpenThreadId}
      onExpandMessages={props.onExpandMessages}
      fulfillmentByThread={props.fulfillmentByThread}
    />
    </View>
  );
}

/* ─── Wide layout ─────────────────────────────────────
 * Reproduces docs/design/Trustlink Home Feed.dc.html's structure directly: left sidebar
 * (profile + stats), centre column (CTA, feed, your requirements, recently closed), right
 * sidebar (closing-soon rail, how-matching), floating messages widget. Capped at
 * layout.maxWidthDashboard — the same centred width as the header and every other
 * wide page (LinkedIn-style), so the three columns sit under the nav rather than
 * stretching to the window edges.
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
  // Buyers get their own requirements and the post CTA; sellers get the
  // opportunities feed, closing-soon rail, and matching explainer instead.
  const isSeller = viewer.role !== 'buyer';
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
          {isSeller && <CategoryPills categories={st.categories} active={st.categoryFilter} onSelect={st.setCategoryFilter} />}
        </View>
      </View>

      <View style={styles.pageWide}>
        <View style={styles.columnsWide}>
          <View style={[styles.sideColumn, stickyOnWeb, sidebarTop]}>
            <ProfileCard viewer={viewer} onAddMayorsPermit={props.onAddMayorsPermit} />
            <ActivityStatsCard viewer={viewer} />
          </View>

          <View style={styles.mainColumnWide}>
            <GettingStartedCard {...props} />
            <RoleBanner {...props} />

            {isSeller && <>
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
            </>}

            {!isSeller && (
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
            )}

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

          {isSeller && (
          <View style={[styles.sideColumn, stickyOnWeb, sidebarTop]}>
            {/* Only when something actually closes soon — an empty card under a
                bold heading read like a broken widget to a new user. */}
            {st.closingSoon.length > 0 && (
            <View style={styles.statsCard}>
              <Text style={styles.microLabel}>Closing within 24 hours · {st.closingSoon.length}</Text>
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
            )}
            <HowMatchingWorksCard onUpdateCapabilities={props.onUpdateCapabilities} />
          </View>
          )}
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
      onOpenAttachment={props.onOpenAttachment}
      autoOpenThreadId={props.autoOpenThreadId}
      onExpandMessages={props.onExpandMessages}
      fulfillmentByThread={props.fulfillmentByThread}
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
  root: { flex: 1, backgroundColor: color.surfaceSunken },
  scrollContent: { paddingBottom: space.section },
  scrollContentWide: { paddingBottom: space.section },
  page: { width: '100%', paddingHorizontal: layout.screenPadding, gap: space.lg, paddingTop: space.lg },
  pageWide: { width: '100%', maxWidth: layout.maxWidthDashboard, marginHorizontal: 'auto', paddingHorizontal: layout.screenPadding },
  categorySticky: { backgroundColor: color.surfaceSunken, borderBottomWidth: 1, borderBottomColor: color.borderFaint, zIndex: 40 },
  columnsWide: { flexDirection: 'row', alignItems: 'flex-start', gap: space.xxl, paddingVertical: space.xl },
  sideColumn: { flex: 1, minWidth: layout.sideColumnMinWidth, maxWidth: 340, gap: space.lg },
  mainColumnWide: { flex: 3, minWidth: 0, gap: space.lg },
  sectionBlock: { gap: space.md, marginTop: space.xl },

  /* messages dock — one bordered card, flush to the bottom-right corner. dockPanel is the
   * whole card (content pane + bar); its rounded top corners read correctly whether the
   * pane above is open or collapsed to nothing, since the bar's own edges never carry a
   * radius of their own */
  dockPanel: { ...elevation.cardRaised, backgroundColor: color.surface, borderWidth: 1, borderColor: color.border, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, overflow: 'hidden' },
  dockScroll: { flex: 1 },
  dockMeta: { fontFamily: font.mono, fontSize: 10, letterSpacing: letterSpacing.label, textTransform: 'uppercase', color: color.inkFaint },
  dockEmpty: { padding: space.xl },
  dockEmptyText: { fontFamily: font.body, fontSize: fontSize.sm, lineHeight: lineHeight.sm, color: color.inkMuted, textAlign: 'center' },

  alertTopRow: { flexDirection: 'row', alignItems: 'baseline', gap: space.sm },
  alertTime: { fontFamily: font.mono, fontSize: fontSize.micro, color: color.inkFaint },

  threadRow: { flexDirection: 'row', alignItems: 'flex-start', gap: space.md, padding: space.md, borderBottomWidth: 1, borderBottomColor: color.borderFaint },
  threadRowPressed: { backgroundColor: color.surfaceSunken },
  threadUnreadDot: { backgroundColor: color.primary, marginTop: space.xs },
  threadName: { flex: 1, fontSize: fontSize.sm, color: color.ink },
  threadPreview: { fontFamily: font.body, fontSize: fontSize.sm },
  threadRef: { fontFamily: font.mono, fontSize: fontSize.micro, letterSpacing: letterSpacing.label, textTransform: 'uppercase', color: color.inkFaint },

  closeoutError: { fontFamily: font.body, fontSize: fontSize.micro, color: color.danger },

  /* conversation view */
  bubbleList: { padding: space.md, gap: space.sm, flexGrow: 1 },
  daySeparator: { flexDirection: 'row', alignItems: 'center', gap: space.sm, marginVertical: space.xs },
  daySeparatorLine: { flex: 1, height: 1, backgroundColor: color.borderFaint },
  daySeparatorLabel: { fontFamily: font.mono, fontSize: 10, letterSpacing: letterSpacing.label, textTransform: 'uppercase', color: color.inkFaint },
  bubbleRow: { alignSelf: 'flex-start', maxWidth: '82%', gap: 2 },
  bubbleRowMine: { alignSelf: 'flex-end', alignItems: 'flex-end' },
  bubble: { borderRadius: radius.lg, paddingHorizontal: space.md, paddingVertical: space.sm },
  bubbleTheirs: { backgroundColor: color.surfaceSunken, borderBottomLeftRadius: radius.sm },
  bubbleMine: { backgroundColor: color.primaryFaint, borderWidth: 1, borderColor: color.primaryBorder, borderBottomRightRadius: radius.sm },
  bubbleText: { fontFamily: font.body, fontSize: fontSize.sm, lineHeight: lineHeight.sm, color: color.ink },
  bubbleTime: { fontFamily: font.mono, fontSize: 10, color: color.inkFaint },
  systemBubble: {
    alignSelf: 'stretch',
    gap: space.sm,
    borderWidth: 1,
    borderColor: color.primaryBorder,
    borderLeftWidth: 3,
    borderLeftColor: color.primary,
    borderRadius: radius.lg,
    backgroundColor: color.primaryFaint,
    paddingHorizontal: space.md,
    paddingVertical: space.md,
  },
  systemBubbleHead: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  systemBubbleLabel: {
    fontFamily: font.mono,
    fontSize: 10,
    letterSpacing: letterSpacing.label,
    textTransform: 'uppercase',
    color: color.primary,
  },

  composerAttach: { width: 32, height: 36, alignItems: 'center', justifyContent: 'center', borderRadius: radius.pill },
  composerAttachIcon: { fontSize: fontSize.base, color: color.inkMuted },
  composerStaged: { gap: space.xs, paddingHorizontal: space.md, paddingTop: space.sm, borderTopWidth: 1, borderTopColor: color.border },
  stagedChip: { flexDirection: 'row', alignItems: 'center', gap: space.sm, borderWidth: 1, borderColor: color.border, borderRadius: radius.md, backgroundColor: color.surfaceSunken, paddingHorizontal: space.sm, paddingVertical: space.xs },
  attachmentCard: { flexDirection: 'row', alignItems: 'center', gap: space.sm, borderWidth: 1, borderColor: color.border, borderRadius: radius.md, backgroundColor: color.surface, paddingHorizontal: space.sm, paddingVertical: space.xs, minWidth: 180 },
  attachmentIcon: { fontSize: fontSize.sm },
  attachmentName: { fontFamily: font.bodyMedium, fontSize: fontSize.sm, color: color.ink },
  composerClosed: { padding: space.md, borderTopWidth: 1, borderTopColor: color.border, backgroundColor: color.surfaceSunken },
  composerClosedText: { fontFamily: font.body, fontSize: fontSize.sm, lineHeight: lineHeight.sm, color: color.inkMuted, textAlign: 'center' },
  composerRow: { flexDirection: 'row', alignItems: 'flex-end', gap: space.sm, padding: space.md, borderTopWidth: 1, borderTopColor: color.border },
  composerInput: { flex: 1, minHeight: 36, maxHeight: 80, borderWidth: 1, borderColor: color.border, borderRadius: radius.lg, paddingHorizontal: space.md, paddingVertical: space.sm, fontFamily: font.body, fontSize: fontSize.sm, color: color.ink },
  composerSend: { minHeight: 36, justifyContent: 'center', backgroundColor: color.primary, borderRadius: radius.pill, paddingHorizontal: space.lg, paddingVertical: space.sm },
  composerSendLabel: { fontFamily: font.bodySemi, fontSize: fontSize.sm, color: color.onPrimary },

  /* dock row — right edge pinned via `right`, grows leftward as conversation windows open;
   * every item (conversation windows, then the list card) shares the bottom edge */
  chatWidget: { right: space.xl, bottom: 0, flexDirection: 'row', alignItems: 'flex-end', gap: space.md, zIndex: 80 },
  chatWidgetCompact: { right: space.lg },
  /* dock bar/header — fixed-height row at the top of dockPanel, its bottom border
   * only drawn while the pane below it is expanded so it reads as one divider, not a
   * doubled edge */
  dockBar: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingHorizontal: space.lg, paddingVertical: space.md },
  dockBarOpen: { borderBottomWidth: 1, borderBottomColor: color.border },
  dockBarLabel: { fontFamily: font.bodySemi, fontSize: fontSize.sm, color: color.ink },
  dockMark: { width: 16, height: 16, borderRadius: radius.pill },
  dockHeaderPress: { flexDirection: 'row', alignItems: 'center', gap: space.sm, flex: 1, minWidth: 0 },
  chatBadge: { backgroundColor: color.primary, borderRadius: radius.pill, paddingHorizontal: space.xs, paddingVertical: 1, minWidth: 16, alignItems: 'center' },
  chatBadgeLabel: { fontFamily: font.mono, fontSize: fontSize.micro, color: color.onPrimary },

  /* conversation window header glyphs — × close, and a rotate-driven chevron for
   * collapse/expand, same border-corner technique QuotationSubmission.tsx's own
   * chevronGlyph/chevronGlyphOpen pair uses */
  expandGlyph: { width: 11, height: 11, borderWidth: 1.5, borderColor: color.inkMuted, borderRadius: 2 },
  closeGlyphBox: { width: 10, height: 10, alignItems: 'center', justifyContent: 'center' },
  closeGlyphBar: { position: 'absolute', width: 10, height: 1.4, borderRadius: 1, backgroundColor: color.inkMuted },
  dockChevron: { width: 6, height: 6, borderRightWidth: 1.4, borderBottomWidth: 1.4, borderColor: color.inkMuted, transform: [{ rotate: '45deg' }] },
  dockChevronUp: { transform: [{ rotate: '-135deg' }] },

  /* category pills */
  categoryRow: { flexDirection: 'row', gap: space.sm, paddingVertical: space.md },
  categoryPill: { flexDirection: 'row', alignItems: 'center', gap: space.sm, borderWidth: 1, borderColor: color.border, borderRadius: radius.pill, backgroundColor: color.surface, paddingHorizontal: space.lg, paddingVertical: space.sm },
  categoryPillHovered: { borderColor: color.borderStrong },
  categoryPillActive: { backgroundColor: color.ink, borderColor: color.ink },
  categoryPillLabel: { fontFamily: font.bodyMedium, fontSize: fontSize.sm, color: color.inkMuted },
  categoryPillLabelActive: { color: color.canvas },
  categoryPillCountBubble: { minWidth: 20, alignItems: 'center', borderRadius: radius.pill, backgroundColor: color.surfaceSunken, paddingHorizontal: 6, paddingVertical: 1 },
  categoryPillCountBubbleActive: { backgroundColor: 'rgba(255, 255, 255, 0.16)' },
  categoryPillCount: { fontFamily: font.mono, fontSize: fontSize.micro, color: color.inkMuted },
  categoryPillCountActive: { color: color.canvas },
  pressedScale: { transform: [{ scale: 0.97 }] },

  /* profile sidebar */
  profileCard: { ...elevation.card, borderRadius: radius.xl, backgroundColor: color.surface, padding: space.xl },
  profileTopRow: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  profileName: { fontFamily: font.display, fontSize: fontSize.md, color: color.ink },
  profileVerified: { marginTop: space.xs, fontFamily: font.mono, fontSize: fontSize.micro, letterSpacing: letterSpacing.label, textTransform: 'uppercase', color: color.primary },
  profileFactList: { gap: space.sm, marginTop: space.lg, paddingTop: space.lg, borderTopWidth: 1, borderTopColor: color.borderFaint },
  profileFactRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  profileFact: { fontFamily: font.body, fontSize: fontSize.sm, color: color.inkMuted },
  profileSection: { marginTop: space.lg, paddingTop: space.lg, borderTopWidth: 1, borderTopColor: color.borderFaint },
  profileSectionRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  profileSectionValue: { fontFamily: font.display, fontSize: fontSize.sm, color: color.ink },
  profileSectionValueMono: { fontFamily: font.mono, fontSize: fontSize.sm, color: color.ink },
  profileSectionCaption: { marginTop: space.sm, fontFamily: font.body, fontSize: fontSize.sm, lineHeight: lineHeight.sm, color: color.inkMuted },
  tierBarRow: { flexDirection: 'row', gap: space.xs, marginTop: space.sm },
  tierBarSegment: { flex: 1, height: 5, borderRadius: radius.pill, backgroundColor: color.borderFaint },
  tierBarSegmentFilled: { backgroundColor: color.primary },
  progressTrack: { height: 5, borderRadius: radius.pill, backgroundColor: color.borderFaint, marginTop: space.sm, overflow: 'hidden' },
  progressFill: { height: '100%', backgroundColor: color.primary, borderRadius: radius.pill },
  profileNextStep: { marginTop: space.md },
  profileNextStepLabel: { fontFamily: font.bodyMedium, fontSize: fontSize.sm, color: color.ink },

  /* activity stats */
  statsCard: { ...elevation.card, borderRadius: radius.xl, backgroundColor: color.surface, padding: space.xl },
  guideCard: { gap: space.sm, borderRadius: radius.xl, borderWidth: 1, borderColor: color.primaryBorder, backgroundColor: color.primaryFaint, padding: space.lg, marginBottom: space.md },
  guideHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  guideTitle: { fontFamily: font.bodySemi, fontSize: fontSize.base, color: color.ink },
  guideHide: { fontFamily: font.bodyMedium, fontSize: fontSize.sm, color: color.inkMuted, textDecorationLine: 'underline' },
  guideRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, flexWrap: 'wrap', minHeight: 36 },
  guideCheck: { width: 24, height: 24, borderRadius: radius.pill, borderWidth: 1.5, borderColor: color.primary, alignItems: 'center', justifyContent: 'center', backgroundColor: color.surface },
  guideCheckDone: { backgroundColor: color.primary },
  guideCheckLabel: { fontFamily: font.bodySemi, fontSize: fontSize.sm, color: color.primary },
  guideStep: { flex: 1, minWidth: 160, fontFamily: font.body, fontSize: fontSize.sm, lineHeight: lineHeight.sm, color: color.ink },
  guideStepDone: { color: color.inkMuted, textDecorationLine: 'line-through' },
  statRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', paddingVertical: space.sm, borderBottomWidth: 1, borderBottomColor: color.borderFaint },
  statLabel: { fontFamily: font.body, fontSize: fontSize.sm, color: color.inkMuted },
  statValue: { fontFamily: font.display, fontSize: fontSize.md, color: color.ink },
  statsCaption: { marginTop: space.md, fontFamily: font.body, fontSize: fontSize.sm, lineHeight: lineHeight.sm, color: color.inkMuted },
  howMatchingBody: { marginTop: space.sm, fontFamily: font.body, fontSize: fontSize.sm, lineHeight: lineHeight.sm, color: color.inkMuted },

  /* CTA banner */
  ctaBanner: { borderWidth: 1, borderColor: color.primaryBorder, borderRadius: radius.xl, backgroundColor: color.primaryFaint, padding: space.lg, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.lg, flexWrap: 'wrap' },
  ctaTitle: { fontFamily: font.bodySemi, fontSize: fontSize.base, color: color.ink },
  ctaSubtitle: { fontFamily: font.body, fontSize: fontSize.sm, color: color.inkMuted },
  ctaActions: { flexDirection: 'row', gap: space.sm, flexWrap: 'wrap' },

  /* section headers */
  sectionHeaderRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: space.md },
  sectionHeading: { fontFamily: font.display, fontSize: fontSize.xl, color: color.ink },
  manageAllLink: { fontFamily: font.bodyMedium, fontSize: fontSize.sm, color: color.primary },
  microLabel: { fontFamily: font.mono, fontSize: fontSize.micro, letterSpacing: letterSpacing.label, textTransform: 'uppercase', color: color.inkFaint },
  mutedSmall: { fontFamily: font.body, fontSize: fontSize.sm, color: color.inkMuted },
  emptyOpportunities: { borderWidth: 1, borderStyle: 'dashed', borderColor: color.border, borderRadius: radius.xl, backgroundColor: color.surface, padding: space.xl, alignItems: 'center' },

  /* feed card */
  card: { borderWidth: 1, borderRadius: radius.xl, backgroundColor: color.surface, padding: space.xl, gap: space.md },
  cardMatched: { borderLeftWidth: 3, borderLeftColor: color.primary },
  cardHovered: { transform: [{ translateY: -2 }] },
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
  myReqRow: { ...elevation.card, borderRadius: radius.xl, backgroundColor: color.surface, padding: space.lg, flexDirection: 'row', alignItems: 'center', gap: space.lg, flexWrap: 'wrap' },
  myReqStatusRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  myReqStatusLabel: { fontFamily: font.mono, fontSize: fontSize.micro, letterSpacing: letterSpacing.label, textTransform: 'uppercase' },
  myReqTitle: { fontFamily: font.display, fontSize: fontSize.base, color: color.ink },
  myReqRight: { flexDirection: 'row', alignItems: 'center', gap: space.xl },
  myReqCount: { fontFamily: font.display, fontSize: fontSize.xl, color: color.ink },
  rowHovered: { borderColor: color.borderStrong, transform: [{ translateY: -1 }] },

  /* recently closed */
  closedRow: { ...elevation.card, borderRadius: radius.xl, backgroundColor: color.surface, padding: space.lg, flexDirection: 'row', alignItems: 'center', gap: space.lg, flexWrap: 'wrap' },
  closedTitle: { fontFamily: font.bodySemi, fontSize: fontSize.base, color: color.ink },
  outcomeTag: { flexDirection: 'row', alignItems: 'center', gap: space.sm, borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: space.md, paddingVertical: space.sm },
  outcomeLabel: { fontFamily: font.bodyMedium, fontSize: fontSize.sm },

  /* closing soon */
  closingSoonRow: { gap: space.xs, paddingVertical: space.md, paddingHorizontal: space.sm, marginHorizontal: -space.sm, borderRadius: radius.md, borderBottomWidth: 1, borderBottomColor: color.borderFaint },
  closingSoonRowHovered: { backgroundColor: color.surfaceSunken },
  closingSoonTitle: { fontFamily: font.bodySemi, fontSize: fontSize.sm, color: color.ink },
  closingSoonCountdown: { fontFamily: font.mono, fontSize: fontSize.sm, color: color.danger },
});
