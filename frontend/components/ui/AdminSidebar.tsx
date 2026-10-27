// components/ui/AdminSidebar.tsx
// Shared nav shell for the admin area — used by the dashboard, businesses,
// and requirements pages, so a new page one-lines into ADMIN_NAV_ITEMS below
// instead of hand-rolled per screen. AdminSidebar is the desktop column;
// AdminMobileNav is the phone equivalent (top bar + tabs), so the admin area
// stays navigable below breakpoint.desktop too.
import { View, Text, Pressable, Image, StyleSheet } from 'react-native';
import { usePathname, useRouter } from 'expo-router';
import { color, font, fontSize, letterSpacing, space, radius } from './tokens';

type NavGlyphKind = 'dashboard' | 'businesses' | 'requirements' | 'reports' | 'changes';

export const ADMIN_NAV_ITEMS: {
  label: string;
  href: '/admin' | '/admin-businesses' | '/admin-requirements' | '/admin-reports' | '/admin-change-requests';
  glyph: NavGlyphKind;
}[] = [
  { label: 'Dashboard', href: '/admin', glyph: 'dashboard' },
  { label: 'Businesses', href: '/admin-businesses', glyph: 'businesses' },
  { label: 'Requirements', href: '/admin-requirements', glyph: 'requirements' },
  { label: 'Reports', href: '/admin-reports', glyph: 'reports' },
  { label: 'Change requests', href: '/admin-change-requests', glyph: 'changes' },
];

/** No icon library in this project — each glyph is a few plain Views. */
function NavGlyph({ kind, tone }: { kind: NavGlyphKind; tone: string }) {
  if (kind === 'dashboard') {
    return (
      <View style={glyph.box}>
        <View style={glyph.grid}>
          {[0, 1, 2, 3].map((i) => (
            <View key={i} style={[glyph.gridCell, { borderColor: tone }]} />
          ))}
        </View>
      </View>
    );
  }
  if (kind === 'businesses') {
    return (
      <View style={glyph.box}>
        <View style={[glyph.head, { borderColor: tone }]} />
        <View style={[glyph.shoulders, { borderColor: tone }]} />
      </View>
    );
  }
  if (kind === 'reports') {
    return (
      <View style={glyph.box}>
        <View style={glyph.flagRow}>
          <View style={[glyph.flagPole, { backgroundColor: tone }]} />
          <View style={[glyph.flag, { borderColor: tone }]} />
        </View>
      </View>
    );
  }
  return (
    <View style={glyph.box}>
      <View style={[glyph.doc, { borderColor: tone }]}>
        <View style={[glyph.docLine, { backgroundColor: tone }]} />
        <View style={[glyph.docLine, { backgroundColor: tone }]} />
        <View style={[glyph.docLine, glyph.docLineShort, { backgroundColor: tone }]} />
      </View>
    </View>
  );
}

export function AdminSidebar({ onLogout }: { onLogout: () => void }) {
  const pathname = usePathname();
  const router = useRouter();
  return (
    <View style={styles.sidebar}>
      <View>
        <View style={styles.brandRow}>
          <View style={styles.logoWrap}>
            <Image source={require('../../assets/logo.jpg')} style={styles.logo} resizeMode="contain" />
          </View>
          <View>
            <Text style={styles.brandEyebrow}>TrustLink</Text>
            <Text style={styles.brandTitle}>Admin console</Text>
          </View>
        </View>

        <Text style={styles.navHeading}>Manage</Text>
        <View style={styles.navSection}>
          {ADMIN_NAV_ITEMS.map((item) => {
            const active = pathname === item.href;
            return (
              <Pressable
                key={item.href}
                onPress={() => router.push(item.href)}
                style={({ pressed }) => [styles.navItem, (active || pressed) && styles.navItemActive]}
              >
                <View style={[styles.navInner, !active && styles.dimmed]}>
                  <NavGlyph kind={item.glyph} tone={color.onPrimary} />
                  <Text style={[styles.navLabel, active && styles.navLabelActive]}>{item.label}</Text>
                </View>
                {active && <View style={styles.navActiveDot} />}
              </Pressable>
            );
          })}
        </View>
      </View>

      <View style={styles.footer}>
        <View style={styles.identityRow}>
          <View style={styles.identityAvatar}>
            <Text style={styles.identityAvatarLabel}>A</Text>
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={styles.identityName} numberOfLines={1}>Administrator</Text>
            <Text style={[styles.identityRole, styles.dimmed]} numberOfLines={1}>Full access</Text>
          </View>
        </View>
        <Pressable onPress={onLogout} style={({ pressed }) => [styles.logoutButton, pressed && styles.navItemActive]}>
          <Text style={styles.logoutLabel}>Log out</Text>
        </Pressable>
      </View>
    </View>
  );
}

export function AdminMobileNav({ onLogout }: { onLogout: () => void }) {
  const pathname = usePathname();
  const router = useRouter();
  return (
    <View style={styles.mobileBar}>
      <View style={styles.mobileTopRow}>
        <View style={styles.mobileBrand}>
          <Image source={require('../../assets/logo.jpg')} style={styles.mobileLogo} resizeMode="contain" />
          <Text style={styles.mobileBrandLabel}>TrustLink Admin</Text>
        </View>
        <Pressable onPress={onLogout} style={styles.mobileLogout} hitSlop={6}>
          <Text style={styles.mobileLogoutLabel}>Log out</Text>
        </Pressable>
      </View>
      <View style={styles.mobileTabs}>
        {ADMIN_NAV_ITEMS.map((item) => {
          const active = pathname === item.href;
          return (
            <Pressable key={item.href} onPress={() => router.push(item.href)} style={styles.mobileTab}>
              <NavGlyph kind={item.glyph} tone={active ? color.primary : color.inkFaint} />
              <Text style={[styles.mobileTabLabel, active && styles.mobileTabLabelActive]}>{item.label}</Text>
              <View style={[styles.mobileTabBar, active && styles.mobileTabBarActive]} />
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const glyph = StyleSheet.create({
  box: { width: 16, height: 16, alignItems: 'center', justifyContent: 'center' },
  grid: { width: 14, height: 14, flexDirection: 'row', flexWrap: 'wrap', gap: 2 },
  gridCell: { width: 6, height: 6, borderWidth: 1.5, borderRadius: 1.5 },
  head: { width: 7, height: 7, borderRadius: 4, borderWidth: 1.5, marginBottom: 1 },
  shoulders: { width: 13, height: 6, borderWidth: 1.5, borderBottomWidth: 0, borderTopLeftRadius: 6, borderTopRightRadius: 6 },
  doc: { width: 12, height: 15, borderWidth: 1.5, borderRadius: 2, paddingHorizontal: 2, paddingTop: 3, gap: 2 },
  docLine: { height: 1.5, borderRadius: 1 },
  docLineShort: { width: 4 },
  flagRow: { flexDirection: 'row', alignItems: 'flex-start', height: 15 },
  flagPole: { width: 1.5, height: 15, borderRadius: 1 },
  flag: { width: 10, height: 7, borderWidth: 1.5, borderLeftWidth: 0, borderTopRightRadius: 2, borderBottomRightRadius: 2 },
});

const styles = StyleSheet.create({
  /* desktop sidebar — navy column, white text dimmed by opacity (no extra colour tokens) */
  sidebar: {
    width: 240,
    backgroundColor: color.primary,
    paddingVertical: space.xxl,
    paddingHorizontal: space.lg,
    justifyContent: 'space-between',
  },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, marginBottom: space.section },
  logoWrap: {
    width: 40,
    height: 40,
    borderRadius: radius.md,
    backgroundColor: color.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logo: { width: 30, height: 30 },
  brandEyebrow: {
    fontFamily: font.monoMedium,
    fontSize: fontSize.micro,
    color: color.onPrimary,
    letterSpacing: letterSpacing.label,
    textTransform: 'uppercase',
    opacity: 0.7,
  },
  brandTitle: { fontFamily: font.display, fontSize: fontSize.md, color: color.onPrimary },
  navHeading: {
    fontFamily: font.monoMedium,
    fontSize: fontSize.micro,
    color: color.onPrimary,
    letterSpacing: letterSpacing.label,
    textTransform: 'uppercase',
    opacity: 0.55,
    marginBottom: space.sm,
    paddingHorizontal: space.md,
  },
  navSection: { gap: space.xs },
  navItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderRadius: radius.md,
    paddingVertical: space.md,
    paddingHorizontal: space.md,
  },
  navItemActive: { backgroundColor: color.primaryPressed },
  navInner: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  dimmed: { opacity: 0.72 },
  navLabel: { fontFamily: font.bodyMedium, fontSize: fontSize.sm, color: color.onPrimary },
  navLabelActive: { fontFamily: font.bodySemi },
  navActiveDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: color.onPrimary },

  footer: { gap: space.md },
  identityRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingHorizontal: space.xs },
  identityAvatar: {
    width: 32,
    height: 32,
    borderRadius: radius.pill,
    backgroundColor: color.primaryPressed,
    alignItems: 'center',
    justifyContent: 'center',
  },
  identityAvatarLabel: { fontFamily: font.display, fontSize: fontSize.sm, color: color.onPrimary },
  identityName: { fontFamily: font.bodySemi, fontSize: fontSize.sm, color: color.onPrimary },
  identityRole: { fontFamily: font.body, fontSize: fontSize.micro, color: color.onPrimary },
  logoutButton: {
    borderRadius: radius.md,
    paddingVertical: space.sm,
    alignItems: 'center',
    backgroundColor: color.primaryPressed,
  },
  logoutLabel: { fontFamily: font.bodySemi, fontSize: fontSize.sm, color: color.onPrimary },

  /* phone top bar */
  mobileBar: { backgroundColor: color.surface, borderBottomWidth: 1, borderBottomColor: color.border },
  mobileTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: space.lg,
    paddingTop: space.md,
    paddingBottom: space.sm,
  },
  mobileBrand: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  mobileLogo: { width: 24, height: 24 },
  mobileBrandLabel: { fontFamily: font.display, fontSize: fontSize.base, color: color.ink },
  mobileLogout: {
    borderWidth: 1,
    borderColor: color.border,
    borderRadius: radius.pill,
    paddingHorizontal: space.md,
    paddingVertical: space.xs,
  },
  mobileLogoutLabel: { fontFamily: font.bodyMedium, fontSize: fontSize.sm, color: color.ink },
  mobileTabs: { flexDirection: 'row', paddingHorizontal: space.sm },
  mobileTab: { flex: 1, alignItems: 'center', gap: space.xs, paddingTop: space.sm, minHeight: 44 },
  mobileTabLabel: { fontFamily: font.bodyMedium, fontSize: fontSize.micro, color: color.inkFaint },
  mobileTabLabelActive: { fontFamily: font.bodySemi, color: color.primary },
  mobileTabBar: { alignSelf: 'stretch', height: 2, borderRadius: 1, backgroundColor: 'transparent', marginTop: space.xs },
  mobileTabBarActive: { backgroundColor: color.primary },
});
