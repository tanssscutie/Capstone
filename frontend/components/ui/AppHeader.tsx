// components/ui/AppHeader.tsx
// Top navigation chrome: logo, search, primary nav (with count badges), account block.
// Mounted once by app/_layout.tsx so every post-login screen gets it — screens themselves
// never render their own header. Extracted from features/home-feed/HomeFeed.tsx, which
// used to own a local copy.
//
// Dynamic behavior: the header is a floating, translucent bar that condenses as the
// user scrolls down. The scroll offset is piped in from any screen via
// HeaderScrollContext. When no provider is present (e.g. a screen without a
// scroll view), the header stays in its expanded state.

import type { ComponentType } from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  StyleSheet,
  Image,
  useWindowDimensions,
  Animated,
  Platform,
} from 'react-native';
import { useRouter, usePathname, useGlobalSearchParams } from 'expo-router';
import {
  color,
  font,
  fontSize,
  letterSpacing,
  space,
  radius,
  layout,
  breakpoint,
} from './tokens';
import { AvatarChip, initials } from './AvatarChip';
import type { Business, TrustTier } from '../../lib/types';
import { useHeaderScroll, HEADER_CONDENSE_AT } from './HeaderScrollContext';
import { useViewer } from '../../lib/api/viewer';
import AccountDropdown from './AccountDropdown';

function tierLabel(tier: TrustTier | null): string {
  return tier === null ? 'Unrated' : `Tier ${tier}`;
}

/* ─── Nav icons ──────────────────────────────────────
 * Simple shape-built glyphs — no icon library, same precedent as HomeFeed.tsx's
 * CategoryIcon/PinIcon/BookmarkIcon (borders, dots, lines; no react-native-svg dep). */

type IconProps = { tone: string };

function HouseIcon({ tone }: IconProps) {
  return (
    <View style={styles.iconStack}>
      <View style={[styles.houseRoof, { borderBottomColor: tone }]} />
      <View style={[styles.houseBody, { borderColor: tone }]} />
    </View>
  );
}

function DocumentIcon({ tone }: IconProps) {
  return (
    <View style={[styles.docBody, { borderColor: tone }]}>
      <View style={[styles.docLine, { backgroundColor: tone }]} />
      <View style={[styles.docLine, { backgroundColor: tone, width: 5 }]} />
    </View>
  );
}

function CalendarIcon({ tone }: IconProps) {
  return (
    <View style={styles.iconStack}>
      <View style={styles.calendarHangerRow}>
        <View style={[styles.calendarHanger, { backgroundColor: tone }]} />
        <View style={[styles.calendarHanger, { backgroundColor: tone }]} />
      </View>
      <View style={[styles.calendarBody, { borderColor: tone }]}>
        <View style={[styles.calendarHeaderLine, { backgroundColor: tone }]} />
      </View>
    </View>
  );
}

function SavedIcon({ tone }: IconProps) {
  return <View style={[styles.bookmark, { borderColor: tone }]} />;
}

function BellIcon({ tone }: IconProps) {
  return (
    <View style={styles.iconStack}>
      <View style={[styles.bellDome, { borderColor: tone }]} />
      <View style={[styles.bellBase, { backgroundColor: tone }]} />
      <View style={[styles.bellClapper, { backgroundColor: tone }]} />
    </View>
  );
}

interface NavItem {
  label: string;
  href: string;
  Icon: ComponentType<IconProps>;
  badge?: number;
}

export interface AppHeaderProps {
  /** Optional override; if omitted, the header uses the logged-in viewer's
   *  profile from ViewerContext. */
  viewer?: Business;
  /** Unread alert count shown on the Alerts nav item's badge. */
  alertCount?: number;
}

export default function AppHeader({ viewer: viewerOverride, alertCount = 0 }: AppHeaderProps) {
  const router = useRouter();
  const pathname = usePathname();
  const { q: routeQuery } = useGlobalSearchParams<{ q?: string }>();
  const { width } = useWindowDimensions();
  const isWide = width >= breakpoint.desktop;
  const { viewer: contextViewer } = useViewer();
  const viewer = viewerOverride ?? contextViewer;

  // Search: a real query against the open-requirements feed ("Business
  // Opportunities" on Home), not a decorative field. Typing debounces into the
  // `/home?q=` route param — HomeFeed.tsx reads it back and filters. On any
  // other screen, submitting navigates to Home with the query already applied.
  const [searchDraft, setSearchDraft] = useState('');
  const searchDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (pathname === '/home') setSearchDraft(typeof routeQuery === 'string' ? routeQuery : '');
  }, [pathname, routeQuery]);

  useEffect(() => {
    return () => {
      if (searchDebounce.current) clearTimeout(searchDebounce.current);
    };
  }, []);

  const handleSearchChange = (text: string) => {
    setSearchDraft(text);
    // Live-filter while already on Home. On any other screen, typing just
    // fills the box — navigating away mid-keystroke (and stacking a history
    // entry per pause) would be a worse experience than waiting for submit.
    if (pathname !== '/home') return;
    if (searchDebounce.current) clearTimeout(searchDebounce.current);
    searchDebounce.current = setTimeout(() => router.setParams({ q: text.trim() }), 300);
  };

  const handleSearchSubmit = () => {
    if (searchDebounce.current) clearTimeout(searchDebounce.current);
    const q = searchDraft.trim();
    if (pathname === '/home') {
      router.setParams({ q });
    } else if (q) {
      router.push({ pathname: '/home', params: { q } });
    }
  };

  const scroll = useHeaderScroll();
  // progress: 0 at top (expanded), 1 once scrolled past HEADER_CONDENSE_AT
  const progress = useMemo(() => {
    if (!scroll) return null;
    return scroll.interpolate({
      inputRange: [0, HEADER_CONDENSE_AT],
      outputRange: [0, 1],
      extrapolate: 'clamp',
    });
  }, [scroll]);

  // Animated values
  const containerPaddingV = progress
    ? progress.interpolate({ inputRange: [0, 1], outputRange: [space.sm, space.xs] })
    : space.sm;
  const logoMarkSize = progress
    ? progress.interpolate({ inputRange: [0, 1], outputRange: [24, 20] })
    : 24;
  const backdropOpacity = progress
    ? progress.interpolate({ inputRange: [0, 1], outputRange: [1, 0.82] })
    : 1;
  const searchVisible = progress ? progress.interpolate({ inputRange: [0, 0.5], outputRange: [1, 0], extrapolate: 'clamp' }) : 1;
  const searchHeight = progress
    ? progress.interpolate({ inputRange: [0, 1], outputRange: [36, 0] })
    : 36;
  const searchOpacity = progress
    ? progress.interpolate({ inputRange: [0, 0.6], outputRange: [1, 0], extrapolate: 'clamp' })
    : 1;
  const borderOpacity = progress
    ? progress.interpolate({ inputRange: [0, 1], outputRange: [1, 0.4] })
    : 1;
  const profileTierOpacity = progress
    ? progress.interpolate({ inputRange: [0, 0.7], outputRange: [1, 0], extrapolate: 'clamp' })
    : 1;

  const primaryNav: NavItem[] = [
    { label: 'Home', href: '/home', Icon: HouseIcon },
    { label: 'My Quotations', href: '/quotations', Icon: DocumentIcon },
    { label: 'My Requirements', href: '/requirements', Icon: CalendarIcon },
    { label: 'Saved', href: '/saved', Icon: SavedIcon },
  ];
  const alertsNav: NavItem = { label: 'Alerts', href: '/alerts', Icon: BellIcon, badge: alertCount };

  // Account dropdown: anchor the menu under the profile chip using the
  // chip's ABSOLUTE screen position (measureInWindow), not onLayout's x/y —
  // those are relative to the immediate parent, not the window, and would
  // put the offset wrong as soon as the chip isn't flush against the
  // window's left edge (which it never is here, since it lives inside
  // headerRight on the right side of the row). We measure fresh each time
  // the menu opens rather than caching a stale onLayout value, so rotation/
  // resize/scroll can't leave the anchor stale.
  const chipRef = useRef<View>(null);
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const [chipLayout, setChipLayout] = useState<{ top: number; right: number } | null>(null);

  const openAccountMenu = () => {
    const node = chipRef.current;
    if (!node) {
      setAccountMenuOpen(true);
      return;
    }
    node.measureInWindow((x, y, chipWidth, chipHeight) => {
      const rightOffset = Math.max(8, Math.round(width - (x + chipWidth)));
      setChipLayout({ top: Math.round(y + chipHeight), right: rightOffset });
      setAccountMenuOpen(true);
    });
  };

  const renderNavItem = (item: NavItem) => {
    const active = pathname === item.href;
    const tone = active ? color.ink : color.inkMuted;
    return (
      <Pressable key={item.label} style={[styles.navItem, active ? styles.navItemActive : null]} onPress={() => router.push(item.href)}>
        <View style={styles.navIconWrap}>
          <item.Icon tone={tone} />
          {!!item.badge && (
            <View style={styles.navBadge}>
              <Text style={styles.navBadgeLabel}>{item.badge}</Text>
            </View>
          )}
        </View>
        <Text style={[styles.navLabel, active ? styles.navLabelActive : null]}>{item.label}</Text>
      </Pressable>
    );
  };

  // Viewer hasn't loaded yet (e.g. profile fetch still in flight, or no
  // override and no context value). Render nothing rather than a header
  // with a broken profile chip; it pops in once the viewer resolves.
  if (!viewer) {
    return null;
  }

  const name = viewer.registeredName || 'Your business';

  // Translucent floating header: position absolute so it floats over content,
  // and add a top inset equal to the header's expanded height so content isn't
  // hidden behind it on screens that scroll. The layout in _layout.tsx
  // accounts for this by giving the Stack a top padding via SafeAreaView-equivalent
  // (handled by the parent View paddingTop below).
  return (
    <Animated.View
      style={[
        styles.header,
        {
          paddingVertical: containerPaddingV,
          backgroundColor: color.canvas,
          opacity: backdropOpacity,
        },
      ]}
      pointerEvents="box-none"
    >
      <Animated.View
        style={[
          styles.headerBackdrop,
          { borderBottomColor: color.border, opacity: borderOpacity },
        ]}
        pointerEvents="none"
      />
      <View style={styles.headerRow}>
        <View style={styles.headerLeft}>
          <View style={styles.logoRow}>
            <Animated.View style={{ width: logoMarkSize, height: logoMarkSize }}>
              <Image
                source={require('../../assets/logo.jpg')}
                style={[styles.logoMark, { width: logoMarkSize, height: logoMarkSize }]}
                resizeMode="contain"
              />
            </Animated.View>
            <Text style={styles.logoText}>Trustlink</Text>
          </View>
        </View>

        <Animated.View style={[styles.headerCenter, { maxHeight: searchHeight, opacity: searchOpacity }]}>
          <Animated.View style={[styles.searchField, { opacity: searchVisible }]}>
            <TextInput
              value={searchDraft}
              onChangeText={handleSearchChange}
              onSubmitEditing={handleSearchSubmit}
              returnKeyType="search"
              placeholder="Search requirements or businesses"
              placeholderTextColor={color.inkFaint}
              style={styles.searchInput}
            />
          </Animated.View>
        </Animated.View>

        <View style={styles.headerRight}>
          {isWide && <View style={styles.navRow}>{primaryNav.map(renderNavItem)}</View>}

          {renderNavItem(alertsNav)}

          <Pressable
            ref={chipRef}
            style={styles.profileChip}
            onPress={openAccountMenu}
          >
            <AvatarChip label={initials(name)} size={32} />
            <View style={{ minWidth: 0 }}>
              <Text style={styles.profileChipName} numberOfLines={1}>{name}</Text>
              <Animated.Text style={[styles.profileChipTier, { opacity: profileTierOpacity }]}>
                Verified · {tierLabel(viewer.credibility.tier)}
              </Animated.Text>
            </View>
          </Pressable>
        </View>
      </View>

      {accountMenuOpen && chipLayout && (
        <AccountDropdown
          onDismiss={() => setAccountMenuOpen(false)}
          anchorTop={chipLayout.top}
          anchorRight={chipLayout.right}
        />
      )}
    </Animated.View>
  );
}

const HEADER_EXPANDED_HEIGHT = 64; // space.sm (8) * 2 + ~24 content + chrome
const HEADER_COLLAPSED_HEIGHT = 48; // space.xs (4) * 2 + ~20 content

export const APP_HEADER_RESERVED_HEIGHT = HEADER_EXPANDED_HEIGHT;

const styles = StyleSheet.create({
  header: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 50,
    width: '100%',
    // Subtle backdrop blur on web/native. We use opacity rather than a true
    // blur to avoid an extra native dep; the bar still reads as elevated
    // because the border + slight tint persist while condensed.
    ...(Platform.OS === 'web' ? { backdropFilter: 'saturate(180%) blur(8px)' } : null),
  },
  headerBackdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: color.canvas,
    borderBottomWidth: 1,
  },
  headerRow: {
    width: '100%',
    paddingHorizontal: layout.screenPadding,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    flexWrap: 'wrap',
  },
  headerLeft: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-start' },
  headerCenter: { flex: 1, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  headerRight: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: space.md, flexWrap: 'wrap' },
  logoRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  logoMark: { borderRadius: radius.pill },
  logoText: { fontFamily: font.display, fontSize: fontSize.base, color: color.ink },
  searchField: { width: '100%', minWidth: 140, maxWidth: 340, backgroundColor: color.surfaceSunken, borderWidth: 1, borderColor: color.border, borderRadius: radius.pill, paddingHorizontal: space.md, paddingVertical: space.sm },
  searchInput: { fontFamily: font.body, fontSize: fontSize.sm, color: color.ink },

  /* nav items: icon above label, count badge pinned to the icon, underline on active */
  navRow: { flexDirection: 'row', alignItems: 'flex-start', gap: space.xs },
  navItem: { alignItems: 'center', paddingHorizontal: space.sm, paddingTop: space.xs, paddingBottom: space.sm, gap: 4, borderBottomWidth: 2, borderBottomColor: 'transparent' },
  navItemActive: { borderBottomColor: color.ink },
  navIconWrap: { width: 16, height: 16, alignItems: 'center', justifyContent: 'center', position: 'relative' },
  navLabel: { fontFamily: font.body, fontSize: fontSize.sm, color: color.inkMuted },
  navLabelActive: { fontFamily: font.bodySemi, fontSize: fontSize.sm, color: color.ink },
  navBadge: { position: 'absolute', top: -5, right: -7, minWidth: 14, height: 14, borderRadius: radius.pill, backgroundColor: color.primary, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 3 },
  navBadgeLabel: { fontFamily: font.mono, fontSize: 9, lineHeight: 10, color: color.onPrimary },

  /* icon glyphs */
  iconStack: { alignItems: 'center' },
  houseRoof: { width: 0, height: 0, borderLeftWidth: 6, borderRightWidth: 6, borderBottomWidth: 6, borderLeftColor: 'transparent', borderRightColor: 'transparent' },
  houseBody: { width: 9, height: 6, marginTop: -1, borderWidth: 1.3 },
  docBody: { width: 10, height: 13, borderWidth: 1.2, borderRadius: 1.5, alignItems: 'center', justifyContent: 'center', gap: 2 },
  docLine: { width: 6, height: 1.2, borderRadius: 1 },
  calendarHangerRow: { flexDirection: 'row', justifyContent: 'space-between', width: 8, marginBottom: 1 },
  calendarHanger: { width: 1.3, height: 3, borderRadius: 1 },
  calendarBody: { width: 13, height: 11, borderWidth: 1.2, borderRadius: 1.5, paddingTop: 2 },
  calendarHeaderLine: { height: 1.2, marginHorizontal: 1.5 },
  bookmark: { width: 9, height: 12, borderWidth: 1.3, borderRadius: 1 },
  bellDome: { width: 10, height: 8, borderWidth: 1.3, borderTopLeftRadius: 5, borderTopRightRadius: 5, borderBottomLeftRadius: 1, borderBottomRightRadius: 1 },
  bellBase: { width: 12, height: 1.3, marginTop: 1, borderRadius: 1 },
  bellClapper: { width: 2.5, height: 2.5, marginTop: 1, borderRadius: 2 },

  profileChip: { flexDirection: 'row', alignItems: 'center', gap: space.sm, minWidth: 0 },
  profileChipName: { fontFamily: font.bodyMedium, fontSize: fontSize.sm, color: color.ink },
  profileChipTier: { fontFamily: font.mono, fontSize: 10, letterSpacing: letterSpacing.label, textTransform: 'uppercase', color: color.primary },
});