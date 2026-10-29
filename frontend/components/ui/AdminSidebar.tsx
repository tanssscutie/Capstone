// components/ui/AdminSidebar.tsx
// Shared nav shell for the admin area. Menus are grouped under headings
// (ADMIN_NAV_GROUPS); a menu with `tabs` covers several pages, which
// AdminShell shows as a tab bar. Paths come from lib/adminRoutes.ts; (AdminSectionTabs) — e.g. System settings =
// General, Platform rules, Admin team, Audit log, Backups & exports.
// AdminSidebar is the desktop column; AdminMobileNav is the phone
// equivalent (top bar + tabs), so the admin area stays navigable below
// breakpoint.desktop too.
import { View, Text, Pressable, Image, StyleSheet } from 'react-native';
import { usePathname, useRouter } from 'expo-router';
import { color, font, fontSize, letterSpacing, space, radius } from './tokens';
import { useAdminRole } from '../../lib/useAdminRole';
import { ADMIN, type AdminHref } from '../../lib/adminRoutes';

type NavGlyphKind = 'dashboard' | 'businesses' | 'requirements' | 'reports' | 'changes' | 'settings' | 'api' | 'files' | 'team' | 'rules' | 'audit' | 'data';


export interface AdminTab {
  label: string;
  href: AdminHref;
  /** Shown to super admins only (the page checks it too). */
  superOnly?: boolean;
}

export interface AdminNavItem {
  label: string;
  href: AdminHref;
  glyph: NavGlyphKind;
  /** The pages this menu covers, shown as tabs on each of them. */
  tabs?: AdminTab[];
}

export const ADMIN_NAV_GROUPS: { heading: string; items: AdminNavItem[] }[] = [
  { heading: 'Overview', items: [{ label: 'Dashboard', href: ADMIN.dashboard, glyph: 'dashboard' }] },
  {
    heading: 'Manage',
    items: [
      { label: 'Businesses', href: ADMIN.businesses, glyph: 'businesses' },
      { label: 'Requirements', href: ADMIN.requirements, glyph: 'requirements' },
      { label: 'Reports', href: ADMIN.reports, glyph: 'reports' },
      { label: 'Change requests', href: ADMIN.changeRequests, glyph: 'changes' },
    ],
  },
  {
    heading: 'Resources',
    items: [{
      label: 'Documents & API', href: ADMIN.documents, glyph: 'files',
      tabs: [{ label: 'Documents', href: ADMIN.documents }, { label: 'API reference', href: ADMIN.api }],
    }],
  },
  {
    heading: 'System',
    items: [{
      label: 'System settings', href: ADMIN.settings, glyph: 'settings',
      tabs: [
        { label: 'General', href: ADMIN.settings },
        { label: 'Platform rules', href: ADMIN.rules, superOnly: true },
        { label: 'Admin team', href: ADMIN.team, superOnly: true },
        { label: 'Audit log', href: ADMIN.audit, superOnly: true },
        { label: 'Backups & exports', href: ADMIN.data, superOnly: true },
      ],
    }],
  },
];

export const ADMIN_NAV_ITEMS: AdminNavItem[] = ADMIN_NAV_GROUPS.flatMap((g) => g.items);

function isActive(item: AdminNavItem, pathname: string): boolean {
  return pathname === item.href || !!item.tabs?.some((t) => t.href === pathname);
}

/** The tab bar for a page that belongs to a multi-page menu; nothing otherwise. */
export function AdminSectionTabs() {
  const pathname = usePathname();
  const router = useRouter();
  const role = useAdminRole();
  const item = ADMIN_NAV_ITEMS.find((i) => i.tabs?.some((t) => t.href === pathname));
  const tabs = item?.tabs?.filter((t) => !t.superOnly || role === 'super_admin') ?? [];
  if (tabs.length < 2) return null;
  return (
    <View style={styles.sectionTabs} accessibilityRole="tablist">
      {tabs.map((t) => {
        const active = t.href === pathname;
        return (
          <Pressable key={t.href} onPress={() => { if (!active) router.replace(t.href); }} accessibilityRole="tab"
            accessibilityState={{ selected: active }} style={[styles.sectionTab, active && styles.sectionTabActive]}>
            <Text style={[styles.sectionTabLabel, active && styles.sectionTabLabelActive]}>{t.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

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
  if (kind === 'settings') {
    // A cog: a ring with four short teeth.
    return (
      <View style={glyph.box}>
        <View style={[glyph.cogTooth, { backgroundColor: tone }]} />
        <View style={[glyph.cogTooth, { backgroundColor: tone, transform: [{ rotate: '90deg' }] }]} />
        <View style={[glyph.cogRing, { borderColor: tone }]} />
      </View>
    );
  }
  if (kind === 'api') {
    // "< >": two chevrons, each a bordered square turned 45° and half hidden.
    return (
      <View style={[glyph.box, glyph.codeRow]}>
        <View style={[glyph.chevron, glyph.chevronLeft, { borderColor: tone }]} />
        <View style={[glyph.chevron, glyph.chevronRight, { borderColor: tone }]} />
      </View>
    );
  }
  if (kind === 'data') {
    // A download: an arrow (a line and a turned square's corner) over a tray.
    return (
      <View style={[glyph.box, { justifyContent: 'flex-end' }]}>
        <View style={[glyph.arrowShaft, { backgroundColor: tone }]} />
        <View style={[glyph.arrowHead, { borderColor: tone }]} />
        <View style={[glyph.tray, { borderColor: tone }]} />
      </View>
    );
  }
  if (kind === 'audit') {
    // A list: three rows, each a dot and a line.
    return (
      <View style={[glyph.box, { gap: 2.5, alignItems: 'flex-start' }]}>
        {[0, 1, 2].map((i) => (
          <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}>
            <View style={[glyph.listDot, { backgroundColor: tone }]} />
            <View style={[glyph.listLine, { backgroundColor: tone }]} />
          </View>
        ))}
      </View>
    );
  }
  if (kind === 'rules') {
    // Two sliders: a line each, with a knob at a different spot.
    return (
      <View style={[glyph.box, { gap: 4 }]}>
        {[3, 8].map((left) => (
          <View key={left} style={[glyph.sliderLine, { backgroundColor: tone }]}>
            <View style={[glyph.sliderKnob, { borderColor: tone, left }]} />
          </View>
        ))}
      </View>
    );
  }
  if (kind === 'team') {
    // Two people side by side.
    return (
      <View style={[glyph.box, glyph.teamRow]}>
        {[0, 1].map((i) => (
          <View key={i} style={{ alignItems: 'center' }}>
            <View style={[glyph.teamHead, { borderColor: tone }]} />
            <View style={[glyph.teamBody, { borderColor: tone }]} />
          </View>
        ))}
      </View>
    );
  }
  if (kind === 'files') {
    // A folder: a small tab on top of a rounded box.
    return (
      <View style={glyph.box}>
        <View style={[glyph.folderTab, { borderColor: tone }]} />
        <View style={[glyph.folder, { borderColor: tone }]} />
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
  const role = useAdminRole();
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

        {ADMIN_NAV_GROUPS.map((group) => (
        <View key={group.heading}>
        <Text style={styles.navHeading}>{group.heading}</Text>
        <View style={styles.navSection}>
          {group.items.map((item) => {
            const active = isActive(item, pathname);
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
        ))}
      </View>

      <View style={styles.footer}>
        <View style={styles.identityRow}>
          <View style={styles.identityAvatar}>
            <Text style={styles.identityAvatarLabel}>A</Text>
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={styles.identityName} numberOfLines={1}>Administrator</Text>
            <Text style={[styles.identityRole, styles.dimmed]} numberOfLines={1}>{role === 'super_admin' ? 'Super admin' : role === 'admin' ? 'Admin' : ''}</Text>
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
  const role = useAdminRole();
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
          const active = isActive(item, pathname);
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
  cogTooth: { position: 'absolute', width: 15, height: 3, borderRadius: 1 },
  cogRing: { width: 11, height: 11, borderRadius: 6, borderWidth: 2.5, backgroundColor: color.primary },
  codeRow: { flexDirection: 'row', gap: 3 },
  arrowShaft: { position: 'absolute', top: 0, width: 1.5, height: 9, borderRadius: 1 },
  arrowHead: { position: 'absolute', top: 4, width: 6, height: 6, borderRightWidth: 1.5, borderBottomWidth: 1.5, transform: [{ rotate: '45deg' }] },
  tray: { width: 14, height: 5, borderWidth: 1.5, borderTopWidth: 0, borderBottomLeftRadius: 2, borderBottomRightRadius: 2 },
  listDot: { width: 2.5, height: 2.5, borderRadius: 1.5 },
  listLine: { width: 10, height: 1.5, borderRadius: 1 },
  sliderLine: { width: 14, height: 1.5, borderRadius: 1, justifyContent: 'center' },
  sliderKnob: { position: 'absolute', width: 5, height: 5, borderRadius: 3, borderWidth: 1.5, backgroundColor: color.primary },
  teamRow: { flexDirection: 'row', gap: 1, alignItems: 'flex-end' },
  teamHead: { width: 5, height: 5, borderRadius: 3, borderWidth: 1.5, marginBottom: 1 },
  teamBody: { width: 7, height: 5, borderWidth: 1.5, borderBottomWidth: 0, borderTopLeftRadius: 4, borderTopRightRadius: 4 },
  chevron: { width: 6, height: 6, borderTopWidth: 1.5 },
  chevronLeft: { borderLeftWidth: 1.5, transform: [{ rotate: '-45deg' }] },
  chevronRight: { borderRightWidth: 1.5, transform: [{ rotate: '45deg' }] },
  folderTab: { width: 6, height: 3, borderWidth: 1.5, borderBottomWidth: 0, borderTopLeftRadius: 1.5, borderTopRightRadius: 1.5, alignSelf: 'flex-start', marginLeft: 1 },
  folder: { width: 15, height: 10, borderWidth: 1.5, borderRadius: 2 },
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
    marginTop: space.lg,
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
  sectionTabs: { flexDirection: 'row', flexWrap: 'wrap', gap: space.xs, borderBottomWidth: 1, borderBottomColor: color.border, marginBottom: space.lg },
  sectionTab: { paddingHorizontal: space.md, paddingVertical: space.sm, borderBottomWidth: 2, borderBottomColor: 'transparent', marginBottom: -1 },
  sectionTabActive: { borderBottomColor: color.primary },
  sectionTabLabel: { fontFamily: font.bodyMedium, fontSize: fontSize.sm, color: color.inkMuted },
  sectionTabLabelActive: { fontFamily: font.bodySemi, color: color.primary },
  mobileTabs: { flexDirection: 'row', paddingHorizontal: space.sm },
  mobileTab: { flex: 1, alignItems: 'center', gap: space.xs, paddingTop: space.sm, minHeight: 44 },
  mobileTabLabel: { fontFamily: font.bodyMedium, fontSize: fontSize.micro, color: color.inkFaint },
  mobileTabLabelActive: { fontFamily: font.bodySemi, color: color.primary },
  mobileTabBar: { alignSelf: 'stretch', height: 2, borderRadius: 1, backgroundColor: 'transparent', marginTop: space.xs },
  mobileTabBarActive: { backgroundColor: color.primary },
});
